import {test} from "node:test";
import assert from "node:assert/strict";
import {processStripeEvent} from "../../supabase/functions/_shared/stripe-event-worker.ts";
import type {StripeEventWorkerDependencies, StripeEventLease} from "../../supabase/functions/_shared/stripe-event-worker.ts";
import type {CheckoutIntent} from "../../supabase/functions/_shared/stripe-provider.ts";
const id = "10000000-0000-4000-8000-000000000001";
const intent: CheckoutIntent = {id, amount_cents: "5000", source_hash: "a".repeat(64), account_id: "acct_fixture", livemode: false, currency: "usd", success_url: "https://thelivingroom.vet/payment/return", cancel_url: "https://thelivingroom.vet/payment/cancel", idempotency_key: "checkout:stable-request", session_expires_at: "2026-09-13T05:00:00Z", retry_before: "2026-09-14T02:00:00Z"};
const lease: StripeEventLease = {receipt: {id: "receipt", event_id: "evt_fixture", event_type: "checkout.session.expired", provider_created_at: 1800000000, account_id: "acct_fixture", livemode: false, object_id: "cs_test_fixture", request_id: id, raw_sha256: "b".repeat(64), disposition: "queued", reason: ""}, lease_token: "lease", lease_expires_at: "2026-09-13T05:02:00Z", attempt_count: 1};
function value() {return {id: "cs_test_fixture", object: "checkout.session", mode: "payment", livemode: false, amount_total: 5000, currency: "usd", client_reference_id: id, metadata: {request_id: id, source_hash: intent.source_hash}, expires_at: Date.parse(intent.session_expires_at)/1000, invoice: null, recovered_from: null, status: "complete", payment_status: "paid", payment_intent: "pi_fixture", url: null};}
function setup(patch: Partial<StripeEventWorkerDependencies> = {}) {
 const completions: Record<string,unknown>[] = []; const retries: string[] = [];
 const deps: StripeEventWorkerDependencies = {claim: async () => lease, checkoutContext: async () => intent, refundContext: async () => {throw new Error("unused");}, retrieveCheckout: async () => value(), retrieveRefund: async () => {throw new Error("unused");}, finish: async (receipt, token, evidence) => {assert.equal(receipt, "receipt"); assert.equal(token, "lease"); completions.push(evidence);}, retry: async (_receipt,_token,reason) => {retries.push(reason);}, ...patch};
 return {deps,completions,retries};
}
test("worker retrieves current paid state even when delivered event says expired", async () => {
 const {deps,completions} = setup(); assert.equal(await processStripeEvent(deps), "finished");
 assert.equal(completions[0].kind, "payment_succeeded"); assert.equal(completions[0].payment_id, "pi_fixture"); assert.equal("client_url" in completions[0], false);
});
test("worker quarantines object and account mismatches without applying cash", async () => {
 for(const patch of [{checkoutContext: async () => ({...intent, account_id: "acct_other"})}, {retrieveCheckout: async () => ({...value(), amount_total: 5})}, {retrieveCheckout: async () => ({...value(), id: "cs_test_other"})}]) {
  const {deps,completions} = setup(patch); await processStripeEvent(deps); assert.equal(completions[0].family, "quarantine");
 }
});
test("provider failure retries and lost completion acknowledgement stays uncertain", async () => {
 const {deps,retries,completions} = setup({retrieveCheckout: async () => {throw new Error("private provider message");}});
 assert.equal(await processStripeEvent(deps), "retry"); assert.deepEqual(retries, ["provider_unavailable"]); assert.equal(completions.length, 0);
 const lost = setup({finish: async () => {throw new Error("lost acknowledgement");}}); assert.equal(await processStripeEvent(lost.deps), "uncertain"); assert.equal(lost.retries.length, 0);
});
test("no claim performs no provider work", async () => {
 const {deps} = setup({claim: async () => null, retrieveCheckout: async () => {throw new Error("must not call");}}); assert.equal(await processStripeEvent(deps), "empty");
});
