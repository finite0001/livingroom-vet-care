import {createClient} from "https://esm.sh/@supabase/supabase-js@2.110.3";
import {createPaymentAccessHandler} from "./payment-access-http.ts";
import type {PaymentActivation} from "./payment-access-http.ts";
import {paymentAccessConfig} from "./payment-access-capability.ts";
import {createStripeProvider} from "./stripe-provider.ts";
export function paymentAccessRuntime(role: "collection"|"status") {
  async function rpc<T>(name:string,params:Record<string,unknown>):Promise<T> {
    const client=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data,error}=await client.rpc(name,params);if(error)throw error;return data as T;
  }
  const provider=()=>createStripeProvider({STRIPE_PAYMENTS_ENABLED:Deno.env.get("STRIPE_PAYMENTS_ENABLED"),STRIPE_SECRET_KEY:Deno.env.get("STRIPE_SECRET_KEY"),STRIPE_ACCOUNT_ID:Deno.env.get("STRIPE_ACCOUNT_ID"),STRIPE_LIVEMODE:Deno.env.get("STRIPE_LIVEMODE"),STRIPE_RETURN_ORIGIN:Deno.env.get("STRIPE_RETURN_ORIGIN")});
  const args=(id:string,hash:string,origin:string,version:string)=>({p_grant_id:id,p_collection_token_hash:hash,p_origin:origin,p_key_version:version});
  return createPaymentAccessHandler(role,{
    config:()=>paymentAccessConfig({origin:Deno.env.get("PAYMENT_ACCESS_ORIGIN"),activeKeyVersion:Deno.env.get("PAYMENT_ACCESS_ACTIVE_KEY_VERSION"),keys:Deno.env.get("PAYMENT_ACCESS_KEYS"),collectionEnabled:Deno.env.get("PAYMENT_COLLECTION_ENABLED"),statusEnabled:Deno.env.get("PAYMENT_STATUS_ENABLED")}),
    providerEnabled:Deno.env.get("STRIPE_PAYMENTS_ENABLED")==="true",
    collectionsEnabled:Deno.env.get("STRIPE_COLLECTIONS_ENABLED")==="true",
    context:id=>rpc("payment_collection_access_context",{p_grant_id:id}),
    inspect:(id,hash,origin,version)=>rpc("inspect_payment_collection",args(id,hash,origin,version)),
    status:(id,hash,origin,version)=>rpc("read_payment_collection_status",{p_grant_id:id,p_status_token_hash:hash,p_origin:origin,p_key_version:version}),
    activate:(id,hash,origin,version,allowCreate)=>rpc<PaymentActivation>("activate_payment_collection",{...args(id,hash,origin,version),p_allow_create:allowCreate}),
    create:intent=>provider().createCheckout(intent),retrieve:id=>provider().retrieveCheckout(id),
    quarantine:async id=>{await rpc("record_payment_reconciliation",{p_family:"checkout",p_request_id:id,p_reason:"provider_context_mismatch"});},
    apply:async(intent,evidence,eventId)=>{
      const result=await rpc<{disposition:"accepted"|"quarantined"}>("apply_checkout_evidence",{p_event_id:eventId,p_request_id:intent.id,p_account_id:intent.account_id,p_livemode:intent.livemode,p_kind:evidence.state,p_session_id:evidence.session_id,p_payment_id:evidence.payment_id,p_amount_cents:evidence.amount_cents,p_currency:evidence.currency,p_source_hash:intent.source_hash});
      return result.disposition;
    },
  });
}
