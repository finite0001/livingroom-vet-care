import { test, expect, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { paymentFixture, reopenPayment } from "./payment-fixture";
import {
  actor,
  client,
  invoice,
  conversation,
  backend,
} from "./invoice-email-fixture";
import type { DeliveryIntent } from "../src/hub/features/payments/PaymentDeliveryState";
const grantId = "44444444-4444-4444-8444-444444444444",
  attachmentId = "77777777-7777-4777-8777-777777777777";
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
function grant() {
  const created_at = new Date().toISOString(),
    expires_at = new Date(Date.now() + 86400000).toISOString();
  const g = {
    id: grantId,
    actor_id: actor,
    invoice_id: invoice,
    client_id: client,
    source_hash: "a".repeat(64),
    amount_cents: "12500",
    currency: "usd",
    created_at,
    expires_at,
    status_expires_at: new Date(
      Date.parse(expires_at) + 30 * 86400000,
    ).toISOString(),
  };
  const ctx = JSON.stringify({
    domain: "lrv-payment-collection/v2",
    context_version: 2,
    origin: "https://thelivingroom.vet",
    key_version: "first",
    grant: g,
  });
  return {
    grant: { ...g, state: "reviewed" },
    capture: {
      grant_id: grantId,
      context_version: 2,
      origin: "https://thelivingroom.vet",
      key_version: "first",
      capability_context: ctx,
      context_hash: digest(ctx),
    },
  };
}
const html =
  "<html><body><h1>Frozen invoice café</h1><p>Total $125.00</p></body></html>";
const attachment = {
  filename: `invoice-${invoice}.html`,
  content_type: "text/html",
  content: Buffer.from(html).toString("base64"),
};
function envelope(args: DeliveryIntent) {
  const sender =
    args.p_channel === "EMAIL"
      ? {
          from: "Practice <billing@example.test>",
          reply_to: "billing@example.test",
        }
      : { from: "+15555550100", account_sid: "AC" + "a".repeat(32) };
  const message = args.p_body_template.replace(
    "{{payment_link}}",
    `https://thelivingroom.vet/pay/${grantId}#p1.${"x".repeat(43)}`,
  );
  const attached = args.p_invoice_email_request_id ? attachment : null;
  const payload =
    args.p_channel === "SMS"
      ? new URLSearchParams({
          From: sender.from,
          To: args.p_recipient,
          Body: message,
        }).toString()
      : JSON.stringify({
          from: sender.from,
          reply_to: sender.reply_to,
          to: [args.p_recipient],
          subject: args.p_subject,
          text: message,
          ...(attached ? { attachments: [attached] } : {}),
        });
  return {
    delivery: {
      request: {
        id: args.p_request_id,
        grant_id: grantId,
        actor_id: actor,
        invoice_id: invoice,
        client_id: client,
        source_hash: "a".repeat(64),
        amount_cents: "12500",
        conversation_id: args.p_conversation_id,
        channel: args.p_channel,
        recipient: args.p_recipient,
        subject: args.p_subject,
        body_template: args.p_body_template,
        invoice_email_request_id: args.p_invoice_email_request_id,
        invoice_payload_hash: args.p_invoice_payload_hash,
        created_at: new Date().toISOString(),
      },
      capture: {
        request_id: args.p_request_id,
        sender_config: sender,
        message_hash: digest(message),
        payload_hash: digest(payload),
        captured_at: new Date().toISOString(),
      },
      receipt: null as null | {
        outbox_id: string;
        message_id: string;
        state: string;
        queued: true;
        delivered: boolean;
      },
    },
    preview: {
      message,
      recipient: args.p_recipient,
      subject: args.p_subject,
      sender,
      attachment: attached,
    },
  };
}
async function setup(
  page: Page,
  baseURL: string | undefined,
  withAttachment = false,
) {
  const payment = await paymentFixture(page, baseURL);
  const state = {
    rows: [] as ReturnType<typeof envelope>[],
    prepares: [] as DeliveryIntent[],
    reviews: 0,
    queueCalls: [] as Record<string, unknown>[],
    loss: "none",
    consent: true,
    recoverFail: false,
  };
  const invoiceEmail = {
    request: {
      id: attachmentId,
      invoice_id: invoice,
      client_id: client,
      actor_id: actor,
      conversation_id: conversation,
      recipient: "client@example.test",
      subject: "Your invoice",
      body: "Attached is your invoice. Pay securely: {{payment_link}}",
      invoice_hash: "a".repeat(64),
      state: "ready",
    },
    payload_hash: "d".repeat(64),
    manifest: [
      {
        filename: attachment.filename,
        mime_type: "text/html",
        file_size: Buffer.byteLength(html),
        sha256: digest(html),
      },
    ],
    report_html: html,
    purged_at: null,
    receipt: null,
  };
  await page.route(`${backend}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/clients"))
      return route.fulfill({
        json: {
          id: client,
          first_name: "Synthetic",
          last_name: "Household",
          full_name: "Synthetic Household",
          primary_email: "client@example.test",
          primary_phone: "+1 (555) 555-0123",
        },
      });
    if (path.endsWith("/list_payment_collections"))
      return route.fulfill({ json: [grant()] });
    if (path.endsWith("/list_payment_deliveries"))
      return route.fulfill({
        json: {
          invoice_id: invoice,
          client_id: client,
          grant_id: null,
          deliveries: state.rows.map((r) => r.delivery),
          has_more: false,
        },
      });
    if (withAttachment && path.endsWith("/recover_invoice_email"))
      return route.fulfill({ json: invoiceEmail });
    if (withAttachment && path.endsWith("/read_invoice_email_preview"))
      return route.fulfill({
        json: {
          client_id: client,
          source_hash: "a".repeat(64),
          recipient: "client@example.test",
          document: {},
        },
      });
    if (path.endsWith("/prepare-payment-delivery")) {
      const { action, ...args } = route.request().postDataJSON();
      if (action === "recover") {
        if (state.recoverFail) return route.abort("connectionfailed");
        return route.fulfill({
          json: {
            delivery:
              state.rows.find(
                (r) => r.delivery.request.id === args.p_request_id,
              )?.delivery ?? null,
          },
        });
      }
      if (action === "review") {
        state.reviews++;
        if (!state.consent)
          return route.fulfill({
            status: 404,
            json: { error: "Current consent unavailable" },
          });
        return route.fulfill({
          json: state.rows.find(
            (r) => r.delivery.request.id === args.p_request_id,
          ),
        });
      }
      expect(action).toBe("prepare");
      state.prepares.push(args);
      if (state.loss === "before") {
        state.loss = "none";
        return route.abort("connectionfailed");
      }
      let row = state.rows.find(
        (r) => r.delivery.request.id === args.p_request_id,
      );
      if (!row) {
        row = envelope(args);
        state.rows.push(row);
      }
      if (state.loss === "after") {
        state.loss = "none";
        return route.abort("connectionfailed");
      }
      return route.fulfill({ json: { delivery: row.delivery } });
    }
    if (path.endsWith("/enqueue_payment_delivery")) {
      const args = route.request().postDataJSON();
      state.queueCalls.push(args);
      const row = state.rows.find(
        (r) => r.delivery.request.id === args.p_request_id,
      )!;
      expect(args).toEqual({
        p_request_id: row.delivery.request.id,
        p_reviewed_message_hash: row.delivery.capture.message_hash,
        p_reviewed_payload_hash: row.delivery.capture.payload_hash,
        p_attest: true,
      });
      if (!state.consent)
        return route.fulfill({
          status: 403,
          json: { code: "42501", message: "Consent changed" },
        });
      row.delivery.receipt ??= {
        outbox_id: "88888888-8888-4888-8888-888888888888",
        message_id: "99999999-9999-4999-8999-999999999999",
        state: "pending",
        queued: true,
        delivered: false,
      };
      if (state.loss === "queue") {
        state.loss = "none";
        return route.abort("connectionfailed");
      }
      return route.fulfill({ json: { id: row.delivery.receipt.outbox_id } });
    }
    return route.fallback();
  });
  await reopenPayment(page);
  const panel = page.getByRole("region", {
    name: "Payment message delivery",
    exact: true,
  });
  return { panel, state, payment, invoiceEmail };
}
async function compose(
  panel: ReturnType<Page["getByRole"]>,
  channel: "EMAIL" | "SMS" = "EMAIL",
) {
  await panel.getByLabel("Reviewed payment access").selectOption(grantId);
  await panel.getByLabel("Delivery channel").selectOption(channel);
  await panel.getByLabel("Payment conversation").selectOption(conversation);
}
test("lost email preparation before commit keeps nine arguments after reload", async ({
  page,
  baseURL,
}) => {
  const { panel, state } = await setup(page, baseURL);
  await compose(panel);
  state.loss = "before";
  await panel
    .getByRole("button", { name: "Prepare exact payment message" })
    .click();
  await expect(
    panel.getByRole("button", {
      name: "Retry same payment message preparation",
    }),
  ).toBeEnabled();
  await reopenPayment(page);
  await panel
    .getByRole("button", { name: "Retry same payment message preparation" })
    .click();
  await expect(
    panel.getByRole("button", { name: "Open exact payment message review" }),
  ).toBeVisible();
  expect(new Set(state.prepares.map((a) => JSON.stringify(a))).size).toBe(1);
  await panel
    .getByRole("button", { name: "Open exact payment message review" })
    .click();
  await expect(
    panel.getByText(/https:\/\/thelivingroom.vet\/pay\//),
  ).toBeVisible();
  const storage = await page.evaluate(() =>
    JSON.stringify({ local: localStorage, session: sessionStorage }),
  );
  expect(storage).not.toContain("p1.");
  expect(storage).not.toContain("checkout.stripe.com");
  await panel
    .getByRole("button", { name: "Close private message preview" })
    .click();
  await expect(panel.getByText(/#p1\./)).toHaveCount(0);
  await page.getByRole("button", { name: "Sign Out", exact: true }).click();
  await expect(page).toHaveURL(/login/);
  expect(
    await page.evaluate(
      () =>
        Object.keys(sessionStorage).filter((key) =>
          key.startsWith("invoice-payment-intent:"),
        ).length,
    ),
  ).toBe(0);
});
test("lost SMS capture and queue receipts recover before consent or signing-key dependent preview", async ({
  page,
  baseURL,
}) => {
  const { panel, state, payment } = await setup(page, baseURL);
  await compose(panel, "SMS");
  state.loss = "after";
  state.recoverFail = true;
  await panel
    .getByRole("button", { name: "Prepare exact payment message" })
    .click();
  await expect(panel.getByText(/response is uncertain/)).toBeVisible();
  state.recoverFail = false;
  await panel
    .getByRole("button", {
      name: "Recover payment message and refresh history",
    })
    .click();
  await panel
    .getByRole("button", { name: "Open exact payment message review" })
    .click();
  await panel.getByRole("checkbox").check();
  state.loss = "queue";
  await panel
    .getByRole("button", { name: "Queue reviewed payment message" })
    .click();
  await expect(
    panel.getByText(/Saved payment message receipt: pending/),
  ).toBeVisible();
  expect(state.queueCalls).toHaveLength(1);
  expect(state.prepares).toHaveLength(1);
  state.consent = false;
  await reopenPayment(page);
  await panel
    .getByLabel("Payment message history")
    .selectOption(state.rows[0].delivery.request.id);
  await expect(panel.getByText(/Delivery is not confirmed/)).toBeVisible();
  expect(state.reviews).toBe(1);
  expect(payment.state.providerCalls).toHaveLength(0);
});
test("consent becoming stale between exact review and enqueue preserves request without a receipt", async ({
  page,
  baseURL,
}) => {
  const { panel, state } = await setup(page, baseURL);
  await compose(panel);
  await panel
    .getByRole("button", { name: "Prepare exact payment message" })
    .click();
  await panel
    .getByRole("button", { name: "Open exact payment message review" })
    .click();
  await panel.getByRole("checkbox").check();
  state.consent = false;
  await panel
    .getByRole("button", { name: "Queue reviewed payment message" })
    .click();
  await expect(panel.getByText(/response is uncertain/)).toBeVisible();
  await expect(panel.getByText(/#p1\./)).toHaveCount(0);
  await expect(panel.getByText(/Saved payment message receipt/)).toHaveCount(0);
  await panel
    .getByRole("button", {
      name: "Recover payment message and refresh history",
    })
    .click();
  await panel
    .getByRole("button", { name: "Open exact payment message review" })
    .click();
  await expect(panel.getByRole("alert")).toBeVisible();
  expect(state.prepares).toHaveLength(1);
  expect(state.queueCalls).toHaveLength(1);
});
test("ready invoice handoff preserves attachment context and disables standalone email queue", async ({
  page,
  baseURL,
}) => {
  const { panel, state, invoiceEmail } = await setup(page, baseURL, true);
  const invoicePanel = page.getByRole("region", {
    name: "Invoice email",
    exact: true,
  });
  await invoicePanel.getByRole("checkbox").check();
  await expect(
    invoicePanel.getByRole("button", { name: "Queue reviewed invoice email" }),
  ).toBeDisabled();
  await invoicePanel
    .getByRole("button", { name: "Continue with payment link" })
    .click();
  await expect(
    invoicePanel.getByRole("button", {
      name: "Resume standalone invoice email",
    }),
  ).toBeDisabled();
  await panel.getByLabel("Reviewed payment access").selectOption(grantId);
  await expect(panel.getByLabel("Payment message template")).toHaveValue(
    invoiceEmail.request.body,
  );
  await panel
    .getByRole("button", { name: "Prepare exact payment message" })
    .click();
  await reopenPayment(page);
  await panel
    .getByRole("button", { name: "Open exact payment message review" })
    .click();
  await expect(
    panel.frameLocator("iframe").getByText("Frozen invoice café"),
  ).toBeVisible();
  await panel.getByRole("checkbox").check();
  await panel
    .getByRole("button", { name: "Queue reviewed payment message" })
    .click();
  await expect(panel.getByText(/Saved payment message receipt/)).toBeVisible();
  expect(state.prepares[0]).toMatchObject({
    p_invoice_email_request_id: attachmentId,
    p_invoice_payload_hash: invoiceEmail.payload_hash,
    p_conversation_id: conversation,
    p_recipient: invoiceEmail.request.recipient,
    p_subject: invoiceEmail.request.subject,
    p_body_template: invoiceEmail.request.body,
  });
});
