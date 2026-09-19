import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  materializePaymentAccess,
  paymentAccessConfig,
  type PaymentAccessGrant,
} from "../../supabase/functions/_shared/payment-access-capability.ts";
import {
  type PaymentDeliveryContext,
} from "../../supabase/functions/_shared/payment-delivery-payload.ts";
const hash = (v: string) => createHash("sha256").update(v).digest("hex");
const config = paymentAccessConfig({
  origin: "https://thelivingroom.vet",
  activeKeyVersion: "one",
  keys: JSON.stringify({ one: btoa("k".repeat(32)) }),
  collectionEnabled: "true",
  statusEnabled: "true",
});
const grant: PaymentAccessGrant = {
  id: "10000000-0000-4000-8000-000000000001",
  actor_id: "10000000-0000-4000-8000-000000000002",
  invoice_id: "10000000-0000-4000-8000-000000000003",
  client_id: "10000000-0000-4000-8000-000000000004",
  amount_cents: "12500",
  currency: "usd",
  source_hash: "a".repeat(64),
  created_at: "2026-09-13T00:00:00Z",
  expires_at: "2026-09-20T00:00:00Z",
  status_expires_at: "2026-10-20T00:00:00Z",
  origin: config.origin,
  key_version: "one",
  capability_context: "",
  context_hash: "",
};
grant.capability_context = JSON.stringify({
  domain: "lrv-payment-collection/v2",
  context_version: 2,
  origin: grant.origin,
  key_version: grant.key_version,
  grant: { ...grant },
});
grant.context_hash = hash(grant.capability_context);
const emailSender = {
  from: "Living Room Vet <billing@thelivingroom.vet>",
  reply_to: "care@thelivingroom.vet",
};
const smsSender = { from: "+13035550101", account_sid: "AC" + "a".repeat(32) };
async function fixture(
  channel: "EMAIL" | "SMS" = "EMAIL",
): Promise<PaymentDeliveryContext> {
  const access = await materializePaymentAccess(grant, config);
  return {
    request: {
      grant_id: grant.id,
      actor_id: grant.actor_id,
      invoice_id: grant.invoice_id,
      client_id: grant.client_id,
      amount_cents: grant.amount_cents,
      source_hash: grant.source_hash,
      channel,
      recipient: channel === "EMAIL" ? "client@example.com" : "+13035550102",
      subject: channel === "EMAIL" ? "Your invoice" : "",
      body_template: "Review your invoice and pay: {{payment_link}}",
      invoice_email_request_id: null,
      invoice_payload_hash: null,
    },
    grant,
    capability: {
      ...grant,
      grant_id: grant.id,
      context_version: 2,
      collection_token_hash: access.collection_token_hash,
      status_token_hash: access.status_token_hash,
    },
    invoice_payload_text: null,
  };
}
import {createPaymentDeliveryStaffHandler,safePaymentDelivery} from "../../supabase/functions/_shared/payment-delivery-staff.ts";
import type {PaymentDeliveryStaffDependencies} from "../../supabase/functions/_shared/payment-delivery-staff.ts";
const requestId="10000000-0000-4000-8000-000000000005",conversation="10000000-0000-4000-8000-000000000006";
async function handlerFixture(channel:"EMAIL"|"SMS"="EMAIL"){
 const context=await fixture(channel),calls:string[]=[];
 const row={...context.request,id:requestId,conversation_id:conversation,created_at:grant.created_at};
 let saved:Record<string,unknown>|null=null,losePrepare=false,loseCapture=false,deny=false;
 const args={p_request_id:requestId,p_grant_id:grant.id,p_conversation_id:conversation,p_channel:channel,p_recipient:row.recipient,p_subject:row.subject,p_body_template:row.body_template,p_invoice_email_request_id:null,p_invoice_payload_hash:null};
 const deps:PaymentDeliveryStaffDependencies={enabled:true,origin:config.origin,config:()=>config,sender:c=>c==="EMAIL"?emailSender:smsSender,
 authenticate:async()=>({actorId:grant.actor_id,db:{rpc:async(name,input)=>{
 calls.push(name);if(deny)return {data:null,error:{code:"42501"}};
 if(name==="recover_payment_delivery")return {data:saved,error:null};
 assert.equal(name,"prepare_payment_delivery");if(JSON.stringify(input)!==JSON.stringify(args))return {data:null,error:{code:"23505"}};
 saved??={request:row,capture:null,receipt:null};return {data:saved,error:losePrepare?new Error("ACK lost"):null};
 }}}),service:{rpc:async(name,input)=>{calls.push(name);if(name==="payment_delivery_capture_context")return {data:context,error:null};assert.equal(name,"capture_payment_delivery");saved={request:row,capture:{request_id:requestId,sender_config:input.p_sender_config,message_hash:input.p_message_hash,payload_hash:input.p_payload_hash,captured_at:grant.created_at},receipt:null};return {data:null,error:loseCapture?new Error("ACK lost"):null};}},
 };
 const send=(action="prepare",patch:Record<string,unknown>={})=>createPaymentDeliveryStaffHandler(deps)(new Request(config.origin,{method:"POST",headers:{Origin:config.origin,Authorization:"Bearer synthetic","Content-Type":"application/json"},body:JSON.stringify({action,...(action==="prepare"?args:{p_request_id:requestId}),...patch})}));
 return {deps,send,calls,get saved(){return saved;},set losePrepare(v:boolean){losePrepare=v;},set loseCapture(v:boolean){loseCapture=v;},set deny(v:boolean){deny=v;}};
}
test("email and SMS preparation freezes digests only; review is transient and cannot enqueue",async()=>{
 for(const channel of ["EMAIL","SMS"] as const){const f=await handlerFixture(channel);const response=await f.send();assert.equal(response.status,200);const saved=await response.json();assert.doesNotMatch(JSON.stringify(saved),/#p1\.|collection_token_hash|capability_context/);const review=await f.send("review");assert.equal(review.status,200);assert.equal(review.headers.get("Cache-Control"),"no-store");assert.match((await review.json()).preview.message,/#p1\.[A-Za-z0-9_-]{43}/);assert.ok(f.calls.every(c=>!c.includes("enqueue")));}
});
test("captured recovery and exact retry need neither keys nor sender configuration",async()=>{const f=await handlerFixture();await f.send();f.deps.enabled=false;f.deps.config=()=>{throw new Error("keys unavailable");};f.deps.sender=()=>{throw new Error("sender unavailable");};assert.equal((await f.send("recover")).status,200);f.deps.enabled=true;assert.equal((await f.send()).status,200);});
test("SQL changed intent rejection cannot become recovered success",async()=>{const f=await handlerFixture();await f.send();assert.equal((await f.send("prepare",{p_subject:"Changed"})).status,409);});
test("lost prepare acknowledgment preserves same request without attempting capture",async()=>{const f=await handlerFixture();f.losePrepare=true;const r=await f.send();assert.equal(r.status,202);assert.equal((await r.json()).request_id,requestId);assert.ok(!f.calls.includes("capture_payment_delivery"));f.losePrepare=false;assert.equal((await f.send()).status,200);});
test("lost capture acknowledgment is recoverable without rotating request",async()=>{const f=await handlerFixture();f.loseCapture=true;assert.equal((await f.send()).status,202);const recovered=await(await f.send("recover")).json();assert.ok(recovered.delivery.capture);assert.equal((await f.send()).status,200);assert.equal(f.calls.filter(c=>c==="capture_payment_delivery").length,1);});
test("review detects sender changes and disabled preparation makes no mutation",async()=>{const f=await handlerFixture();f.deps.enabled=false;assert.equal((await f.send()).status,503);assert.equal(f.calls.length,0);f.deps.enabled=true;await f.send();f.deps.sender=()=>({...emailSender,from:"other@example.test"});assert.equal((await f.send("review")).status,202);});
test("SQL staff denial and extra fields fail before service materialization",async()=>{const f=await handlerFixture();f.deny=true;assert.equal((await f.send()).status,404);assert.ok(!f.calls.includes("payment_delivery_capture_context"));assert.equal((await f.send("recover",{unexpected:true})).status,400);});
test("bounded input rejects oversized stream and cross-origin request",async()=>{const f=await handlerFixture();const handler=createPaymentDeliveryStaffHandler(f.deps);const init={method:"POST",headers:{Origin:config.origin,Authorization:"Bearer synthetic","Content-Type":"application/json"},body:"x".repeat(450001)};assert.equal((await handler(new Request(config.origin,init))).status,413);assert.equal((await handler(new Request(config.origin,{...init,headers:{...init.headers,Origin:"https://other.test"}}))).status,403);assert.equal(f.calls.length,0);});
test("safe projection refuses another actor and strips service context",async()=>{const f=await handlerFixture();await f.send();assert.throws(()=>safePaymentDelivery(f.saved,requestId,requestId));const clean=safePaymentDelivery({...f.saved,secret:"private"},grant.actor_id,requestId);assert.equal("secret"in clean!,false);});
