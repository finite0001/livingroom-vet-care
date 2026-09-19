import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createStripeWebhookHandler } from "../../supabase/functions/_shared/stripe-webhook.ts";
import type { StripeWebhookReceipt } from "../../supabase/functions/_shared/stripe-webhook.ts";
import { STRIPE_API_VERSION } from "../../supabase/functions/_shared/stripe-provider.ts";
const now = 1800000000000, secret = "whsec_fixture";
function event() { return {id: "evt_fixture", object: "event", type: "checkout.session.completed", api_version: STRIPE_API_VERSION, created: now/1000, livemode: false,
  data: {object: {object: "checkout.session", id: "cs_test_fixture", metadata: {request_id: "10000000-0000-4000-8000-000000000001"}, customer_details: {email: "private@example.test"}, url: "https://checkout.stripe.com/c/pay/private"}}}; }
function request(value: unknown, valid = true) {
  const body = JSON.stringify(value), timestamp = String(now/1000);
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return new Request("https://example.test/stripe-webhook", {method: "POST", body, headers: {"stripe-signature": `t=${timestamp},v1=${valid ? signature : "0".repeat(64)}`}});
}
function setup(fail = false) {
  const receipts: StripeWebhookReceipt[] = [];
  const handler = createStripeWebhookHandler({enabled: true, signingSecret: secret, accountId: "acct_fixture", livemode: false, now: () => now, receive: async receipt => {if(fail) throw new Error("private database failure"); receipts.push(receipt);}});
  return {handler, receipts};
}
test("valid events are durably received with no full customer or checkout payload", async () => {
  const {handler, receipts} = setup(); assert.equal((await handler(request(event()))).status, 200);
  assert.equal(receipts.length, 1); assert.equal(receipts[0].disposition, "queued");
  assert.equal(receipts[0].raw_sha256.length, 64);
  assert.equal(JSON.stringify(receipts).includes("private"), false);
  assert.equal(receipts[0].object_id, "cs_test_fixture");
});
test("signature forgery and malformed signed envelopes never reach storage", async () => {
  const {handler, receipts} = setup();
  assert.equal((await handler(request(event(), false))).status, 400);
  assert.equal((await handler(request({...event(), id: "secret invalid value"}))).status, 400);
  assert.equal(receipts.length, 0);
});
test("receipt storage failure is retryable and cannot acknowledge event", async () => {
  const {handler} = setup(true); const result = await handler(request(event()));
  assert.equal(result.status, 503); assert.equal(await result.text(), "");
});
test("wrong account, mode, API version and unattributed objects enter quarantine", async () => {
  const {handler, receipts} = setup();
  for (const patch of [{account: "acct_other"}, {livemode: true}, {api_version: "old"}, {data: {object: {object: "checkout.session", id: "cs_test_other", metadata: {}}}}]) {
    assert.equal((await handler(request({...event(), ...patch}))).status, 200);
  }
  assert.ok(receipts.every(receipt => receipt.disposition === "quarantined"));
});
test("external adjustments require review while unrelated events cannot affect balance", async () => {
  const {handler, receipts} = setup();
  await handler(request({...event(), type: "charge.dispute.created"}));
  await handler(request({...event(), type: "customer.created"}));
  assert.equal(receipts[0].disposition, "quarantined"); assert.equal(receipts[1].disposition, "ignored");
});
test("disabled receiver never consumes or persists an event", async () => {
  let called = false;
  const handler = createStripeWebhookHandler({enabled: false, signingSecret: secret, accountId: "acct_fixture", livemode: false, receive: async () => {called = true;}});
  assert.equal((await handler(request(event()))).status, 503); assert.equal(called, false);
});
