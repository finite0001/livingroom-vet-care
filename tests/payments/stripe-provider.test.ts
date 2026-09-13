import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createStripeProvider, verifyStripeSignature, StripeBoundaryError, STRIPE_API_VERSION } from "../../supabase/functions/_shared/stripe-provider.ts";
import type { CheckoutIntent } from "../../supabase/functions/_shared/stripe-provider.ts";
const now = Date.parse("2026-09-13T03:00:00Z");
const env = { STRIPE_PAYMENTS_ENABLED: "true", STRIPE_SECRET_KEY: "sk_test_fixture", STRIPE_ACCOUNT_ID: "acct_fixture", STRIPE_LIVEMODE: "false", STRIPE_RETURN_ORIGIN: "https://thelivingroom.vet" };
const intent: CheckoutIntent = {
  id: "10000000-0000-4000-8000-000000000001", source_hash: "a".repeat(64), amount_cents: "12500", currency: "usd",
  account_id: "acct_fixture", livemode: false, success_url: "https://thelivingroom.vet/payment/return", cancel_url: "https://thelivingroom.vet/payment/cancel",
  idempotency_key: "checkout:10000000-0000-4000-8000-000000000001", session_expires_at: new Date(now + 7200000).toISOString(), retry_before: new Date(now + 82800000).toISOString(),
};
const code = (expected: string) => (error: unknown) => error instanceof StripeBoundaryError && error.code === expected;
function mock(account = "acct_fixture", mutate: () => Response | Promise<Response> = () => Response.json({ id: "cs_test_fixture" })) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init: init! });
    return String(url).endsWith("/account") ? Response.json({ id: account, object: "account" }) : mutate();
  };
  return { calls, fetcher };
}
test("disabled and wrong-mode credentials fail before a network request", () => {
  assert.throws(() => createStripeProvider({ ...env, STRIPE_PAYMENTS_ENABLED: undefined }), code("disabled"));
  assert.throws(() => createStripeProvider({ ...env, STRIPE_SECRET_KEY: "sk_live_fixture" }), code("configuration"));
  assert.throws(() => createStripeProvider({ ...env, STRIPE_RETURN_ORIGIN: "https://user:pass@thelivingroom.vet" }), code("configuration"));
});
test("fixed collection request has no clinical data, identical retries and pinned API", async () => {
  const { fetcher, calls } = mock();
  const provider = createStripeProvider(env, fetcher, () => now);
  await provider.createCheckout(intent); await provider.createCheckout(intent);
  const post = calls[1]; const body = post.init.body as URLSearchParams;
  assert.equal(post.url, "https://api.stripe.com/v1/checkout/sessions");
  assert.equal(body.get("line_items[0][price_data][unit_amount]"), "12500");
  assert.equal(body.get("payment_method_types[0]"), "card");
  assert.equal(body.get("adaptive_pricing[enabled]"), "false");
  assert.equal(body.get("after_expiration[recovery][enabled]"), "false");
  assert.equal(body.get("invoice_creation[enabled]"), "false");
  assert.equal(body.get("customer_email"), null);
  assert.equal(body.toString(), String(calls[3].init.body));
  assert.equal(new Headers(post.init.headers).get("Stripe-Version"), STRIPE_API_VERSION);
  assert.equal(new Headers(post.init.headers).get("Idempotency-Key"), intent.idempotency_key);
  assert.equal(post.init.redirect, "error");
});
test("account mismatch cannot reach mutation", async () => {
  const { fetcher, calls } = mock("acct_unrelated");
  await assert.rejects(createStripeProvider(env, fetcher, () => now).createCheckout(intent), code("configuration"));
  assert.equal(calls.length, 1);
});
test("invalid amount, origin, mode, identity, currency and return parameters cannot reach network", async () => {
  const { fetcher, calls } = mock(); const provider = createStripeProvider(env, fetcher, () => now);
  for (const patch of [{amount_cents: "12.5"}, {amount_cents: "999999999999999999999"}, {amount_cents: "49"}, {success_url: "https://evil.example/payment/return"}, {success_url: intent.success_url + "?invoice=123"}, {cancel_url: intent.cancel_url + "#private"}, {livemode: true}, {currency: "eur"}, {id: "private patient name"}, {source_hash: "oops"}]) {
    await assert.rejects(provider.createCheckout({...intent, ...patch}), code("intent"));
  }
  assert.equal(calls.length, 0);
});
test("old keys and near expiry attempts require reconciliation without POST", async () => {
  const { fetcher, calls } = mock(); const provider = createStripeProvider(env, fetcher, () => now);
  for (const patch of [{retry_before: new Date(now).toISOString()}, {session_expires_at: new Date(now + 1800000).toISOString()}, {session_expires_at: "invalid"}]) {
    await assert.rejects(provider.createCheckout({...intent, ...patch}), code("reconcile"));
  }
  assert.equal(calls.length, 0);
});
test("slow account verification cannot carry a creation past the expiry margin", async () => {
  let clock = now; const { fetcher, calls } = mock();
  const slow: typeof fetch = async (...args) => { const result = await fetcher(...args); clock += 7200000; return result; };
  await assert.rejects(createStripeProvider(env, slow, () => clock).createCheckout(intent), code("reconcile"));
  assert.equal(calls.length, 1);
});
test("transport failures and malformed/rejected mutation responses stay ambiguous with no automatic retries or provider detail leakage", async () => {
  for (const mutation of [() => { throw new Error("secret provider body"); }, () => new Response("secret provider body", {status: 500}), () => new Response("not JSON"), () => new Response("x".repeat(262145))]) {
    const { fetcher, calls } = mock("acct_fixture", mutation);
    await assert.rejects(createStripeProvider(env, fetcher, () => now).createCheckout(intent), code("ambiguous"));
    assert.equal(calls.length, 2);
  }
});
test("retrieve and expire reject injected object paths and verify expected account", async () => {
  const { fetcher, calls } = mock(); const provider = createStripeProvider(env, fetcher, () => now);
  await assert.rejects(provider.retrieveCheckout("../customers"), code("intent"));
  await assert.rejects(provider.expireCheckout("cs_test_ok", "short"), code("intent"));
  assert.equal(calls.length, 0);
  await provider.retrieveCheckout("cs_test_fixture");
  await provider.expireCheckout("cs_test_fixture", "expire:stable-request-uuid");
  assert.equal(calls[1].init.method, "GET");
  assert.equal(calls[3].url, "https://api.stripe.com/v1/checkout/sessions/cs_test_fixture/expire");
});
const secret = "whsec_fixture";
const raw = new TextEncoder().encode('{"id":"evt_fixture", "livemode":false}');
const timestamp = String(now / 1000);
function signature(bytes = raw, time = timestamp) { return createHmac("sha256", secret).update(`${time}.`).update(bytes).digest("hex"); }
test("signature validates exact raw bytes and permits signing-secret rotation", async () => {
  await verifyStripeSignature(raw, `t=${timestamp},v1=${"0".repeat(64)},v1=${signature()}`, secret, now);
  await assert.rejects(verifyStripeSignature(new TextEncoder().encode('{"id":"evt_fixture","livemode":false}'), `t=${timestamp},v1=${signature()}`, secret, now), code("signature"));
});
test("signature rejects stale/future/duplicate timestamps and forged or oversized payloads", async () => {
  for (const header of [null, `t=${timestamp},v1=${"0".repeat(64)}`, `t=${timestamp},t=${timestamp},v1=${signature()}`, `t=${Number(timestamp)-301},v1=${signature(raw,String(Number(timestamp)-301))}`, `t=${Number(timestamp)+301},v1=${signature(raw,String(Number(timestamp)+301))}`]) {
    await assert.rejects(verifyStripeSignature(raw, header, secret, now), code("signature"));
  }
  await assert.rejects(verifyStripeSignature(new Uint8Array(262145), `t=${timestamp},v1=${signature()}`, secret, now), code("signature"));
});

import { checkoutEvidence } from "../../supabase/functions/_shared/stripe-provider.ts";
function session() { return {
  object: "checkout.session", id: "cs_test_fixture", livemode: false, mode: "payment", currency: "usd", amount_total: 12500,
  client_reference_id: intent.id, metadata: {request_id: intent.id, source_hash: intent.source_hash},
  expires_at: Date.parse(intent.session_expires_at) / 1000, invoice: null, recovered_from: null,
  status: "open", payment_status: "unpaid", payment_intent: null, url: "https://checkout.stripe.com/c/pay/cs_test_fixture#private",
  customer_details: {email: "private@example.test"},
}; }
test("normalized evidence excludes customer data; success requires provider-paid session and payment identity", () => {
  const open = checkoutEvidence(session(), intent);
  assert.equal(open.state, "session_open");
  assert.equal(JSON.stringify(open).includes("private@example.test"), false);
  assert.equal(checkoutEvidence({...session(), status: "complete", payment_status: "paid", payment_intent: "pi_fixture", url: null}, intent).state, "payment_succeeded");
  assert.equal(checkoutEvidence({...session(), status: "complete", payment_status: "unpaid"}, intent).state, "reconciliation");
  assert.equal(checkoutEvidence({...session(), status: "complete", payment_status: "paid"}, intent).state, "reconciliation");
  const expired = checkoutEvidence({...session(), status: "expired", url: null}, intent);
  assert.equal(expired.state, "session_expired"); assert.equal(expired.client_url, null);
});
test("provider evidence mismatches cannot produce accepted state or expose a URL", () => {
  for (const patch of [{livemode: true}, {amount_total: 12499}, {currency: "eur"}, {metadata: {request_id: intent.id, source_hash: "b".repeat(64)}}, {client_reference_id: "other"}, {expires_at: 0}, {invoice: "in_unexpected"}, {recovered_from: "cs_test_other"}, {url: "https://checkout.stripe.com.evil.test/c/pay/test"}, {url: "https://user:pass@checkout.stripe.com/c/pay/test"}]) {
    assert.throws(() => checkoutEvidence({...session(), ...patch}, intent), code("reconcile"));
  }
});

import { refundEvidence } from "../../supabase/functions/_shared/stripe-provider.ts";
import type { RefundIntent } from "../../supabase/functions/_shared/stripe-provider.ts";
const refund: RefundIntent = { id: intent.id, amount_cents: "1", provider_payment_id: "pi_fixture", account_id: "acct_fixture", livemode: false, currency: "usd", idempotency_key: "refund:stable-request-uuid", retry_before: intent.retry_before };
test("refund retries use immutable amount/payment and omit staff clinical reason", async () => {
  const { fetcher, calls } = mock(); const provider = createStripeProvider(env, fetcher, () => now);
  await provider.createRefund(refund); await provider.createRefund(refund);
  assert.equal(calls[1].url, "https://api.stripe.com/v1/refunds");
  assert.equal(String(calls[1].init.body), String(calls[3].init.body));
  const params = calls[1].init.body as URLSearchParams;
  assert.equal(params.get("amount"), "1"); assert.equal(params.get("payment_intent"), "pi_fixture");
  assert.equal(params.get("reason"), null);
  await assert.rejects(provider.createRefund({...refund, retry_before: new Date(now).toISOString()}), code("reconcile"));
  await assert.rejects(provider.createRefund({...refund, amount_cents: "0"}), code("intent"));
  await assert.rejects(provider.createRefund({...refund, livemode: true}), code("intent"));
  assert.equal(calls.length, 4);
});
test("refund evidence distinguishes unsettled money from success and rejects mismatches", () => {
  const value = {object: "refund", id: "re_fixture", payment_intent: "pi_fixture", metadata: {request_id: refund.id}, amount: 1, currency: "usd", status: "pending"};
  assert.equal(refundEvidence(value, refund).status, "pending");
  assert.equal(refundEvidence({...value, status: "requires_action"}, refund).status, "pending");
  assert.equal(refundEvidence({...value, status: "canceled"}, refund).status, "failed");
  assert.equal(refundEvidence({...value, status: "succeeded"}, refund).status, "succeeded");
  for (const patch of [{amount: 2}, {payment_intent: "pi_other"}, {metadata: {request_id: "other"}}, {currency: "eur"}, {status: "unknown"}]) {
    assert.throws(() => refundEvidence({...value, ...patch}, refund), code("reconcile"));
  }
});
