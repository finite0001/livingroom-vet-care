import type { InvoiceEmailPreparation } from "../src/hub/features/billing/invoice-email-state";
import { test, expect, type Page } from "@playwright/test";
export const backend = "http://127.0.0.1:54321",
  actor = "11111111-1111-4111-8111-111111111111",
  client = "22222222-2222-4222-8222-222222222222",
  invoice = "55555555-5555-4555-8555-555555555555",
  conversation = "66666666-6666-4666-8666-666666666666";
export async function fixture(
  page: Page,
  baseURL: string | undefined,
  emptyHousehold = false,
) {
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
    invoiceFail: false,
    prepares: [] as Record<string, string>[],
    queues: [] as Record<string, string>[],
    hasConversation: !emptyHousehold,
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
    if (path.includes("document_link") || path.includes("document-link"))
      return route.fallback();
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
    if (path === "/rest/v1/billing_invoices" && state.invoiceFail)
      return route.fulfill({
        status: 403,
        json: { code: "42501", message: "Current read unavailable" },
      });
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
  // C6 moved the invoice list behind the "Invoices & payments" tab, and that tab
  // stays mounted-but-hidden on every other tab, so the invoice button exists in
  // the DOM and is not clickable until the tab is open. Use the ?tab= deep link
  // rather than a click: page.reload() in reopenPayment() then keeps the tab.
  await page.goto(`/hub/client/${client}?tab=invoices`);
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
