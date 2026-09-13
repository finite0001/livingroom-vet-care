import {test} from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {paymentAccessConfig,materializePaymentAccess,paymentCapabilityHash,validPaymentCapability} from "../../supabase/functions/_shared/payment-access-capability.ts";
import type {PaymentAccessGrant} from "../../supabase/functions/_shared/payment-access-capability.ts";
const key = btoa("x".repeat(32));
const config = paymentAccessConfig({origin:"https://thelivingroom.vet",activeKeyVersion:"first",keys:JSON.stringify({first:key})});
const grant: PaymentAccessGrant = {id:"10000000-0000-4000-8000-000000000001",actor_id:"10000000-0000-4000-8000-000000000002",invoice_id:"10000000-0000-4000-8000-000000000003",client_id:"10000000-0000-4000-8000-000000000004",amount_cents:"12345",currency:"usd",source_hash:"a".repeat(64),created_at:"2026-09-13T03:00:00Z",expires_at:"2026-09-20T03:00:00Z",status_expires_at:"2026-10-20T03:00:00Z",origin:config.origin,key_version:"first",capability_context:"",context_hash:""};
function captured(value:PaymentAccessGrant):PaymentAccessGrant {
 const {capability_context:_context,context_hash:_hash,origin,key_version,...data}=value;
 const capability_context=JSON.stringify({domain:"lrv-payment-collection/v2",grant:data,origin,key_version,context_version:2});
 return {...value,capability_context,context_hash:createHash("sha256").update(capability_context).digest("hex")};
}
Object.assign(grant,captured(grant));
test("collection and status capabilities are independent and recover identically",async()=>{
 const a=await materializePaymentAccess(grant,config), b=await materializePaymentAccess({...grant,created_at:"2026-09-13T03:00:00+00:00"},config);
 assert.deepEqual(a,b); assert.match(a.collection_token,/^p1\.[\w-]{43}$/);assert.match(a.status_token,/^s1\.[\w-]{43}$/);
 assert.notEqual(a.collection_token.slice(3),a.status_token.slice(3)); assert.notEqual(a.collection_token_hash,a.status_token_hash);
 assert.equal(validPaymentCapability(a.collection_token,"status"),false);assert.equal(validPaymentCapability(a.status_token,"collection"),false);
 assert.equal(a.status_url,`${config.origin}/payment/return/${grant.id}#${a.status_token}`);
 assert.equal(config.collectionEnabled,false);assert.equal(config.statusEnabled,false);
});
test("capability binds every financial and identity field",async()=>{
 const baseline=await materializePaymentAccess(grant,config);
 for(const patch of [{id:grant.actor_id},{actor_id:grant.id},{invoice_id:grant.id},{client_id:grant.id},{amount_cents:"12346"},{source_hash:"b".repeat(64)},{created_at:"2026-09-13T03:01:00Z"},{expires_at:"2026-09-20T02:59:00Z",status_expires_at:"2026-10-20T02:59:00Z"}]) {
  const changed=await materializePaymentAccess(captured({...grant,...patch}),config);assert.notEqual(changed.collection_token,baseline.collection_token);assert.notEqual(changed.status_token,baseline.status_token);
 }
});
test("active-key rotation preserves old exact capability while removed keys and changed origins fail",async()=>{
 const baseline=await materializePaymentAccess(grant,config);
 const rotated=paymentAccessConfig({origin:config.origin,activeKeyVersion:"second",keys:JSON.stringify({first:key,second:btoa("y".repeat(32))})});
 assert.deepEqual(await materializePaymentAccess(grant,rotated),baseline);
 await assert.rejects(materializePaymentAccess(grant,{...rotated,keys:{second:rotated.keys.second}}));
 await assert.rejects(materializePaymentAccess(grant,{...config,origin:"https://other.example"}));
});
test("invalid or overbroad contexts and malformed key maps fail closed",async()=>{
 for(const patch of [{amount_cents:"0"},{amount_cents:"1.23"},{currency:"eur"},{id:"invalid"},{expires_at:"2026-09-21T03:00:00Z"},{status_expires_at:"2026-10-21T03:00:00Z"}]) await assert.rejects(materializePaymentAccess({...grant,...patch},config));
 for(const keys of ["[]","null",JSON.stringify({first:"short"}),JSON.stringify({first:key,bad:"invalid"})]) assert.throws(()=>paymentAccessConfig({origin:config.origin,activeKeyVersion:"first",keys}));
 assert.throws(()=>paymentAccessConfig({origin:"http://thelivingroom.vet",activeKeyVersion:"first",keys:JSON.stringify({first:key})}));
 await assert.rejects(paymentCapabilityHash("v1."+"a".repeat(43),"collection"));
});

test("untrusted top-level changes and forged capture hashes cannot reuse a frozen capability",async()=>{
 await assert.rejects(materializePaymentAccess({...grant,amount_cents:"12346"},config));
 await assert.rejects(materializePaymentAccess({...grant,context_hash:"0".repeat(64)},config));
});
import {materializePaymentCheckout} from "../../supabase/functions/_shared/payment-access-capability.ts";
import type {PaymentScopedCheckoutIntent} from "../../supabase/functions/_shared/payment-access-capability.ts";
const attempt:PaymentScopedCheckoutIntent={id:"20000000-0000-4000-8000-000000000001",actor_id:grant.actor_id,invoice_id:grant.invoice_id,client_id:grant.client_id,amount_cents:grant.amount_cents,currency:"usd",source_hash:grant.source_hash,account_id:"acct_fixture",livemode:false,idempotency_key:"lrv-checkout-20000000-0000-4000-8000-000000000001",session_expires_at:"2026-09-13T05:00:00Z",retry_before:"2026-09-14T02:00:00Z",return_context_version:2,return_scope_id:grant.id,return_key_version:grant.key_version,return_origin:grant.origin,success_url:`${grant.origin}/payment/return/${grant.id}#{{payment_status}}`,cancel_url:`${grant.origin}/payment/cancel/${grant.id}#{{payment_status}}`};
test("v2 return materialization preserves immutable intent and exact retry parameters",async()=>{
 const a=await materializePaymentCheckout(attempt,grant,config),b=await materializePaymentCheckout(attempt,grant,config);
 assert.deepEqual(a,b);assert.equal(attempt.success_url.endsWith("#{{payment_status}}"),true);assert.equal(a.idempotency_key,attempt.idempotency_key);
 assert.match(a.success_url,/#s1\.[\w-]{43}$/);assert.equal(a.success_url.split("#")[1],a.cancel_url.split("#")[1]);
});
test("v1 or cross-grant attempts cannot receive changed return parameters",async()=>{
 for(const patch of [{return_context_version:1},{return_scope_id:grant.actor_id},{actor_id:grant.id},{amount_cents:"12346"},{return_key_version:"other"},{success_url:"https://evil.example"}]) await assert.rejects(materializePaymentCheckout({...attempt,...patch},grant,config));
});
