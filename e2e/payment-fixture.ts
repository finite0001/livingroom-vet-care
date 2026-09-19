import { expect, type Page } from "@playwright/test";
import {
  fixture,
  backend,
  actor,
  client,
  invoice,
} from "./invoice-email-fixture";
import type {
  CheckoutArgs,
  RefundArgs,
  PaymentState,
} from "../src/hub/features/payments/state";
export async function paymentFixture(page: Page, baseURL: string | undefined) {
  await fixture(page, baseURL);
  const state = {
    profile: true,
    losePrepare: "none" as "none" | "before" | "after",
    loseProvider: false,
    disabled: false,
    refundStatus: "pending",
    checkoutState: "open",
    prepares: [] as CheckoutArgs[],
    refunds: [] as RefundArgs[],
    providerCalls: [] as { p_request_id: string; action: string }[],
    data: {
      invoice_id: invoice,
      client_id: client,
      source_hash: "a".repeat(64),
      balance: {
        obligation_cents: "12500",
        paid_cents: "0",
        refunded_cents: "0",
        net_cash_cents: "0",
        outstanding_cents: "12500",
        pending_refund_cents: "0",
        refundable_cents: "0",
      },
      attempts: [],
      payments: [],
      refund_requests: [],
      reconciliation_observations: [],
    } as PaymentState,
  };
  await page.route(`${backend}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/payment_provider_profiles"))
      return route.fulfill({
        json: state.profile
          ? [
              {
                account_id: "acct_synthetic",
                livemode: false,
                return_origin: "https://thelivingroom.vet",
              },
            ]
          : [],
      });
    if (path.endsWith("/read_invoice_payment_state"))
      return route.fulfill({ json: state.data });
    if (path.endsWith("/prepare_invoice_checkout")) {
      const args = route.request().postDataJSON() as CheckoutArgs;
      state.prepares.push(args);
      if (state.losePrepare === "before") {
        state.losePrepare = "none";
        return route.abort("connectionfailed");
      }
      let row = state.data.attempts.find((a) => a.id === args.p_request_id);
      if (!row) {
        row = {
          id: args.p_request_id,
          invoice_id: invoice,
          client_id: client,
          actor_id: actor,
          source_hash: args.p_source_hash,
          amount_cents: String(args.p_amount_cents),
          created_at: new Date().toISOString(),
          state: "prepared",
        };
        state.data.attempts.push(row);
      }
      if (state.losePrepare === "after") {
        state.losePrepare = "none";
        return route.abort("connectionfailed");
      }
      return route.fulfill({
        json: { ...row, amount_cents: Number(row.amount_cents) },
      });
    }
    if (path.endsWith("/prepare_invoice_refund")) {
      const args = route.request().postDataJSON() as RefundArgs;
      state.refunds.push(args);
      let row = state.data.refund_requests.find(
        (r) => r.id === args.p_request_id,
      );
      if (!row) {
        row = {
          id: args.p_request_id,
          invoice_id: invoice,
          payment_id: args.p_payment_id,
          actor_id: actor,
          amount_cents: String(args.p_amount_cents),
          reason: args.p_reason,
          created_at: new Date().toISOString(),
          state: "pending",
        };
        state.data.refund_requests.push(row);
        state.data.balance.pending_refund_cents = String(args.p_amount_cents);
        state.data.balance.refundable_cents = String(
          BigInt(state.data.balance.refundable_cents) -
            BigInt(args.p_amount_cents),
        );
      }
      return route.fulfill({
        json: { ...row, amount_cents: Number(row.amount_cents) },
      });
    }
    if (path.endsWith("/invoice-checkout")) {
      const args = route.request().postDataJSON();
      state.providerCalls.push(args);
      if (state.disabled)
        return route.fulfill({
          status: 503,
          json: { error: "payments_disabled" },
        });
      const row = state.data.attempts.find((a) => a.id === args.p_request_id)!;
      row.state = args.action === "expire" ? "expired" : state.checkoutState;
      if (state.loseProvider) {
        state.loseProvider = false;
        return route.abort("connectionfailed");
      }
      return route.fulfill({
        json: {
          state: row.state === "open" ? "session_open" : row.state,
          client_url:
            row.state === "open"
              ? "https://checkout.stripe.com/c/pay/cs_test_synthetic#memory-only"
              : null,
        },
      });
    }
    if (path.endsWith("/invoice-refund")) {
      const args = route.request().postDataJSON();
      state.providerCalls.push(args);
      const row = state.data.refund_requests.find(
        (r) => r.id === args.p_request_id,
      )!;
      row.state = state.refundStatus;
      if (row.state === "succeeded") {
        state.data.balance.refunded_cents = row.amount_cents;
        state.data.balance.net_cash_cents = String(
          BigInt(state.data.balance.paid_cents) - BigInt(row.amount_cents),
        );
        state.data.balance.pending_refund_cents = "0";
      }
      return route.fulfill({ json: { state: row.state } });
    }
    return route.fallback();
  });
  const panel = page.getByRole("region", {
    name: "Invoice payments",
    exact: true,
  });
  await panel
    .getByRole("button", { name: "Recover recorded payment state" })
    .click();
  await expect(
    panel.getByText("Stripe test mode — simulated money", { exact: true }),
  ).toBeVisible();
  return { state, panel };
}
export async function reopenPayment(page: Page) {
  await page.reload();
  await page
    .getByRole("button", { name: /issued.*125.00/ })
    .first()
    .click();
  return page.getByRole("region", { name: "Invoice payments", exact: true });
}
