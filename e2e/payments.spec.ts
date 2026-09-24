import { test, expect } from "@playwright/test";
import { paymentFixture, reopenPayment } from "./payment-fixture";
import { invoice } from "./invoice-email-fixture";
for (const loss of ["none", "before", "after"] as const)
  test(`Checkout ${loss} preparation loss keeps exact intent and provider action explicit`, async ({
    page,
    baseURL,
  }) => {
    const { state, panel } = await paymentFixture(page, baseURL);
    state.losePrepare = loss;
    await panel.getByRole("checkbox").check();
    await expect(
      page.getByRole("button", { name: /issued.*125.00/ }).last(),
    ).toBeDisabled();
    await panel
      .getByRole("button", { name: "Prepare $125.00 Checkout", exact: true })
      .click();
    if (loss === "before") {
      await expect(
        panel.getByRole("button", { name: "Retry same payment preparation" }),
      ).toBeEnabled();
      await reopenPayment(page);
      await panel
        .getByRole("button", { name: "Retry same payment preparation" })
        .click();
    }
    await expect(
      panel.getByText("Saved Checkout: $125.00 · prepared", { exact: true }),
    ).toBeVisible();
    expect(state.providerCalls).toHaveLength(0);
    expect(new Set(state.prepares.map((a) => a.p_request_id)).size).toBe(1);
    if (loss === "after") {
      await reopenPayment(page);
      await panel.getByRole("button", { name: /125.00.*prepared/ }).click();
    }
    await panel.getByRole("checkbox").check();
    state.loseProvider = true;
    await panel
      .getByRole("button", {
        name: "Create or recover this same Stripe Checkout",
      })
      .click();
    await expect(panel.getByText(/Stripe response is uncertain/)).toBeVisible();
    await expect(
      panel.getByRole("link", { name: "Open Stripe Checkout" }),
    ).toHaveCount(0);
    await panel.getByRole("checkbox").check();
    await panel
      .getByRole("button", {
        name: "Create or recover this same Stripe Checkout",
      })
      .click();
    await expect(
      panel.getByRole("link", { name: "Open Stripe Checkout" }),
    ).toHaveAttribute(
      "href",
      "https://checkout.stripe.com/c/pay/cs_test_synthetic#memory-only",
    );
    expect(new Set(state.providerCalls.map((a) => a.p_request_id)).size).toBe(
      1,
    );
    const storage = await page.evaluate(() =>
      JSON.stringify({ local: localStorage, session: sessionStorage }),
    );
    expect(storage).not.toContain("checkout.stripe.com");
    expect(storage).not.toContain("memory-only");
    await panel.getByRole("checkbox").check();
    await panel
      .getByRole("button", { name: "Expire this Stripe Checkout" })
      .click();
    await expect(
      panel.getByText("Saved Checkout: $125.00 · expired", { exact: true }),
    ).toBeVisible();
    await expect(
      panel.getByRole("link", { name: "Open Stripe Checkout" }),
    ).toHaveCount(0);
  });
test("refund requires credited cash and reserves it before an explicit Stripe submission", async ({
  page,
  baseURL,
}) => {
  const { state, panel } = await paymentFixture(page, baseURL);
  state.data.balance = {
    obligation_cents: "10000",
    paid_cents: "12500",
    refunded_cents: "0",
    net_cash_cents: "12500",
    outstanding_cents: "0",
    pending_refund_cents: "0",
    refundable_cents: "2500",
  };
  state.data.payments = [
    {
      id: "77777777-7777-4777-8777-777777777777",
      invoice_id: invoice,
      request_id: "88888888-8888-4888-8888-888888888888",
      amount_cents: "12500",
      created_at: new Date().toISOString(),
      payment_id: "pi_synthetic",
    },
  ];
  await panel
    .getByRole("button", { name: "Recover recorded payment state" })
    .click();
  await expect(panel.getByText("$25.00", { exact: true })).toHaveCount(2);
  await panel
    .getByLabel("Captured payment for refund")
    .selectOption(state.data.payments[0].id);
  await panel.getByLabel("Refund amount in dollars").fill("25.00");
  await panel
    .getByLabel("Refund reason")
    .fill("Previously credited service adjustment");
  await panel.getByRole("checkbox").check();
  await panel
    .getByRole("button", { name: "Prepare reviewed refund reservation" })
    .click();
  await expect(
    panel.getByText("Saved refund: $25.00 · pending", { exact: true }),
  ).toBeVisible();
  expect(state.providerCalls).toHaveLength(0);
  await expect(
    panel
      .getByText("Confirmed refunds")
      .locator("xpath=following-sibling::dd[1]"),
  ).toHaveText("$0.00");
  await panel.getByRole("checkbox").check();
  state.refundStatus = "succeeded";
  await panel
    .getByRole("button", { name: "Submit or recover this same Stripe refund" })
    .click();
  await expect(
    panel
      .getByText("Confirmed refunds")
      .locator("xpath=following-sibling::dd[1]"),
  ).toHaveText("$25.00");
  expect(state.refunds[0].p_amount_cents).toBe(2500);
  expect(state.providerCalls).toHaveLength(1);
});
test("empty configuration and provider-disabled responses preserve recorded balances without pretending collection", async ({
  page,
  baseURL,
}) => {
  const { state, panel } = await paymentFixture(page, baseURL);
  state.profile = false;
  await panel
    .getByRole("button", { name: "Recover recorded payment state" })
    .click();
  await expect(panel.getByText(/Stripe setup is required/)).toBeVisible();
  await expect(
    panel.getByRole("button", {
      name: "Prepare $125.00 Checkout",
      exact: true,
    }),
  ).toBeDisabled();
  state.profile = true;
  await panel
    .getByRole("button", { name: "Recover recorded payment state" })
    .click();
  await panel.getByRole("checkbox").check();
  await panel
    .getByRole("button", { name: "Prepare $125.00 Checkout", exact: true })
    .click();
  await expect(
    panel.getByText("Saved Checkout: $125.00 · prepared", { exact: true }),
  ).toBeVisible();
  state.disabled = true;
  await panel.getByRole("checkbox", {
    name: "I reviewed this saved $125.00 Checkout. The next action may create or recover its Stripe payment page.",
    exact: true,
  }).check();
  await panel
    .getByRole("button", {
      name: "Create or recover this same Stripe Checkout",
    })
    .click();
  await expect(
    panel.getByText(/Stripe payments are not enabled/),
  ).toBeVisible();
  await expect(
    panel.getByText("Saved Checkout: $125.00 · prepared", { exact: true }),
  ).toBeVisible();
});
test("reconciliation observations block new collection and refunds without hiding cash", async ({
  page,
  baseURL,
}) => {
  const { state, panel } = await paymentFixture(page, baseURL);
  state.data.reconciliation_observations = [
    {
      id: "review",
      family: "checkout",
      request_id: "request",
      reason: "provider_context_mismatch",
      created_at: new Date().toISOString(),
    },
  ];
  await panel
    .getByRole("button", { name: "Recover recorded payment state" })
    .click();
  await expect(
    panel.getByText(/Payment reconciliation is required/),
  ).toBeVisible();
  await expect(panel.getByRole("checkbox")).toBeDisabled();
  await expect(
    panel.getByText("Outstanding").locator("xpath=following-sibling::dd[1]"),
  ).toHaveText("$125.00");
});
