/** Test-only HTTP server: actual local Auth/PostgREST, synthetic retrieval, no Stripe key. */
import {createClient} from "https://esm.sh/@supabase/supabase-js@2.110.3";
import {createReconciliationHandler} from "../../supabase/functions/_shared/payment-reconciliation-http.ts";
const url=Deno.env.get("SUPABASE_URL")!;
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(url))throw new Error("Local database required");
const service=createClient(url,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false,autoRefreshToken:false}});
let retrieved=0;
const handler=createReconciliationHandler({enabled:true,providerEnabled:true,origin:Deno.env.get("APP_URL")!,service,
 authenticate:async token=>{const{data,error}=await service.auth.getUser(token);if(error||!data.user)return null;return {actorId:data.user.id,db:createClient(url,Deno.env.get("SUPABASE_ANON_KEY")!,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:`Bearer ${token}`}}})};},
 retrieveCheckout:async(id,account,live)=>{
  const{data:context,error}=await service.rpc("provider_checkout_context",{p_request_id:Deno.env.get("PAYMENT_TEST_REQUEST_ID")!});if(error)throw error;
  if(id!==context.session_id||account!==context.account_id||live!==false)throw new Error("Unexpected synthetic retrieval");retrieved++;
  return {object:"checkout.session",id,livemode:false,mode:"payment",currency:"usd",amount_total:Number(context.amount_cents),client_reference_id:context.id,metadata:{request_id:context.id,source_hash:context.source_hash},expires_at:Math.floor(Date.parse(context.session_expires_at)/1000),invoice:null,recovered_from:null,status:"open",payment_status:"unpaid",payment_intent:null,url:"https://checkout.stripe.com/c/pay/synthetic",customer_details:{email:"private@example.test"}};
 },retrieveRefund:async()=>{throw new Error("Refund retrieval outside local fixture");},
});
Deno.serve({hostname:"127.0.0.1",port:56491},request=>{
 const path=new URL(request.url).pathname;
 if(path==="/health")return new Response("ready");
 if(path==="/stats")return Response.json({retrieved});
 return handler(request);
});
