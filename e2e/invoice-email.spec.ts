import type { InvoiceEmailPreparation } from "../src/hub/features/billing/invoice-email-state";
import { test, expect, type Page } from "@playwright/test";
const backend = "http://127.0.0.1:54321",
  actor = "11111111-1111-4111-8111-111111111111",
  client = "22222222-2222-4222-8222-222222222222",
  invoice = "55555555-5555-4555-8555-555555555555",
  conversation = "66666666-6666-4666-8666-666666666666";
async function fixture(page: Page, baseURL: string | undefined) {
  const exp = Math.floor(Date.now() / 1000) + 3600,
    user = {
      id: actor,
      aud: "authenticated",
      role: "authenticated",
      email: "staff@example.test",
      app_metadata: { provider: "email", providers: ["email"] },
      user_metadata: {},
      created_at: "2026-01-01T00:00:00Z",
    };
  const session = {
    access_token: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: actor, exp, role: "authenticated", aud: "authenticated" })).toString("base64url")}.synthetic`,
    refresh_token: "synthetic",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: exp,
    user,
  };
  await page.addInitScript(
    (value) => localStorage.setItem("sb-127-auth-token", JSON.stringify(value)),
    session,
  );
  const state = {
    saved: null as InvoiceEmailPreparation | null,
    hash: "a".repeat(64),
    invoiceStatus: "issued",
    failAuth: false,
    prepares: [] as Record<string, string>[],
    queues: [] as Record<string, string>[],
    hasConversation: true,
    losePrepare: false,
    loseBeforeSave: false,
    loseQueue: false,
    reject: false,
    recoveryFail: false,
    previewFail: false,
    paths: [] as string[],
  };
  const record = {
    id: invoice,
    client_id: client,
    status: "issued",
    version: 3,
    total_cents: 12500,
    created_at: "2026-09-12T18:00:00Z",
  };
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === new URL(baseURL!).origin
      ? route.continue()
      : route.abort(),
  );
  await page.route(`${backend}/**`, async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname;
    state.paths.push(path);
    if (path === "/auth/v1/token") return route.fulfill({ json: session });
    if (path === "/auth/v1/user") return route.fulfill({ json: user });
    if (path === "/rest/v1/profiles" && state.failAuth)
      return route.fulfill({
        status: 403,
        json: { message: "Staff unavailable" },
      });
    if (path === "/rest/v1/profiles")
      return route.fulfill({
        json: [{ id: actor, full_name: "Synthetic Staff", is_active: true }],
      });
    if (path === "/rest/v1/user_roles")
      return route.fulfill({ json: [{ role: "STAFF" }] });
    if (path === "/rest/v1/clients")
      return route.fulfill({
        json: {
          id: client,
          full_name: "Synthetic Household",
          first_name: "Synthetic",
          last_name: "Household",
          created_at: record.created_at,
        },
      });
    record.status = state.invoiceStatus;
    if (path === "/rest/v1/billing_invoices")
      return route.fulfill({
        json: url.searchParams.has("id")
          ? record
          : [record, { ...record, id: "77777777-7777-4777-8777-777777777777" }],
      });
    if (path === "/rest/v1/conversations")
      return route.fulfill({
        json: state.hasConversation
          ? [
              {
                id: conversation,
                status: "ACTIVE",
                created_at: record.created_at,
              },
            ]
          : [],
      });
    if (path === "/rest/v1/rpc/ensure_active_conversation") {
      state.hasConversation = true;
      return route.fulfill({ json: { id: conversation } });
    }
    if (path === "/rest/v1/rpc/read_invoice_email_preview")
      return state.previewFail || state.invoiceStatus !== "issued"
        ? route.fulfill({
            status: 403,
            json: { code: "42501", message: "Unavailable" },
          })
        : route.fulfill({
            json: {
              document: {},
              source_hash: state.hash,
              client_id: client,
              recipient: "household@example.test",
            },
          });
    if (path === "/rest/v1/rpc/recover_invoice_email")
      return state.recoveryFail
        ? route.fulfill({
            status: 403,
            json: { message: "Recovery unavailable" },
          })
        : route.fulfill({ json: state.saved });
    if (path === "/functions/v1/prepare-invoice-email") {
      const args = route.request().postDataJSON();
      state.prepares.push(args);
      if (state.reject)
        return route.fulfill({
          status: 400,
          json: {
            code: "23514",
            error: "Rejected",
            retry_requires_recovery: true,
          },
        });
      if (state.loseBeforeSave) {
        state.loseBeforeSave = false;
        return route.abort("connectionfailed");
      }
      state.saved ??= {
        request: {
          id: args.p_request_id,
          invoice_id: invoice,
          client_id: client,
          actor_id: actor,
          conversation_id: args.p_conversation_id,
          recipient: args.p_recipient,
          subject: args.p_subject,
          body: args.p_body,
          invoice_hash: args.p_invoice_hash,
          state: "ready",
        },
        payload_hash: "b".repeat(64),
        manifest: [
          {
            filename: "invoice.html",
            mime_type: "text/html",
            file_size: 123,
            sha256: "c".repeat(64),
          },
        ],
        report_html:
          "<!doctype html><h1>Synthetic frozen invoice</h1><p>Charges $125.00</p>",
        purged_at: null,
        receipt: null,
      };
      if (state.losePrepare) {
        state.losePrepare = false;
        return route.abort("connectionfailed");
      }
      return route.fulfill({ json: state.saved });
    }
    if (path === "/rest/v1/rpc/enqueue_invoice_email") {
      const args = route.request().postDataJSON();
      state.queues.push(args);
      state.saved.request.state = "queued";
      state.saved.receipt = {
        outbox_id: args.p_request_id,
        message_id: "88888888-8888-4888-8888-888888888888",
        state: "queued",
        queued: true,
        delivered: false,
      };
      if (state.loseQueue) {
        state.loseQueue = false;
        return route.abort("connectionfailed");
      }
      return route.fulfill({
        json: { id: args.p_request_id, state: "queued" },
      });
    }
    if (path === "/rest/v1/rpc/abandon_invoice_email") {
      state.saved = null;
      return route.fulfill({ json: null });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto(`/hub/client/${client}`);
  await page
    .getByRole("button", { name: /issued.*125.00/ })
    .first()
    .click();
  const email = page.getByRole("region", {
    name: "Invoice email",
    exact: true,
  });
  await expect(email.getByLabel("Invoice email subject")).toBeEnabled();
  return state;
}
async function prepare(page: Page) {
  const email = page.getByRole("region", {
    name: "Invoice email",
    exact: true,
  });
  await email
    .getByLabel("Invoice email conversation")
    .selectOption(conversation);
  await email
    .getByRole("button", { name: "Prepare exact invoice email", exact: true })
    .click();
  await expect(
    email
      .frameLocator("iframe")
      .getByRole("heading", { name: "Synthetic frozen invoice" }),
  ).toBeVisible();
  return email;
}
test("issued invoice freezes recipient and actual attachment before reviewed queue, never claims delivered", async ({
  page,
  baseURL,
}) => {
  const state = await fixture(page, baseURL);
  const email = await prepare(page);
  await expect(email.getByLabel("Invoice email message")).toBeDisabled();
  await expect(
    email.getByRole("button", { name: "Queue reviewed invoice email" }),
  ).toBeDisabled();
  await email.getByRole("checkbox").check();
  await email
    .getByRole("button", { name: "Queue reviewed invoice email" })
    .click();
  await expect(email.getByRole("status")).toContainText(
    "Delivery is not confirmed",
  );
  expect(state.queues).toHaveLength(1);
  expect(state.prepares[0].p_recipient).toBe("household@example.test");
});
test("lost captured prepare and queue responses recover same request after reload", async ({
  page,
  baseURL,
}) => {
  const state = await fixture(page, baseURL);
  state.losePrepare = true;
  await prepare(page);
  const id = state.prepares[0].p_request_id;
  page.on("dialog", (dialog) => dialog.accept());
  await page.reload();
  await page
    .getByRole("button", { name: /issued.*125.00/ })
    .first()
    .click();
  const email = page.getByRole("region", {
    name: "Invoice email",
    exact: true,
  });
  await expect(email.frameLocator("iframe").getByRole("heading")).toHaveText(
    "Synthetic frozen invoice",
  );
  state.loseQueue = true;
  await email.getByRole("checkbox").check();
  await email
    .getByRole("button", { name: "Queue reviewed invoice email" })
    .click();
  await expect(email.getByRole("status")).toContainText(
    "Delivery is not confirmed",
  );
  expect(state.queues[0].p_request_id).toBe(id);
  await email
    .getByRole("button", { name: "Compose a separate new invoice email" })
    .click();
  await email
    .getByLabel("Invoice email subject")
    .fill("Second explicitly requested copy");
  await email
    .getByRole("button", { name: "Recover saved invoice email and receipt" })
    .click();
  await expect(email.getByRole("status")).toContainText("Saved queue receipt");
});
test("lost request before capture survives reload with original UUID and locked values", async ({
  page,
  baseURL,
}) => {
  const state = await fixture(page, baseURL);
  state.loseBeforeSave = true;
  const email = page.getByRole("region", {
    name: "Invoice email",
    exact: true,
  });
  await email
    .getByLabel("Invoice email conversation")
    .selectOption(conversation);
  await email
    .getByRole("button", { name: "Prepare exact invoice email", exact: true })
    .click();
  await expect(email.getByRole("alert")).toContainText("not confirmed");
  const original = state.prepares[0];
  page.on("dialog", (dialog) => dialog.accept());
  await page.reload();
  await page
    .getByRole("button", { name: /issued.*125.00/ })
    .first()
    .click();
  await expect(
    email.getByRole("button", { name: "Retry same invoice email preparation" }),
  ).toBeEnabled();
  await email
    .getByRole("button", { name: "Retry same invoice email preparation" })
    .click();
  await expect(email.frameLocator("iframe").getByRole("heading")).toBeVisible();
  expect(state.prepares[1]).toEqual(original);
});
test("definitive uncaptured rejection restores editable draft and permits new request", async ({
  page,
  baseURL,
}) => {
  const state = await fixture(page, baseURL);
  state.reject = true;
  const email = page.getByRole("region", {
    name: "Invoice email",
    exact: true,
  });
  await email
    .getByLabel("Invoice email conversation")
    .selectOption(conversation);
  await email
    .getByRole("button", { name: "Prepare exact invoice email", exact: true })
    .click();
  await expect(email.getByRole("alert")).toContainText(
    "rejected before saving",
  );
  await expect(email.getByLabel("Invoice email subject")).toBeEnabled();
  state.reject = false;
  await email.getByLabel("Invoice email subject").fill("Corrected subject");
  await email
    .getByRole("button", { name: "Prepare exact invoice email", exact: true })
    .click();
  await expect(email.frameLocator("iframe").getByRole("heading")).toBeVisible();
  expect(state.prepares[1].p_request_id).not.toBe(
    state.prepares[0].p_request_id,
  );
});
test("credit changes invalidate prepared copy and require abandon before a fresh snapshot", async ({
  page,
  baseURL,
}) => {
  const state = await fixture(page, baseURL);
  const email = await prepare(page);
  state.hash = "d".repeat(64);
  await email.getByRole("checkbox").check();
  await email
    .getByRole("button", { name: "Queue reviewed invoice email" })
    .click();
  await expect(email.getByRole("alert").first()).toContainText("changed");
  expect(state.queues).toHaveLength(0);
  await email
    .getByRole("button", { name: "Abandon this unqueued invoice email" })
    .click();
  await expect(email.getByLabel("Invoice email subject")).toBeEnabled();
  await email
    .getByRole("button", { name: "Prepare exact invoice email", exact: true })
    .click();
  await expect(email.frameLocator("iframe").getByRole("heading")).toBeVisible();
  expect(state.prepares[1].p_invoice_hash).toBe(state.hash);
});
test("fresh household can create conversation and mobile draft blocks invoice and SPA switches", async ({
  page,
  baseURL,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await fixture(page, baseURL);
  state.hasConversation = false;
  const email = page.getByRole("region", {
    name: "Invoice email",
    exact: true,
  });
  await email
    .getByRole("button", { name: "Create or use active invoice conversation" })
    .click();
  await email.getByLabel("Invoice email message").fill("Keep this draft");
  await expect(
    page.getByRole("button", { name: /issued.*125.00/ }).nth(1),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: "Stay and reconcile" }).click();
  await expect(email.getByLabel("Invoice email message")).toHaveValue(
    "Keep this draft",
  );
  await email
    .getByRole("button", { name: "Discard invoice email draft" })
    .click();
  await expect(
    page.getByRole("button", { name: /issued.*125.00/ }).nth(1),
  ).toBeEnabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("failed current eligibility read cannot prepare or queue an invoice", async ({
  page,
  baseURL,
}) => {
  const state = await fixture(page, baseURL);
  state.previewFail = true;
  const email = page.getByRole("region", {
    name: "Invoice email",
    exact: true,
  });
  await email
    .getByLabel("Invoice email conversation")
    .selectOption(conversation);
  await email
    .getByRole("button", { name: "Prepare exact invoice email", exact: true })
    .click();
  await expect(
    email.getByText("Current invoice or household recipient is unavailable.", {
      exact: false,
    }),
  ).toBeVisible();
  expect(state.prepares).toHaveLength(0);
});

test("external void keeps prepared request mounted and historical queue receipt recoverable", async ({
  page,
  baseURL,
}) => {
  const state = await fixture(page, baseURL);
  const email = await prepare(page);
  state.invoiceStatus = "void";
  await page.evaluate(() =>
    window.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(
    email.getByText("This invoice is not issued.", { exact: false }),
  ).toBeVisible();
  await expect(email.frameLocator("iframe").getByRole("heading")).toHaveText(
    "Synthetic frozen invoice",
  );
  await expect(
    page.getByRole("button", { name: /void.*125.00/ }).first(),
  ).toBeDisabled();
  await email
    .getByRole("button", { name: "Abandon this unqueued invoice email" })
    .click();
  await expect(
    email.getByRole("button", {
      name: "Prepare exact invoice email",
      exact: true,
    }),
  ).toBeDisabled();
  state.saved = {
    request: {
      id: "99999999-9999-4999-8999-999999999999",
      invoice_id: invoice,
      actor_id: actor,
      client_id: client,
      conversation_id: conversation,
      recipient: "household@example.test",
      subject: "Prior invoice",
      body: "Prior copy",
      invoice_hash: "a".repeat(64),
      state: "queued",
    },
    payload_hash: "b".repeat(64),
    manifest: [
      {
        filename: "invoice.html",
        mime_type: "text/html",
        file_size: 123,
        sha256: "c".repeat(64),
      },
    ],
    report_html: "<h1>Previous invoice</h1>",
    purged_at: null,
    receipt: {
      outbox_id: "99999999-9999-4999-8999-999999999999",
      message_id: "88888888-8888-4888-8888-888888888888",
      state: "queued",
      queued: true,
      delivered: false,
    },
  };
  await email
    .getByRole("button", { name: "Recover saved invoice email and receipt" })
    .click();
  await expect(
    email.getByRole("status").filter({ hasText: "Saved queue receipt" }),
  ).toContainText("Delivery is not confirmed");
  await expect(
    email.getByRole("button", { name: "Compose a separate new invoice email" }),
  ).toBeDisabled();
});
for (const failure of [false, true])
  test(`pending text removed on ${failure ? "failed staff verification" : "signout"}`, async ({
    page,
    baseURL,
  }) => {
    const state = await fixture(page, baseURL);
    await prepare(page);
    expect(
      await page.evaluate(
        () =>
          Object.keys(sessionStorage).filter((k) =>
            k.startsWith("invoice-email-intent:"),
          ).length,
      ),
    ).toBe(1);
    if (failure) {
      state.failAuth = true;
      page.on("dialog", (dialog) => dialog.accept());
      await page.reload();
      await expect(
        page
          .getByText("Your staff access could not be verified.", {
            exact: false,
          })
          .first(),
      ).toBeVisible();
    } else {
      await page.getByRole("button", { name: "Sign Out", exact: true }).click();
      await expect(page).toHaveURL(/login/);
    }
    expect(
      await page.evaluate(
        () =>
          Object.keys(sessionStorage).filter((k) =>
            k.startsWith("invoice-email-intent:"),
          ).length,
      ),
    ).toBe(0);
  });
