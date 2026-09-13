import { test, expect, type Page } from "@playwright/test";
import type { CollectionIntent } from "../src/hub/features/payments/PaymentCollectionState";
import { createHash } from "node:crypto";
import { paymentFixture, reopenPayment } from "./payment-fixture";
import { actor, client, invoice, backend } from "./invoice-email-fixture";
async function setup(page: Page, baseURL: string | undefined) {
  const payment = await paymentFixture(page, baseURL);
  const state = {
    rows: [] as Array<{
      grant: { id: string; state: string };
      capture: { context_hash: string };
    }>,
    prepares: [] as CollectionIntent[],
    attests: [] as Record<string, unknown>[],
    revokes: [] as Record<string, unknown>[],
    loss: "none",
    recoverFail: false,
  };
  await page.route(`${backend}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/list_payment_collections"))
      return route.fulfill({ json: state.rows });
    if (path.endsWith("/recover-payment-collection")) {
      if (state.recoverFail) return route.abort("connectionfailed");
      const a = route.request().postDataJSON();
      return route.fulfill({
        contentType: "application/json",
        json:
          state.rows.find(
            (r) => !a.p_request_id || r.grant.id === a.p_request_id,
          ) ?? null,
      });
    }
    if (path.endsWith("/prepare-payment-collection")) {
      const a = route.request().postDataJSON();
      state.prepares.push(a);
      if (state.loss === "before") {
        state.loss = "none";
        return route.abort("connectionfailed");
      }
      let row = state.rows.find((r) => r.grant.id === a.p_request_id);
      if (!row) {
        const grant = {
          id: a.p_request_id,
          invoice_id: invoice,
          client_id: client,
          actor_id: actor,
          source_hash: a.p_source_hash,
          amount_cents: String(a.p_amount_cents),
          currency: "usd",
          created_at: new Date().toISOString(),
          expires_at: a.p_expires_at,
          status_expires_at: new Date(
            Date.parse(a.p_expires_at) + 30 * 86400000,
          ).toISOString(),
        };
        const capability_context = JSON.stringify({
          domain: "lrv-payment-collection/v2",
          context_version: 2,
          origin: "https://thelivingroom.vet",
          key_version: "first",
          grant,
        });
        row = {
          grant: { ...grant, state: "captured" },
          capture: {
            grant_id: grant.id,
            context_version: 2,
            origin: "https://thelivingroom.vet",
            key_version: "first",
            capability_context,
            context_hash: createHash("sha256")
              .update(capability_context)
              .digest("hex"),
          },
          events: [],
          attempts: [],
          receipt: null,
        };
        state.rows.unshift(row);
      }
      if (state.loss === "after") {
        state.loss = "none";
        return route.abort("connectionfailed");
      }
      return route.fulfill({ json: row });
    }
    if (path.endsWith("/attest_payment_collection")) {
      const a = route.request().postDataJSON();
      state.attests.push(a);
      const row = state.rows.find((r) => r.grant.id === a.p_request_id)!;
      row.grant.state = "reviewed";
      if (state.loss === "attest") {
        state.loss = "none";
        return route.abort("connectionfailed");
      }
      return route.fulfill({ json: row });
    }
    if (path.endsWith("/revoke_payment_collection")) {
      const a = route.request().postDataJSON();
      state.revokes.push(a);
      const row = state.rows.find((r) => r.grant.id === a.p_request_id)!;
      row.grant.state = "revoked";
      return route.fulfill({ json: row });
    }
    return route.fallback();
  });
  const panel = page.getByRole("region", {
    name: "Client payment access",
    exact: true,
  });
  await panel
    .getByRole("button", { name: "Recover payment access and refresh balance" })
    .click();
  await expect(
    panel.getByRole("button", { name: "Prepare payment access", exact: true }),
  ).toBeEnabled();
  return { panel, state, payment };
}
for (const loss of ["before", "after"])
  test(`payment access ${loss} lost preparation retains original amount and expiry`, async ({
    page,
    baseURL,
  }) => {
    const { panel, state, payment } = await setup(page, baseURL);
    state.loss = loss;
    state.recoverFail = loss === "after";
    await panel
      .getByRole("button", { name: "Prepare payment access", exact: true })
      .click();
    if (loss === "before") {
      await expect(
        panel.getByRole("button", {
          name: "Retry same payment access preparation",
        }),
      ).toBeEnabled();
      await reopenPayment(page);
      await panel
        .getByRole("button", { name: "Retry same payment access preparation" })
        .click();
    } else {
      await expect(panel.getByText(/last response is uncertain/)).toBeVisible();
      await expect(
        page.getByRole("button", { name: /issued.*125.00/ }).last(),
      ).toBeDisabled();
      state.recoverFail = false;
      await panel
        .getByRole("button", {
          name: "Recover payment access and refresh balance",
        })
        .click();
    }
    await expect(
      panel.getByRole("heading", { name: "Saved access: captured" }),
    ).toBeVisible();
    expect(new Set(state.prepares.map((a) => a.p_request_id)).size).toBe(1);
    expect(new Set(state.prepares.map((a) => a.p_expires_at)).size).toBe(1);
    expect(payment.state.providerCalls).toHaveLength(0);
    const saved = await page.evaluate(() => JSON.stringify(sessionStorage));
    expect(saved).not.toContain("capability_context");
    expect(saved).not.toContain("p1.");
    await panel.getByRole("checkbox").check();
    await expect(
      payment.panel.getByRole("button", {
        name: "Prepare $125.00 Checkout",
        exact: true,
      }),
    ).toBeDisabled();
    await panel
      .getByRole("button", { name: "Confirm payment access review" })
      .click();
    await expect.poll(() => state.attests.length).toBe(1);
    expect(state.attests[0]).toEqual({
      p_request_id: state.rows[0].grant.id,
      p_reviewed_context_hash: state.rows[0].capture.context_hash,
      p_attest: true,
    });
    await expect(
      panel.getByText(
        "Review recorded. No payment link has been sent by this panel.",
      ),
    ).toBeVisible();
  });
test("changed invoice blocks review but preserves recovery, history and revocation", async ({
  page,
  baseURL,
}) => {
  const { panel, state, payment } = await setup(page, baseURL);
  await panel
    .getByRole("button", { name: "Prepare payment access", exact: true })
    .click();
  await panel.getByRole("checkbox").check();
  payment.state.data.source_hash = "b".repeat(64);
  await panel
    .getByRole("button", { name: "Confirm payment access review" })
    .click();
  await expect(panel.getByRole("checkbox")).toBeDisabled();
  expect(state.attests).toHaveLength(0);
  await panel
    .getByLabel("Reason for revoking access")
    .fill("Invoice corrected");
  await expect(panel.getByLabel("Your payment access history")).toBeDisabled();
  await panel
    .getByRole("button", { name: "Revoke payment access", exact: true })
    .click();
  await expect(
    panel.getByRole("heading", { name: "Saved access: revoked" }),
  ).toBeVisible();
  expect(state.revokes[0].p_reason).toBe("Invoice corrected");
  await expect(
    panel.getByText(/does not cancel a Stripe Checkout URL already disclosed/),
  ).toBeVisible();
  await reopenPayment(page);
  await panel
    .getByLabel("Your payment access history")
    .selectOption(state.rows[0].grant.id);
  await expect(
    panel.getByRole("heading", { name: "Saved access: revoked" }),
  ).toBeVisible();
});
test("lost review acknowledgement recovers same reviewed grant without sending or paid claims", async ({
  page,
  baseURL,
}) => {
  const { panel, state, payment } = await setup(page, baseURL);
  await panel
    .getByRole("button", { name: "Prepare payment access", exact: true })
    .click();
  await panel.getByRole("checkbox").check();
  state.loss = "attest";
  await panel
    .getByRole("button", { name: "Confirm payment access review" })
    .click();
  await expect(panel.getByText(/last response is uncertain/)).toBeVisible();
  await panel
    .getByRole("button", { name: "Recover payment access and refresh balance" })
    .click();
  await expect(
    panel.getByRole("heading", { name: "Saved access: reviewed" }),
  ).toBeVisible();
  expect(state.attests).toHaveLength(1);
  expect(payment.state.providerCalls).toHaveLength(0);
  await expect(panel.getByRole("link")).toHaveCount(0);
});
test("resolved reconciliation history permits access while new unresolved evidence blocks both controls", async ({
  page,
  baseURL,
}) => {
  const { panel, payment } = await setup(page, baseURL);
  payment.state.data.reconciliation_observations = [
    {
      id: "77777777-7777-4777-8777-777777777777",
      family: "checkout",
      request_id: "88888888-8888-4888-8888-888888888888",
      reason: "provider evidence reviewed",
      created_at: new Date().toISOString(),
      resolved: true,
    },
  ];
  await panel
    .getByRole("button", { name: "Recover payment access and refresh balance" })
    .click();
  await expect(
    panel.getByRole("button", { name: "Prepare payment access", exact: true }),
  ).toBeEnabled();
  await payment.panel
    .getByRole("button", { name: "Recover recorded payment state" })
    .click();
  await expect(
    payment.panel.getByText(/review resolved \(history\)/),
  ).toBeVisible();
  await expect(
    payment.panel.getByText(/Payment reconciliation is required/),
  ).toHaveCount(0);
  payment.state.data.reconciliation_observations.push({
    ...payment.state.data.reconciliation_observations[0],
    id: "99999999-9999-4999-8999-999999999999",
    resolved: false,
  });
  await panel
    .getByRole("button", { name: "Recover payment access and refresh balance" })
    .click();
  await expect(
    panel.getByRole("button", { name: "Prepare payment access", exact: true }),
  ).toBeDisabled();
  await payment.panel
    .getByRole("button", { name: "Recover recorded payment state" })
    .click();
  await expect(
    payment.panel.getByText(/Payment reconciliation is required/),
  ).toBeVisible();
});
