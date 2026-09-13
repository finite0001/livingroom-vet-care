import { test } from "node:test";
import assert from "node:assert/strict";
import {createStripeCheckoutHandler} from "../../supabase/functions/_shared/stripe-checkout.ts";
import type {CheckoutContext, CheckoutDependencies} from "../../supabase/functions/_shared/stripe-checkout.ts";
const origin = "https://thelivingroom.vet", requestId = "10000000-0000-4000-8000-000000000001";
const context: CheckoutContext = {id: requestId, actor_id: "staff", account_id: "acct_fixture", livemode: false, amount_cents: "10000", currency: "usd", source_hash: "a".repeat(64), success_url: origin+"/payment/return", cancel_url: origin+"/payment/cancel", session_expires_at: "2026-09-13T05:00:00Z", retry_before: "2026-09-14T02:00:00Z", idempotency_key: "checkout:stable-request", state: "prepared", current_source_matches: true, session_id: null};
function session(status = "open") { return {object: "checkout.session", id: "cs_test_fixture", mode: "payment", livemode: false, amount_total: 10000, currency: "usd", client_reference_id: requestId, metadata: {request_id: requestId, source_hash: context.source_hash}, expires_at: Date.parse(context.session_expires_at)/1000, invoice: null, recovered_from: null, status, payment_status: status === "complete" ? "paid" : "unpaid", payment_intent: status === "complete" ? "pi_fixture" : null, url: status === "open" ? "https://checkout.stripe.com/c/pay/cs_test_fixture" : null}; }
function req(action = "recover", auth = true) {return new Request(origin+"/functions/v1/checkout", {method: "POST", headers: {...(auth ? {Authorization: "Bearer fixture"} : {}), Origin: origin}, body: JSON.stringify({p_request_id: requestId, action})});}
function setup(patch: Partial<CheckoutDependencies> = {}) {
  const calls: string[] = []; const observations: unknown[] = [];
  const deps: CheckoutDependencies = {origin, enabled: true, authenticate: async () => {calls.push("auth"); return "staff";}, context: async () => {calls.push("context"); return {...context};}, provider: {
    createCheckout: async () => {calls.push("create"); return session();},
    retrieveCheckout: async () => {calls.push("retrieve"); return session();},
    expireCheckout: async () => {calls.push("expire"); return session("expired");},
  }, apply: async (intent, evidence, eventId) => {calls.push("apply"); observations.push({intent, evidence, eventId}); return "accepted";}, ...patch};
  return {handler: createStripeCheckoutHandler(deps), calls, deps, observations};
}
test("authentication and actor context precede provider mutation", async () => {
  const {handler, calls} = setup(); assert.equal((await handler(req("create", false))).status, 401); assert.equal(calls.length, 0);
  const response = await handler(req("create")); assert.equal(response.status, 200);
  assert.deepEqual(calls, ["auth", "context", "create", "apply"]); assert.equal((await response.json()).state, "session_open");
});
test("known session recovery retrieves rather than POST and paid terminal state cannot charge again", async () => {
  const {handler, calls} = setup({context: async () => ({...context, state: "open", session_id: "cs_test_fixture"})});
  await handler(req()); assert.equal(calls.includes("create"), false); assert.equal(calls.includes("retrieve"), true);
  const paid = setup({context: async () => ({...context, state: "paid"})});
  assert.equal((await (await paid.handler(req())).json()).state, "paid"); assert.deepEqual(paid.calls, ["auth"]);
});
test("lost durable acknowledgement suppresses URL and exact request is recoverable", async () => {
  const {handler} = setup({apply: async () => {throw new Error("lost db acknowledgement");}});
  const response = await handler(req()); assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), {state: "uncertain", request_id: requestId});
});
test("expiry payment race retrieves authoritative paid result even after expiry error", async () => {
  let retrieved = 0; let applied = "";
  const {handler} = setup({context: async () => ({...context, state: "open", session_id: "cs_test_fixture"}), provider: {
    createCheckout: async () => {throw new Error("must not create");},
    retrieveCheckout: async () => session(++retrieved === 1 ? "open" : "complete"),
    expireCheckout: async () => {throw new Error("session completed during expiry");},
  }, apply: async (_intent, evidence) => {applied = evidence.state; return "accepted";}});
  const response = await handler(req("expire")); assert.equal(response.status, 200); assert.equal(applied, "payment_succeeded");
  assert.equal((await response.json()).client_url, null); assert.equal(retrieved, 2);
});
test("changed source, missing expiry identity and actor mismatch cannot create or unlock", async () => {
  for (const changed of [{current_source_matches: false}, {actor_id: "other"}]) {
    const {handler, calls} = setup({context: async () => ({...context, ...changed})});
    assert.ok([404,409].includes((await handler(req())).status)); assert.equal(calls.includes("create"), false);
  }
  const {handler, calls} = setup(); assert.equal((await handler(req("expire"))).status, 409); assert.equal(calls.includes("apply"), false);
});
test("mismatched provider identity and quarantined evidence never expose checkout URL", async () => {
  const bad = setup({provider: {createCheckout: async () => ({...session(), amount_total: 1}), retrieveCheckout: async () => session(), expireCheckout: async () => session()}});
  assert.equal((await bad.handler(req())).status, 409); assert.equal(bad.calls.includes("apply"), false);
  const quarantined = setup({apply: async () => "quarantined"}); const result = await quarantined.handler(req());
  assert.deepEqual(await result.json(), {state: "reconciliation"});
});
test("repeated matching observations have stable IDs, excluding transient checkout URL", async () => {
  const {handler, observations} = setup(); await handler(req()); await handler(req());
  const values = observations as {eventId: string}[]; assert.equal(values[0].eventId, values[1].eventId); assert.match(values[0].eventId, /^observe:[a-f0-9]{64}$/);
});
