import {test} from "node:test";
import assert from "node:assert/strict";
import {createStripeRefundHandler} from "../../supabase/functions/_shared/stripe-refund.ts";
import type {RefundContext, RefundDependencies} from "../../supabase/functions/_shared/stripe-refund.ts";
const origin = "https://thelivingroom.vet", id = "10000000-0000-4000-8000-000000000001";
const intent: RefundContext = {id, actor_id: "staff", account_id: "acct_fixture", livemode: false, currency: "usd", amount_cents: "1234", provider_payment_id: "pi_fixture", idempotency_key: "refund:stable-request", retry_before: "2026-09-14T02:00:00Z", state: "pending", refund_id: null};
function value(status = "pending") {return {id: "re_fixture", object: "refund", payment_intent: "pi_fixture", amount: 1234, currency: "usd", metadata: {request_id: id}, status};}
function req(auth = true, body: object = {p_request_id: id, action: "recover"}) {return new Request(origin+"/functions/v1/invoice-refund", {method: "POST", headers: auth ? {Authorization: "Bearer fixture"} : {}, body: JSON.stringify(body)});}
function setup(patch: Partial<RefundDependencies> = {}) {
 const calls: string[] = []; const observations: string[] = [];
 const deps: RefundDependencies = {origin, enabled: true, refundsEnabled: true,
  authenticate: async () => {calls.push("auth"); return "staff";}, context: async () => {calls.push("context"); return {...intent};},
  create: async () => {calls.push("create"); return value();}, retrieve: async () => {calls.push("retrieve"); return value();},
  quarantine: async () => {calls.push("quarantine");}, apply: async (_intent, evidence, eventId) => {calls.push("apply:"+evidence.status); observations.push(eventId); return "accepted";}, ...patch};
 return {handler: createStripeRefundHandler(deps),calls,observations};
}
test("refund requires authentication and immutable staff context before provider request", async () => {
 const {handler,calls} = setup(); assert.equal((await handler(req(false))).status, 401); assert.deepEqual(calls, []);
 assert.equal((await handler(req())).status, 200); assert.deepEqual(calls, ["auth","context","create","apply:pending"]);
});
test("refund intent body cannot alter amount, captured payment or staff reason", async () => {
 const {handler,calls} = setup(); assert.equal((await handler(req(true,{p_request_id:id,action:"create",amount_cents:"1"}))).status,400);
 assert.deepEqual(calls,["auth"]);
});
test("known refund retrieves and pending is distinct from successful refund cash", async () => {
 const known = setup({context: async () => ({...intent,refund_id:"re_fixture"})});
 const result = await known.handler(req()); assert.equal((await result.json()).state,"pending"); assert.equal(known.calls.includes("create"),false);
 const paid = setup({retrieve:async()=>value("succeeded"),context:async()=>({...intent,refund_id:"re_fixture"})});
 assert.equal((await (await paid.handler(req())).json()).state,"succeeded"); assert.equal(paid.calls.includes("apply:succeeded"),true);
});
test("refund pauses and terminal evidence cannot start a second refund", async () => {
 for(const state of ["failed","succeeded"] as const) {
  const f=setup({context:async()=>({...intent,state})}); assert.equal((await (await f.handler(req())).json()).state,state); assert.equal(f.calls.includes("create"),false);
 }
 const paused=setup({refundsEnabled:false}); assert.equal((await (await paused.handler(req())).json()).state,"refunds_paused");
 const recover=setup({refundsEnabled:false,context:async()=>({...intent,refund_id:"re_fixture"})}); assert.equal((await recover.handler(req())).status,200);
});
test("lost provider or database acknowledgement retains original refund reservation", async () => {
 for(const patch of [{create:async()=>{throw new Error("provider timeout");}},{apply:async()=>{throw new Error("lost db acknowledgement");}}]) {
  const f=setup(patch); const response=await f.handler(req()); assert.equal(response.status,202); assert.deepEqual(await response.json(),{state:"uncertain",request_id:id});
 }
});
test("malformed refund response records durable review without fake settlement", async () => {
 const f=setup({create:async()=>({...value(),metadata:null})});
 assert.equal((await f.handler(req())).status,409); assert.equal(f.calls.includes("quarantine"),true); assert.equal(f.calls.some(call=>call.startsWith("apply:")),false);
 const failed=setup({create:async()=>({...value(),amount:3}),quarantine:async()=>{throw new Error("lost review acknowledgement");}});
 assert.equal((await failed.handler(req())).status,202);
});
test("same refund observations use stable evidence IDs", async () => {
 const f=setup(); await f.handler(req()); await f.handler(req()); assert.equal(f.observations[0],f.observations[1]);
});
import {StripeBoundaryError} from "../../supabase/functions/_shared/stripe-provider.ts";
test("expired provider retry horizon records review instead of retrying forever", async () => {
 let reason="";
 const f=setup({create:async()=>{throw new StripeBoundaryError("reconcile");},quarantine:async(_id,why)=>{reason=why;}});
 assert.equal((await f.handler(req())).status,409); assert.equal(reason,"provider_reconciliation_required");
});
