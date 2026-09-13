import { materializePaymentDelivery, type PaymentDeliveryContext } from "./payment-delivery-payload.ts";
import type { PaymentAccessConfig } from "./payment-access-capability.ts";
import type { PaymentStaffDatabase } from "./payment-access-staff.ts";
export interface PaymentDeliveryStaffDependencies {
  enabled: boolean;
  origin: string | null;
  authenticate: (token: string) => Promise<{actorId: string; db: PaymentStaffDatabase} | null>;
  service: PaymentStaffDatabase;
  config: () => PaymentAccessConfig;
  sender: (channel: "EMAIL" | "SMS") => Record<string,string>;
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hash=/^[a-f0-9]{64}$/;
function object(value: unknown): value is Record<string,unknown> {return !!value && typeof value === "object" && !Array.isArray(value);}
function unavailable():never {throw new Error("Payment delivery unavailable");}
const requestKeys=["id","grant_id","actor_id","invoice_id","client_id","source_hash","amount_cents","conversation_id","channel","recipient","subject","body_template","invoice_email_request_id","invoice_payload_hash","created_at"];
/** Only known actor-owned fields leave the service. No grant context, capability or provider credentials. */
export function safePaymentDelivery(value:unknown,actor:string,id:string) {
 if(value===null)return null;
 if(!object(value)||!object(value.request))unavailable();
 const r=value.request;
 if(r.id!==id||r.actor_id!==actor||!["id","grant_id","actor_id","invoice_id","client_id","conversation_id"].every(k=>typeof r[k]==="string"&&uuid.test(r[k] as string))||
 typeof r.amount_cents!=="string"||!/^[1-9][0-9]{0,7}$/.test(r.amount_cents)||typeof r.source_hash!=="string"||!hash.test(r.source_hash)||
 !["EMAIL","SMS"].includes(r.channel as string)||!["recipient","subject","body_template","created_at"].every(k=>typeof r[k]==="string"))unavailable();
 const request=Object.fromEntries(requestKeys.map(k=>[k,r[k]]));
 let capture=null;
 if(value.capture!==null){
 const c=value.capture;if(!object(c)||c.request_id!==id||!object(c.sender_config)||typeof c.message_hash!=="string"||!hash.test(c.message_hash)||typeof c.payload_hash!=="string"||!hash.test(c.payload_hash)||typeof c.captured_at!=="string")unavailable();
 const keys=r.channel==="EMAIL"?["from","reply_to"]:["from","account_sid"];
 if(Object.keys(c.sender_config).sort().join()!==keys.sort().join()||!keys.every(k=>typeof (c.sender_config as Record<string,unknown>)[k]==="string"))unavailable();
 capture={request_id:id,sender_config:Object.fromEntries(keys.map(k=>[k,(c.sender_config as Record<string,unknown>)[k]])),message_hash:c.message_hash,payload_hash:c.payload_hash,captured_at:c.captured_at};
 }
 let receipt=null;
 if(value.receipt!==null){const v=value.receipt;if(!object(v)||typeof v.outbox_id!=="string"||!uuid.test(v.outbox_id)||typeof v.message_id!=="string"||!uuid.test(v.message_id)||typeof v.state!=="string"||v.queued!==true||typeof v.delivered!=="boolean")unavailable();receipt={outbox_id:v.outbox_id,message_id:v.message_id,state:v.state,queued:true,delivered:v.delivered};}
 return {request,capture,receipt};
}
async function rpc(db:PaymentStaffDatabase,name:string,args:Record<string,unknown>){const {data,error}=await db.rpc(name,args);if(error)throw error;return data;}
const prepareKeys=["p_request_id","p_grant_id","p_conversation_id","p_channel","p_recipient","p_subject","p_body_template","p_invoice_email_request_id","p_invoice_payload_hash"];
export function createPaymentDeliveryStaffHandler(deps:PaymentDeliveryStaffDependencies){return async(req:Request)=>{
 const headers={"Content-Type":"application/json","Cache-Control":"no-store","Pragma":"no-cache","Access-Control-Allow-Origin":deps.origin??"null","Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info","Access-Control-Allow-Methods":"POST,OPTIONS","Vary":"Origin"};
 const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers});
 if(!deps.origin)return json({error:"Staff payment delivery unavailable"},503);
 if(req.headers.has("Origin")&&req.headers.get("Origin")!==deps.origin)return json({error:"Origin unavailable"},403);
 if(req.method==="OPTIONS")return new Response(null,{headers});
 if(req.method!=="POST")return json({error:"Method not allowed"},405);
 if(new URL(req.url).search)return json({error:"Query parameters are not accepted"},400);
 const token=req.headers.get("Authorization")?.match(/^Bearer (\S+)$/)?.[1];
 if(!token)return json({error:"Staff authorization required"},401);
 let id:string|undefined;
 try{
 const auth=await deps.authenticate(token);if(!auth)return json({error:"Staff authorization required"},401);
 if(req.headers.get("Content-Type")?.split(";")[0].trim()!=="application/json")return json({error:"JSON required"},415);
 if(!req.body)return json({error:"JSON required"},400);
 const reader=req.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>450000){await reader.cancel();return json({error:"Request too large"},413);}chunks.push(chunk.value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 const raw=new TextDecoder("utf-8",{fatal:true}).decode(bytes);
 let body:unknown;try{body=JSON.parse(raw);}catch{return json({error:"Invalid JSON"},400);}
 if(!object(body)||typeof body.action!=="string"||!["prepare","recover","review"].includes(body.action)||typeof body.p_request_id!=="string"||!uuid.test(body.p_request_id))return json({error:"Exact payment delivery request required"},400);
 id=body.p_request_id;const action=body.action;const {action:_action,...args}=body;
 const keys=action==="prepare"?prepareKeys:["p_request_id"];
 if(Object.keys(args).sort().join()!==[...keys].sort().join())return json({error:"Exact payment delivery request required"},400);
 if(action==="prepare"&&(!["p_grant_id","p_conversation_id"].every(k=>typeof args[k]==="string"&&uuid.test(args[k] as string))||!["EMAIL","SMS"].includes(args.p_channel as string)||!["p_recipient","p_subject","p_body_template"].every(k=>typeof args[k]==="string")||!(args.p_invoice_email_request_id===null||(typeof args.p_invoice_email_request_id==="string"&&uuid.test(args.p_invoice_email_request_id)))||!(args.p_invoice_payload_hash===null||(typeof args.p_invoice_payload_hash==="string"&&hash.test(args.p_invoice_payload_hash)))))return json({error:"Invalid payment delivery intent"},400);
 const recover=async()=>safePaymentDelivery(await rpc(auth.db,"recover_payment_delivery",{p_request_id:id}),auth.actorId,id!);
 if(action==="recover")return json({delivery:await recover()});
 if(!deps.enabled)return json({error:"Payment delivery preparation is disabled"},503);
 // SQL acknowledgement is authoritative. A rejected or uncertain exact preparation never becomes success through recovery.
 let delivery=action==="prepare"?safePaymentDelivery(await rpc(auth.db,"prepare_payment_delivery",args),auth.actorId,id):await recover();
 if(!delivery)return json({error:"Payment delivery unavailable"},404);
 if(delivery.receipt || (action==="prepare"&&delivery.capture))return json({delivery});
 const context=await rpc(deps.service,"payment_delivery_capture_context",{p_request_id:id,p_actor_id:auth.actorId}) as PaymentDeliveryContext;
 if(context.request.grant_id!==delivery.request.grant_id||context.request.actor_id!==auth.actorId)unavailable();
 const sender=deps.sender(context.request.channel);
 const payload=await materializePaymentDelivery(context,deps.config(),sender);
 if(action==="prepare"){
 await rpc(deps.service,"capture_payment_delivery",{p_request_id:id,p_actor_id:auth.actorId,p_sender_config:sender,p_message_hash:payload.message_hash,p_payload_hash:payload.payload_hash});
 delivery=await recover();if(!delivery?.capture)unavailable();return json({delivery});
 }
 if(!delivery.capture||delivery.capture.message_hash!==payload.message_hash||delivery.capture.payload_hash!==payload.payload_hash)unavailable();
 // Preview is intentionally transient and must never be placed in browser persistence or logs.
 const attachment=context.invoice_payload_text?JSON.parse(context.invoice_payload_text).attachments[0]:null;
 return json({delivery,preview:{message:payload.message,recipient:context.request.recipient,subject:context.request.subject,sender,attachment}});
 }catch(error){const code=object(error)&&typeof error.code==="string"?error.code:"";const status=code==="42501"?404:["23505","23514","22023","40001"].includes(code)?409:202;
 return json({error:status===404?"Payment delivery unavailable":status===409?"Saved delivery differs or is no longer eligible. Recover the request.":"Preparation or review was not confirmed. Recover the same request before retrying.",request_id:id,retry_requires_recovery:true},status);}
};}
