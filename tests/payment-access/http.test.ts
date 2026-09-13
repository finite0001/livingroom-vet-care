import {test} from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createPaymentAccessHandler} from "../../supabase/functions/_shared/payment-access-http.ts";
import type {PaymentAccessDependencies,PublicPaymentState} from "../../supabase/functions/_shared/payment-access-http.ts";
import {materializePaymentAccess,paymentAccessConfig} from "../../supabase/functions/_shared/payment-access-capability.ts";
const origin="https://thelivingroom.vet",id="10000000-0000-4000-8000-000000000001",requestId="20000000-0000-4000-8000-000000000001";
const config=paymentAccessConfig({origin,activeKeyVersion:"first",keys:JSON.stringify({first:btoa("x".repeat(32))}),collectionEnabled:"true",statusEnabled:"true"});
const frozen={id,actor_id:"10000000-0000-4000-8000-000000000002",invoice_id:"10000000-0000-4000-8000-000000000003",client_id:"10000000-0000-4000-8000-000000000004",amount_cents:"10000",currency:"usd",source_hash:"a".repeat(64),created_at:"2026-09-13T03:00:00Z",expires_at:"2026-09-19T03:00:00Z",status_expires_at:"2026-10-19T03:00:00Z"};
const capability_context=JSON.stringify({domain:"lrv-payment-collection/v2",grant:frozen,origin,key_version:"first",context_version:2});
const grant={...frozen,origin,key_version:"first",capability_context,context_hash:createHash("sha256").update(capability_context).digest("hex")};
const access=await materializePaymentAccess(grant,config);
const envelope={grant,capture:{grant_id:id,origin,key_version:"first",context_version:2,capability_context,context_hash:grant.context_hash,collection_token_hash:access.collection_token_hash,status_token_hash:access.status_token_hash}};
const intent={id:requestId,actor_id:grant.actor_id,invoice_id:grant.invoice_id,client_id:grant.client_id,account_id:"acct_fixture",livemode:false,amount_cents:"10000",currency:"usd",source_hash:grant.source_hash,success_url:`${origin}/payment/return/${id}#{{payment_status}}`,cancel_url:`${origin}/payment/cancel/${id}#{{payment_status}}`,session_expires_at:"2026-09-13T05:00:00Z",retry_before:"2026-09-14T02:00:00Z",idempotency_key:"lrv-checkout-"+requestId,return_context_version:2,return_scope_id:id,return_key_version:"first",return_origin:origin,state:"prepared",current_source_matches:true,session_id:null};
function session(status="open",request=requestId){return {object:"checkout.session",id:"cs_test_fixture",mode:"payment",livemode:false,amount_total:10000,currency:"usd",client_reference_id:request,metadata:{request_id:request,source_hash:grant.source_hash},expires_at:Date.parse(intent.session_expires_at)/1000,invoice:null,recovered_from:null,status,payment_status:status==="complete"?"paid":"unpaid",payment_intent:status==="complete"?"pi_fixture":null,url:status==="open"?"https://checkout.stripe.com/c/pay/cs_test_fixture":null};}
function state(name="ready"):PublicPaymentState{return {state:name,amount_cents:"10000",currency:"usd",expires_at:grant.expires_at,status_expires_at:grant.status_expires_at,confirmed_paid_cents:name==="paid"?"10000":"0",confirmed_refunded_cents:"0"};}
function req(action="inspect",role:"collection"|"status"="collection",patch:Record<string,unknown>={}){return new Request(origin+"/functions/v1/payment-"+role,{method:"POST",headers:{Origin:origin,"Content-Type":"application/json"},body:JSON.stringify({grant_id:id,token:role==="collection"?access.collection_token:access.status_token,...(role==="collection"?{action}:{}),...patch})});}
function setup(patch:Partial<PaymentAccessDependencies>={},role:"collection"|"status"="collection"){
 const calls:string[]=[];let current=state();
 const deps:PaymentAccessDependencies={config:()=>config,providerEnabled:true,collectionsEnabled:true,
 context:async()=>{calls.push("context");return envelope;},inspect:async()=>{calls.push("inspect");return current;},status:async()=>{calls.push("status");return current;},
 activate:async(_id,_hash,_origin,_version,allowed)=>{calls.push("activate:"+allowed);current=state("confirmation_pending");return {state:"prepared",attempt:{...intent}};},
 create:async exact=>{calls.push("create");assert.equal(exact.success_url,access.status_url);return session();},retrieve:async()=>{calls.push("retrieve");return session();},
 apply:async()=>{calls.push("apply");return "accepted";},quarantine:async()=>{calls.push("quarantine");},...patch};
 return {handler:createPaymentAccessHandler(role,deps),calls,deps};
}
test("inspect and narrow status verify capability without provider calls",async()=>{
 const s=setup();const r=await s.handler(req());assert.equal(r.status,200);assert.deepEqual(s.calls,["context","inspect"]);assert.equal((await r.json()).collection_available,true);
 const t=setup({},"status");const result=await t.handler(req("", "status"));assert.deepEqual(t.calls,["context","status"]);assert.deepEqual(await result.json(),state());
});
test("default-off flags and malformed requests do no database work",async()=>{
 const off=setup({config:()=>({...config,collectionEnabled:false})});assert.equal((await off.handler(req())).status,503);assert.equal(off.calls.length,0);
 for(const patch of [{token:access.status_token},{paid:true},{grant_id:"invalid"},{action:"expire"},{action:["inspect"]},{action:["activate"]},{action:{value:"inspect"}}]){const s=setup();assert.equal((await s.handler(req("inspect","collection",patch))).status,404);assert.equal(s.calls.length,0);}
 const big=setup();assert.equal((await big.handler(new Request(origin,{method:"POST",headers:{"Content-Type":"application/json"},body:" ".repeat(1025)}))).status,404);assert.equal(big.calls.length,0);
});
test("wrong HMAC, cross-grant context, captured hash and removed keys deny",async()=>{
 for(const patch of [{context:async()=>({...envelope,grant:{...grant,id:grant.actor_id}})}, {context:async()=>({...envelope,capture:{...envelope.capture,status_token_hash:"f".repeat(64)}})}, {config:()=>({...config,keys:{}})}]){
 const s=setup(patch);assert.equal((await s.handler(req())).status,404);assert.equal(s.calls.includes("inspect"),false);}
 const bad=setup();assert.equal((await bad.handler(req("inspect","collection",{token:"p1."+"x".repeat(43)}))).status,404);
});
test("creation persists evidence then rechecks grant before releasing exact UI contract",async()=>{
 const s=setup();const r=await s.handler(req("activate"));assert.equal(r.status,200);assert.deepEqual(s.calls,["context","inspect","activate:true","create","apply","inspect"]);
 assert.deepEqual(await r.json(),{...state("checkout_ready"),collection_available:true,checkout_url:session().url});assert.equal(r.headers.get("cache-control"),"no-store, private");
});
test("lost provider or ledger acknowledgement retains pending state without URLs or identifiers",async()=>{
 for(const patch of [{create:async()=>{throw new Error("lost Stripe response");}},{apply:async()=>{throw new Error("lost DB response");}}]){
 const s=setup(patch);const r=await s.handler(req("activate"));assert.equal(r.status,202);assert.deepEqual(await r.json(),{...state("confirmation_pending"),collection_available:false});}
});
test("malformed provider evidence durably quarantines without invented payment evidence",async()=>{
 const s=setup({create:async()=>({...session(),amount_total:1})});const r=await s.handler(req("activate"));assert.equal(r.status,200);assert.equal((await r.json()).state,"reconciliation");assert.equal(s.calls.includes("quarantine"),true);assert.equal(s.calls.includes("apply"),false);
 const uncertain=setup({create:async()=>({...session(),amount_total:1}),quarantine:async()=>{throw new Error("unknown");}});assert.equal((await uncertain.handler(req("activate"))).status,202);
});
test("revocation during provider work suppresses URL while allowing separately scoped status",async()=>{
 let inspected=0;const s=setup({inspect:async()=>{if(++inspected===2)throw {code:"42501"};return state();},status:async()=>state("confirmation_pending")});
 const r=await s.handler(req("activate"));assert.deepEqual(await r.json(),{...state("confirmation_pending"),collection_available:false});assert.equal(s.calls.includes("apply"),true);
});
test("database outages stay unavailable rather than becoming business denial",async()=>{
 for(const patch of [{context:async()=>{throw new Error("offline");}},{inspect:async()=>{throw new Error("offline");}},{activate:async()=>{throw new Error("offline");}}]){
 const s=setup(patch);assert.equal((await s.handler(req("activate"))).status,503);assert.equal(s.calls.includes("status"),false);}
 let inspected=0;const s=setup({inspect:async()=>{if(++inspected===2)throw new Error("offline");return state();}});assert.equal((await s.handler(req("activate"))).status,503);
});
test("paused creation can retrieve an existing session with explicit false DB flag",async()=>{
 const s=setup({collectionsEnabled:false,inspect:async()=>state("confirmation_pending"),activate:async(_id,_hash,_origin,_version,allowed)=>{assert.equal(allowed,false);return {state:"open",attempt:{...intent,state:"open",session_id:"cs_test_fixture"}};}});
 const initial=await s.handler(req());assert.equal((await initial.json()).collection_available,true);
 const result=await s.handler(req("activate"));assert.equal((await result.json()).state,"checkout_ready");assert.equal(s.calls.includes("create"),false);assert.equal(s.calls.includes("retrieve"),true);
});
test("accepted expiry may renew once, never from transport uncertainty",async()=>{
 let activated=0,applied=0;const second="20000000-0000-4000-8000-000000000002";
 const s=setup({activate:async()=>({state:activated++?"prepared":"open",attempt:activated===1?{...intent,state:"open",session_id:"cs_test_fixture"}:{...intent,id:second,idempotency_key:"lrv-checkout-"+second}}),retrieve:async()=>session("expired"),create:async()=>session("open",second),apply:async()=>{applied++;return "accepted";},inspect:async()=>applied===2?state("confirmation_pending"):state()});
 assert.equal((await (await s.handler(req("activate"))).json()).state,"checkout_ready");assert.equal(activated,2);assert.equal(applied,2);
});
test("public projection excludes arbitrary database fields and rejects contradictory money",async()=>{
 const s=setup({status:async()=>({...state(),invoice_id:grant.invoice_id,patient:"private"})},"status");assert.deepEqual(await (await s.handler(req("","status"))).json(),state());
 for(const bad of [{...state(),amount_cents:"1"},{...state("paid"),confirmed_paid_cents:"1"},{...state(),confirmed_paid_cents:"1"}]){const s=setup({status:async()=>bad},"status");assert.equal((await s.handler(req("","status"))).status,503);}
});
