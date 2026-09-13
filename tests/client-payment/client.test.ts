import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fetchPayment,
  parsePaymentStatus,
  paymentRoute,
  paymentMoney,
  safeCheckoutUrl,
  validPaymentAccess,
  type PaymentAccess,
} from "../../src/shared/payment-client.ts";
const id = "12345678-1234-4234-8234-123456789012",
  access: PaymentAccess = {
    kind: "collection",
    grantId: id,
    token: "p1." + "a".repeat(43),
    returnKind: null,
  };
const details = {
  state: "ready",
  amount_cents: "12500",
  currency: "usd",
  expires_at: "2099-01-01T00:00:00Z",
  status_expires_at: "2099-01-31T00:00:00Z",
  confirmed_paid_cents: "0",
  confirmed_refunded_cents: "0",
  collection_available: true,
};
test("isolated routes never convert return navigation to confirmation or accept the wrong capability family", () => {
  assert.equal(paymentRoute("/payment/return", "#paid=true")?.kind, "neutral");
  assert.equal(
    paymentRoute("/payment/cancel", "#s1." + "a".repeat(43))?.token,
    "",
  );
  assert.equal(paymentRoute("/hub/invoices", "#token"), null);
  assert.ok(validPaymentAccess(access));
  assert.equal(
    validPaymentAccess({ ...access, token: "s1." + "a".repeat(43) }),
    false,
  );
  assert.equal(
    validPaymentAccess({ ...access, grantId: id + "/other" }),
    false,
  );
});
test("USD strings retain exact cents without floating-point conversion", () => {
  assert.equal(
    paymentMoney("9007199254740993123"),
    "$90,071,992,547,409,931.23",
  );
  for (const amount of [12500, "12.50", "-1", "1e4", "00"])
    assert.throws(() =>
      parsePaymentStatus({ ...details, amount_cents: amount }, "inspect"),
    );
});
test("scoped responses reject identifiers, patient details, unknown currency and unexpected Checkout URLs", () => {
  assert.equal(parsePaymentStatus(details, "inspect").state, "ready");
  for (const change of [
    { invoice_id: id },
    { patient_name: "Synthetic" },
    { currency: "eur" },
    { checkout_url: "https://checkout.stripe.com/c/pay/x" },
    { collection_available: undefined },
  ])
    assert.throws(() =>
      parsePaymentStatus({ ...details, ...change }, "inspect"),
    );
  const { collection_available: _available, ...status } = details;
  assert.equal(parsePaymentStatus(status, "status").state, "ready");
  assert.throws(() => parsePaymentStatus(details, "status"));
});
test("confirmed refund states cannot contradict cash evidence", () => {
  assert.throws(() =>
    parsePaymentStatus({ ...details, state: "paid" }, "inspect"),
  );
  assert.equal(
    parsePaymentStatus(
      {
        ...details,
        state: "partially_refunded",
        confirmed_paid_cents: "12500",
        confirmed_refunded_cents: "2500",
      },
      "inspect",
    ).state,
    "partially_refunded",
  );
  assert.throws(() =>
    parsePaymentStatus(
      {
        ...details,
        state: "refunded",
        confirmed_paid_cents: "12500",
        confirmed_refunded_cents: "2500",
      },
      "inspect",
    ),
  );
  assert.throws(() =>
    parsePaymentStatus(
      {
        ...details,
        confirmed_paid_cents: "100",
        confirmed_refunded_cents: "101",
      },
      "inspect",
    ),
  );
});
test("activation URLs require explicit availability and exact Stripe origin/path", () => {
  assert.equal(
    parsePaymentStatus(
      {
        ...details,
        state: "checkout_ready",
        checkout_url: "https://checkout.stripe.com/c/pay/test",
      },
      "activate",
    ).checkout_url,
    "https://checkout.stripe.com/c/pay/test",
  );
  assert.throws(() =>
    parsePaymentStatus(
      {
        ...details,
        state: "checkout_ready",
        collection_available: false,
        checkout_url: "https://checkout.stripe.com/c/pay/test",
      },
      "activate",
    ),
  );
  for (const url of [
    "https://checkout.stripe.com.evil.test/c/pay/a",
    "https://u@checkout.stripe.com/c/pay/a",
    "javascript:alert(1)",
    "https://checkout.stripe.com/pay/a",
  ])
    assert.throws(() => safeCheckoutUrl(url));
});
test("requests omit ambient identity and forbid redirects; malformed or oversized payloads fail closed", async () => {
  const original = globalThis.fetch;
  let options: RequestInit | undefined;
  try {
    globalThis.fetch = async (_url, init) => {
      options = init;
      return new Response(JSON.stringify(details), {
        headers: { "content-type": "application/json" },
      });
    };
    assert.equal(
      (
        await fetchPayment(
          access,
          "inspect",
          new AbortController().signal,
          "https://example.test",
        )
      ).state,
      "ready",
    );
    assert.equal(options?.credentials, "omit");
    assert.equal(options?.cache, "no-store");
    assert.equal(options?.redirect, "error");
    assert.equal(options?.referrerPolicy, "no-referrer");
    assert.deepEqual(JSON.parse(options?.body as string), {
      grant_id: id,
      token: access.token,
      action: "inspect",
    });
    globalThis.fetch = async () =>
      new Response("x".repeat(17000), {
        headers: { "content-type": "application/json" },
      });
    await assert.rejects(() =>
      fetchPayment(
        access,
        "inspect",
        new AbortController().signal,
        "https://example.test",
      ),
    );
    globalThis.fetch = async () =>
      new Response("{}", { headers: { "content-type": "text/html" } });
    await assert.rejects(() =>
      fetchPayment(
        access,
        "inspect",
        new AbortController().signal,
        "https://example.test",
      ),
    );
    globalThis.fetch = async () =>
      new Response("{}", {
        status: 503,
        headers: { "content-type": "application/json" },
      });
    await assert.rejects(() =>
      fetchPayment(
        access,
        "inspect",
        new AbortController().signal,
        "https://example.test",
      ),
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("requested amount bounds and payment labels require sufficient confirmed cash", () => {
  for (const amount of ["0", "49", "100000000"])
    assert.throws(() =>
      parsePaymentStatus({ ...details, amount_cents: amount }, "inspect"),
    );
  for (const amount of ["50", "99999999"])
    assert.equal(
      parsePaymentStatus({ ...details, amount_cents: amount }, "inspect")
        .amount_cents,
      amount,
    );
  assert.throws(() =>
    parsePaymentStatus(
      {
        ...details,
        state: "paid",
        amount_cents: "10000",
        confirmed_paid_cents: "1",
      },
      "inspect",
    ),
  );
  assert.equal(
    parsePaymentStatus(
      { ...details, state: "paid", confirmed_paid_cents: "12500" },
      "inspect",
    ).state,
    "paid",
  );
  assert.equal(
    parsePaymentStatus(
      { ...details, state: "paid", confirmed_paid_cents: "15000" },
      "inspect",
    ).state,
    "paid",
  );
  for (const state of ["partially_refunded", "refunded"])
    assert.throws(() =>
      parsePaymentStatus(
        {
          ...details,
          state,
          confirmed_paid_cents: "100",
          confirmed_refunded_cents: state === "refunded" ? "100" : "50",
        },
        "inspect",
      ),
    );
  for (const cash of [
    { confirmed_paid_cents: "1", confirmed_refunded_cents: "0" },
    { confirmed_paid_cents: "1", confirmed_refunded_cents: "1" },
  ])
    assert.throws(() =>
      parsePaymentStatus(
        {
          ...details,
          ...cash,
          state: "checkout_ready",
          checkout_url: "https://checkout.stripe.com/c/pay/test",
        },
        "activate",
      ),
    );
});
