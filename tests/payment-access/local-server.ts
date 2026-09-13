/** Local-only HTTP adapter: real Auth/PostgREST, explicitly synthetic provider responses. */
import {createClient} from "https://esm.sh/@supabase/supabase-js@2.110.3";
import {createPaymentAccessHandler} from "../../supabase/functions/_shared/payment-access-http.ts";
import type {PaymentActivation} from "../../supabase/functions/_shared/payment-access-http.ts";
import {paymentAccessConfig} from "../../supabase/functions/_shared/payment-access-capability.ts";
import type {PaymentScopedCheckoutIntent} from "../../supabase/functions/_shared/payment-access-capability.ts";
import {paymentAccessRuntime} from "../../supabase/functions/_shared/payment-access-runtime.ts";
const url=Deno.env.get("SUPABASE_URL")!;
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(url))throw new Error("Local Supabase only");
const db=createClient(url,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false,autoRefreshToken:false}});
const staff=createClient(url,Deno.env.get("SUPABASE_ANON_KEY")!,{global:{headers:{Authorization:`Bearer ${Deno.env.get("PAYMENT_TEST_STAFF_TOKEN")}`}},auth:{persistSession:false,autoRefreshToken:false}});
async function rpc<T>(name:string,params:Record<string,unknown>):Promise<T>{const {data,error}=await db.rpc(name,params);if(error)throw error;return data as T;}
const config=paymentAccessConfig({origin:Deno.env.get("PAYMENT_ACCESS_ORIGIN"),activeKeyVersion:Deno.env.get("PAYMENT_ACCESS_ACTIVE_KEY_VERSION"),keys:Deno.env.get("PAYMENT_ACCESS_KEYS"),collectionEnabled:"true",statusEnabled:"true"});
const sessions=new Map<string,Record<string,unknown>>(),lost=new Set<string>();
function handler(mode:string,role:"collection"|"status"){
 const args=(id:string,hash:string,origin:string,version:string)=>({p_grant_id:id,p_collection_token_hash:hash,p_origin:origin,p_key_version:version});
 return createPaymentAccessHandler(role,{
  config:()=>config,providerEnabled:true,collectionsEnabled:true,
  context:id=>rpc("payment_collection_access_context",{p_grant_id:id}),
  inspect:(id,hash,origin,version)=>rpc("inspect_payment_collection",args(id,hash,origin,version)),
  status:(id,hash,origin,version)=>rpc("read_payment_collection_status",{p_grant_id:id,p_status_token_hash:hash,p_origin:origin,p_key_version:version}),
  activate:(id,hash,origin,version,allow)=>rpc<PaymentActivation>("activate_payment_collection",{...args(id,hash,origin,version),p_allow_create:allow}),
  create:async(intent:PaymentScopedCheckoutIntent)=>{
   if(!intent.success_url.includes("#s1.") || intent.success_url.includes("{{"))throw new Error("Return token not materialized");
   if(mode==="revoked"){
    const {error}=await staff.rpc("revoke_payment_collection",{p_request_id:intent.return_scope_id,p_reason:"LOCAL SYNTHETIC provider race"});if(error)throw error;
   }
   const sid="cs_test_"+intent.id.replaceAll("-","");
   const paid=mode==="paid";
   const value={object:"checkout.session",id:sid,mode:"payment",livemode:false,amount_total:Number(intent.amount_cents),currency:"usd",client_reference_id:intent.id,metadata:{request_id:intent.id,source_hash:intent.source_hash},expires_at:Math.floor(Date.parse(intent.session_expires_at)/1000),invoice:null,recovered_from:null,status:paid?"complete":"open",payment_status:paid?"paid":"unpaid",payment_intent:paid?"pi_"+intent.id.replaceAll("-",""):null,url:paid?null:"https://checkout.stripe.com/c/pay/"+sid};
   sessions.set(sid,value);return value;
  },
  retrieve:async id=>{const value=sessions.get(id);if(!value)throw new Error("Synthetic session unavailable");return value;},
  quarantine:async id=>{await rpc("record_payment_reconciliation",{p_family:"checkout",p_request_id:id,p_reason:"provider_context_mismatch"});},
  apply:async(intent,evidence,eventId)=>{
   const result=await rpc<{disposition:"accepted"|"quarantined"}>("apply_checkout_evidence",{p_event_id:eventId,p_request_id:intent.id,p_account_id:intent.account_id,p_livemode:intent.livemode,p_kind:evidence.state,p_session_id:evidence.session_id,p_payment_id:evidence.payment_id,p_amount_cents:evidence.amount_cents,p_currency:evidence.currency,p_source_hash:intent.source_hash});
   if(mode==="lost" && !lost.has(intent.id)){lost.add(intent.id);throw new Error("Synthetic lost DB acknowledgement after commit");}
   return result.disposition;
  },
 });
}
const handlers=new Map<string,ReturnType<typeof handler>>();
for(const mode of ["paid","lost","revoked","open"])for(const role of ["collection","status"] as const)handlers.set(`/${mode}/${role}`,handler(mode,role));
const realCollection=paymentAccessRuntime("collection"),realStatus=paymentAccessRuntime("status");
Deno.serve({hostname:"127.0.0.1",port:56471},request=>{
 const path=new URL(request.url).pathname;
 if(path==="/health")return new Response("ready");
 if(path==="/real/collection")return realCollection(request);
 if(path==="/real/status")return realStatus(request);
 return handlers.get(path)?.(request)??new Response(null,{status:404});
});
