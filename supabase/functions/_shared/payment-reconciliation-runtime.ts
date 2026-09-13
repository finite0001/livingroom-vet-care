import {createClient} from "https://esm.sh/@supabase/supabase-js@2.110.3";
import {createReconciliationHandler} from "./payment-reconciliation-http.ts";
import {createStripeProvider} from "./stripe-provider.ts";
export function paymentReconciliationRuntime(){
 const client=(token?:string)=>createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get(token?"SUPABASE_ANON_KEY":"SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false,autoRefreshToken:false},...(token?{global:{headers:{Authorization:`Bearer ${token}`}}}:{})});
 const provider=(account:string,live:boolean)=>{
  if(account!==Deno.env.get("STRIPE_ACCOUNT_ID")||String(live)!==Deno.env.get("STRIPE_LIVEMODE"))throw new Error("Provider configuration unavailable");
  return createStripeProvider({STRIPE_PAYMENTS_ENABLED:Deno.env.get("STRIPE_PAYMENTS_ENABLED"),STRIPE_SECRET_KEY:Deno.env.get("STRIPE_SECRET_KEY"),STRIPE_ACCOUNT_ID:Deno.env.get("STRIPE_ACCOUNT_ID"),STRIPE_LIVEMODE:Deno.env.get("STRIPE_LIVEMODE"),STRIPE_RETURN_ORIGIN:Deno.env.get("STRIPE_RETURN_ORIGIN")});
 };
 let origin:string|null=null;try{const configured=Deno.env.get("APP_URL");const url=new URL(configured??"");if(url.protocol==="https:"&&url.origin===configured)origin=url.origin;}catch{/* Disabled origin. */}
 return createReconciliationHandler({enabled:Deno.env.get("STRIPE_RECONCILIATION_ENABLED")==="true",providerEnabled:Deno.env.get("STRIPE_PAYMENTS_ENABLED")==="true",origin,
 authenticate:async token=>{const{data,error}=await client().auth.getUser(token);if(error||!data.user)return null;return {actorId:data.user.id,db:client(token)};},
 service:{rpc:async(name,args)=>{const{data,error}=await client().rpc(name,args);if(error)throw error;return {data,error:null};}},
 retrieveCheckout:(id,account,live)=>provider(account,live).retrieveCheckout(id),retrieveRefund:(id,account,live)=>provider(account,live).retrieveRefund(id),
 });
}
