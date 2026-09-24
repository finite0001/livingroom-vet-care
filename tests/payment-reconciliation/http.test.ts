import {test} from "node:test";
import assert from "node:assert/strict";
import {createReconciliationHandler,safeReconciliation} from "../../supabase/functions/_shared/payment-reconciliation-http.ts";
import type {ReconciliationDependencies} from "../../supabase/functions/_shared/payment-reconciliation-http.ts";
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const actor=id(1),invoice=id(2),requestId=id(3),caseId=id(4),origin="https://thelivingroom.vet",now=Date.parse("2026-09-13T04:00:00Z");
const blockers=[{kind:"observation",id:id(5)}];
function fixture(family="checkout"){
 const objectId=family==="checkout"?"cs_test_fixture":"re_fixture";
 const args={p_case_id:caseId,p_invoice_id:invoice,p_family:family,p_request_id:requestId,p_provider_object_id:objectId,p_blocker_refs:blockers,p_expected_case_hash:"a".repeat(64)};
 const context={id:requestId,invoice_id:invoice,account_id:"acct_fixture",livemode:false,amount_cents:"10000",currency:"usd",source_hash:"b".repeat(64),session_expires_at:"2026-09-13T06:00:00Z",session_id:family==="checkout"?objectId:null,refund_id:family==="refund"?objectId:null,provider_payment_id:"pi_fixture"};
 const row={id:caseId,actor_id:actor,invoice_id:invoice,family,request_id:requestId,provider_object_id:objectId,blocker_refs:blockers,snapshot_hash:"a".repeat(64),created_at:new Date(now).toISOString()};
 let saved:Record<string,unknown>|null=null,losePrepare=false,loseCapture=false;let retrieved=0;
 const calls:string[]=[],proofs:Record<string,unknown>[]=[];
 const db={rpc:async(name:string,input:Record<string,unknown>)=>{
  calls.push(name);
  if(name==="read_payment_reconciliation")return {data:saved,error:null};
  if(name==="preview_payment_reconciliation")return {data:{context,blocker_refs:blockers,snapshot_hash:"a".repeat(64)},error:null};
  assert.equal(name,"prepare_payment_reconciliation");
  if(JSON.stringify(input)!==JSON.stringify(args))return {data:null,error:{code:"23514"}};
  saved??={case:row,capture:null,resolution:null};
  return {data:saved,error:losePrepare?new Error("lost preparation ack"):null};
 }};
 const deps:ReconciliationDependencies={enabled:true,providerEnabled:true,origin,authenticate:async()=>({actorId:actor,db}),now:()=>now,
 service:{rpc:async(name,input)=>{calls.push(name);assert.equal(name,"capture_payment_reconciliation");assert.equal(input.p_reviewer_id,actor);const evidence=input.p_provider_evidence as Record<string,unknown>;proofs.push(evidence);saved={case:row,capture:{case_id:caseId,evidence,proof_hash:"f".repeat(64),provider_observed_at:evidence.provider_observed_at,created_at:new Date(now).toISOString()},resolution:null};return {data:saved.capture,error:loseCapture?new Error("lost capture ack"):null};}},
 retrieveCheckout:async(object,account,live)=>{retrieved++;assert.equal(object,objectId);assert.equal(account,"acct_fixture");assert.equal(live,false);return {object:"checkout.session",id:object,livemode:false,mode:"payment",currency:"usd",amount_total:10000,client_reference_id:requestId,metadata:{request_id:requestId,source_hash:context.source_hash},expires_at:Date.parse(context.session_expires_at)/1000,invoice:null,recovered_from:null,status:"open",payment_status:"unpaid",payment_intent:null,url:"https://checkout.stripe.com/c/pay/secret",customer_details:{email:"private@example.test"}};},
 retrieveRefund:async(object,account,live)=>{retrieved++;assert.equal(object,objectId);assert.equal(account,"acct_fixture");assert.equal(live,false);return {id:object,object:"refund",payment_intent:"pi_fixture",metadata:{request_id:requestId},amount:10000,currency:"usd",status:"pending",description:"private provider payload"};},
 };
 const send=(action="prepare",patch:Record<string,unknown>={})=>createReconciliationHandler(deps)(new Request(origin,{method:"POST",headers:{Authorization:"Bearer fixture",Origin:origin,"Content-Type":"application/json"},body:JSON.stringify({action,...(action==="prepare"?args:action==="recover"?{p_case_id:caseId}:{p_invoice_id:invoice,p_family:family,p_request_id:requestId,p_provider_object_id:objectId}),...patch})}));
 return {deps,send,calls,proofs,args,context,get retrieved(){return retrieved;},set losePrepare(v:boolean){losePrepare=v;},set loseCapture(v:boolean){loseCapture=v;},get saved(){return saved;},set saved(v:Record<string,unknown>|null){saved=v;}};
}
test("preview is active-admin SQL only and exposes a bounded safe projection",async()=>{
 const f=fixture();const response=await f.send("preview");assert.equal(response.status,200);assert.equal(f.retrieved,0);assert.deepEqual(f.calls,["preview_payment_reconciliation"]);const data=await response.json();assert.equal(data.amount_cents,"10000");assert.equal("context"in data,false);assert.equal("session_expires_at"in data,false);
});
test("known checkout retrieval creates exactly normalized proof without raw URL or customer payload",async()=>{
 const f=fixture();const response=await f.send();assert.equal(response.status,200);assert.equal(f.retrieved,1);assert.equal(f.proofs.length,1);
 assert.deepEqual(Object.keys(f.proofs[0]).sort(),["family","request_id","object_id","account_id","livemode","amount_cents","currency","provider_observed_at","status","payment_id","source_hash"].sort());
 assert.equal(f.proofs[0].provider_observed_at,new Date(now).toISOString());assert.doesNotMatch(JSON.stringify(f.saved),/private|checkout.stripe|secret/);
});
test("known refund retrieval is GET-only and keeps strict refund proof fields",async()=>{
 const f=fixture("refund");assert.equal((await f.send()).status,200);assert.equal(f.proofs[0].provider_payment_id,"pi_fixture");assert.equal(f.proofs[0].status,"pending");assert.equal(Object.keys(f.proofs[0]).length,10);assert.equal("payment_id"in f.proofs[0],false);
});
test("capture acknowledgement loss recovers immutable proof and future retries perform no retrieval",async()=>{
 const f=fixture();f.loseCapture=true;assert.equal((await f.send()).status,200);f.deps.providerEnabled=false;assert.equal((await f.send()).status,200);assert.equal((await f.send("recover")).status,200);assert.equal(f.retrieved,1);
});
test("changed case arguments never override SQL rejection with recovered success",async()=>{
 const f=fixture();await f.send();const response=await f.send("prepare",{p_expected_case_hash:"c".repeat(64)});assert.equal(response.status,409);assert.equal(f.retrieved,1);
});
test("lost preparation acknowledgement retains stable case and retries exact SQL before capture",async()=>{
 const f=fixture();f.losePrepare=true;const response=await f.send();assert.equal(response.status,202);assert.equal((await response.json()).case_id,caseId);assert.equal(f.retrieved,0);f.losePrepare=false;assert.equal((await f.send()).status,200);assert.equal(f.retrieved,1);
});
test("unknown object or mismatched amount never reaches capture",async()=>{
 for(const patch of [{id:"cs_test_wrong"},{amount_total:1}]){
  const f=fixture();const original=f.deps.retrieveCheckout;f.deps.retrieveCheckout=async(...args)=>({...await original(...args),...patch});const response=await f.send();assert.ok([202,409].includes(response.status));assert.equal(f.proofs.length,0);
 }
});
test("no provider operation before admin SQL authorization and strict input validation",async()=>{
 const denied=fixture();denied.deps.authenticate=async()=>({actorId:actor,db:{rpc:async()=>({data:null,error:{code:"42501"}})}});assert.equal((await denied.send()).status,404);assert.equal(denied.retrieved,0);
 for(const patch of [{provider_observed_at:new Date(now).toISOString()},{p_provider_object_id:"unknown"},{action:["prepare"]},{p_blocker_refs:[]}]){const f=fixture();assert.equal((await f.send("prepare",patch)).status,400);assert.equal(f.calls.length,0);}
 const off=fixture();off.deps.enabled=false;assert.equal((await off.send()).status,503);assert.equal(off.calls.length,0);
});
test("provider outage leaves case unconfirmed without capturing fabricated absence",async()=>{
 const f=fixture();f.deps.retrieveCheckout=async()=>{throw new Error("secret provider error");};const response=await f.send();assert.equal(response.status,202);assert.doesNotMatch(await response.text(),/secret/);assert.equal(f.proofs.length,0);
});
test("case projection validates owning admin and strips arbitrary raw data",async()=>{
 const f=fixture();await f.send();assert.throws(()=>safeReconciliation(f.saved,id(9),caseId));
 const saved=f.saved!;const safe=safeReconciliation({...saved,raw:"secret",capture:{...(saved.capture as Record<string,unknown>),raw:"secret"}},actor,caseId);assert.doesNotMatch(JSON.stringify(safe),/secret/);
});
