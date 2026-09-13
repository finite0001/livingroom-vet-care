import {createClient} from "https://esm.sh/@supabase/supabase-js@2.110.3";
import {paymentAccessConfig} from "./payment-access-capability.ts";
import {createPaymentDeliveryStaffHandler} from "./payment-delivery-staff.ts";
export function paymentDeliveryStaffRuntime(){
 const client=(token?:string)=>createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get(token?"SUPABASE_ANON_KEY":"SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false,autoRefreshToken:false},...(token?{global:{headers:{Authorization:`Bearer ${token}`}}}:{})});
 let origin:string|null=null;try{const configured=Deno.env.get("APP_URL"),url=new URL(configured??"");if(url.origin===configured&&(url.protocol==="https:"||(url.protocol==="http:"&&["localhost","127.0.0.1"].includes(url.hostname))))origin=url.origin;}catch{/* Invalid origin fails closed. */}
 return createPaymentDeliveryStaffHandler({enabled:Deno.env.get("PAYMENT_DELIVERY_STAFF_ENABLED")==="true",origin,
 authenticate:async token=>{const {data,error}=await client().auth.getUser(token);if(error||!data.user)return null;return {actorId:data.user.id,db:client(token)};},
 service:{rpc:async(name,args)=>{const {data,error}=await client().rpc(name,args);if(error)throw error;return {data,error:null};}},
 config:()=>paymentAccessConfig({origin:Deno.env.get("PAYMENT_ACCESS_ORIGIN"),activeKeyVersion:Deno.env.get("PAYMENT_ACCESS_ACTIVE_KEY_VERSION"),keys:Deno.env.get("PAYMENT_ACCESS_KEYS"),collectionEnabled:Deno.env.get("PAYMENT_COLLECTION_ENABLED"),statusEnabled:Deno.env.get("PAYMENT_STATUS_ENABLED")}),
 sender:(channel):Record<string,string>=>channel==="EMAIL"?{from:Deno.env.get("RESEND_FROM")??"",reply_to:Deno.env.get("RESEND_REPLY_TO")??""}:{from:Deno.env.get("TWILIO_FROM_NUMBER")??"",account_sid:Deno.env.get("TWILIO_ACCOUNT_SID")??""},
 });
}
