import {checkoutEvidence,refundEvidence} from "./stripe-provider.ts";
import type {CheckoutIntent,RefundIntent,StripeObject} from "./stripe-provider.ts";
export interface ReconciliationDatabase {rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}>;}
export interface ReconciliationDependencies {
  enabled:boolean;providerEnabled:boolean;origin:string|null;
  authenticate:(token:string)=>Promise<{actorId:string;db:ReconciliationDatabase}|null>;
  service:ReconciliationDatabase;
  retrieveCheckout:(objectId:string,accountId:string,livemode:boolean)=>Promise<StripeObject>;
  retrieveRefund:(objectId:string,accountId:string,livemode:boolean)=>Promise<StripeObject>;
  now?:()=>number;
}
interface Blocker {kind:string;id:string;}
interface CaseRecord {id:string;invoice_id:string;actor_id:string;family:string;request_id:string;provider_object_id:string;blocker_refs:Blocker[];snapshot_hash:string;created_at:string;}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,hash=/^[a-f0-9]{64}$/;
function invalid():never{throw new Error("Reconciliation unavailable");}
function obj(v:unknown):Record<string,unknown>{if(!v||typeof v!=="object"||Array.isArray(v))invalid();return v as Record<string,unknown>;}
function str(v:unknown,re:RegExp){if(typeof v!=="string"||!re.test(v))invalid();return v;}
function date(v:unknown){if(typeof v!=="string"||!Number.isFinite(Date.parse(v)))invalid();return v;}
function refs(v:unknown):Blocker[]{if(!Array.isArray(v)||v.length>100)invalid();return v.map(value=>{const r=obj(value);if(Object.keys(r).sort().join(",")!=="id,kind")invalid();return {kind:str(r.kind,/^(observation|checkout_evidence|refund_evidence)$/),id:str(r.id,uuid)};});}
function proof(v:unknown,c:CaseRecord){
 const p=obj(v),family=str(p.family,/^(checkout|refund)$/);
 const common={family,request_id:str(p.request_id,uuid),object_id:str(p.object_id,/^(cs_|re_)[A-Za-z0-9_]+$/),account_id:str(p.account_id,/^acct_[A-Za-z0-9]+$/),livemode:p.livemode,amount_cents:str(p.amount_cents,/^[1-9][0-9]{0,7}$/),currency:p.currency,provider_observed_at:date(p.provider_observed_at),status:str(p.status,family==="checkout"?/^(session_open|session_expired|payment_succeeded)$/:/^(pending|failed|succeeded)$/)};
 if(typeof common.livemode!=="boolean"||common.currency!=="usd"||common.family!==c.family||common.request_id!==c.request_id||common.object_id!==c.provider_object_id)invalid();
 return family==="checkout"?{...common,payment_id:p.payment_id===null?null:str(p.payment_id,/^pi_[A-Za-z0-9]+$/),source_hash:str(p.source_hash,hash)}:{...common,provider_payment_id:str(p.provider_payment_id,/^pi_[A-Za-z0-9]+$/)};
}
export function safeReconciliation(value:unknown,actor:string,caseId:string){
 if(value===null)return null;
 const envelope=obj(value),c=obj(envelope.case);
 const row:CaseRecord={id:str(c.id,uuid),invoice_id:str(c.invoice_id,uuid),actor_id:str(c.actor_id,uuid),family:str(c.family,/^(checkout|refund)$/),request_id:str(c.request_id,uuid),provider_object_id:str(c.provider_object_id,/^(cs_|re_)[A-Za-z0-9_]+$/),blocker_refs:refs(c.blocker_refs),snapshot_hash:str(c.snapshot_hash,hash),created_at:date(c.created_at)};
 if(row.id!==caseId||row.actor_id!==actor||row.blocker_refs.length===0)invalid();
 let capture=null,resolution=null;
 if(envelope.capture!==null){const p=obj(envelope.capture);if(p.case_id!==row.id)invalid();capture={case_id:row.id,evidence:proof(p.evidence,row),proof_hash:str(p.proof_hash,hash),provider_observed_at:date(p.provider_observed_at),created_at:date(p.created_at)};if(capture.provider_observed_at!==capture.evidence.provider_observed_at&&Date.parse(capture.provider_observed_at)!==Date.parse(capture.evidence.provider_observed_at))invalid();}
 if(envelope.resolution!==null){const r=obj(envelope.resolution);if(r.case_id!==row.id||r.actor_id!==actor||!capture||r.proof_hash!==capture.proof_hash)invalid();resolution={case_id:row.id,actor_id:actor,proof_hash:capture.proof_hash,ledger_evidence_id:str(r.ledger_evidence_id,uuid),created_at:date(r.created_at)};}
 return {case:row,capture,resolution};
}
async function rpc(db:ReconciliationDatabase,name:string,args:Record<string,unknown>){const result=await db.rpc(name,args);if(result.error)throw result.error;return result.data;}
function code(error:unknown){return error&&typeof error==="object"&&"code"in error?String(error.code):"";}
async function body(request:Request){
 if(!request.body||request.headers.get("Content-Type")?.split(";")[0].trim()!=="application/json")invalid();
 const reader=request.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>16384){await reader.cancel();invalid();}chunks.push(part.value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 const input=obj(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes)));
 if(typeof input.action!=="string"||!["preview","prepare","recover"].includes(input.action))invalid();
 const keys=input.action==="recover"?["action","p_case_id"]:["action","p_invoice_id","p_family","p_request_id","p_provider_object_id",...(input.action==="prepare"?["p_case_id","p_blocker_refs","p_expected_case_hash"]:[])];
 if(Object.keys(input).sort().join(",")!==keys.sort().join(","))invalid();
 if(input.action!=="preview")str(input.p_case_id,uuid);
 if(input.action!=="recover"){
  str(input.p_invoice_id,uuid);str(input.p_request_id,uuid);str(input.p_family,/^(checkout|refund)$/);
  str(input.p_provider_object_id,input.p_family==="checkout"?/^cs_(test_|live_)?[A-Za-z0-9]+$/:/^re_[A-Za-z0-9]+$/);
 }
 if(input.action==="prepare"){if(refs(input.p_blocker_refs).length===0)invalid();str(input.p_expected_case_hash,hash);}
 return input;
}
export function createReconciliationHandler(deps:ReconciliationDependencies){return async(request:Request):Promise<Response>=>{
 const headers={"Cache-Control":"no-store, private","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff","Vary":"Origin",...(deps.origin?{"Access-Control-Allow-Origin":deps.origin}:{})};
 const reply=(status:number,value:unknown)=>Response.json(value,{status,headers});
 const deny=(status:number)=>reply(status,{error:"Reconciliation unavailable"});
 if(!deps.enabled||!deps.origin)return deny(503);
 if(request.headers.get("Origin")&&request.headers.get("Origin")!==deps.origin)return deny(403);
 if(request.method==="OPTIONS")return new Response(null,{status:204,headers:{...headers,"Access-Control-Allow-Methods":"POST","Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info"}});
 if(request.method!=="POST"||new URL(request.url).search)return deny(405);
 const token=request.headers.get("Authorization")?.match(/^Bearer (\S+)$/)?.[1];if(!token)return deny(401);
 let auth:Awaited<ReturnType<ReconciliationDependencies["authenticate"]>>;
 try{auth=await deps.authenticate(token);}catch{return deny(503);}if(!auth)return deny(401);
 let input:Record<string,unknown>;
 try{input=await body(request);}catch{return deny(400);}
 const {action,...args}=input;
 const caseId=String(args.p_case_id);
 const read=async()=>safeReconciliation(await rpc(auth!.db,"read_payment_reconciliation",{p_case_id:caseId}),auth!.actorId,caseId);
 if(action==="recover"){try{return reply(200,await read());}catch(error){return deny(code(error)==="42501"?404:503);}}
 const previewArgs={p_invoice_id:args.p_invoice_id,p_family:args.p_family,p_request_id:args.p_request_id,p_provider_object_id:args.p_provider_object_id};
 const preview=async()=>{
  const target=obj(await rpc(auth!.db,"preview_payment_reconciliation",previewArgs));
  const context=obj(target.context);
  if(context.id!==args.p_request_id||context.invoice_id!==args.p_invoice_id||context[args.p_family==="checkout"?"session_id":"refund_id"]!==args.p_provider_object_id||typeof context.livemode!=="boolean"||context.currency!=="usd")invalid();
  return {context,public:{invoice_id:str(args.p_invoice_id,uuid),family:str(args.p_family,/^(checkout|refund)$/),request_id:str(args.p_request_id,uuid),provider_object_id:String(args.p_provider_object_id),amount_cents:str(context.amount_cents,/^[1-9][0-9]{0,7}$/),currency:"usd",account_id:str(context.account_id,/^acct_[A-Za-z0-9]+$/),livemode:context.livemode,blocker_refs:refs(target.blocker_refs),snapshot_hash:str(target.snapshot_hash,hash)}};
 };
 if(action==="preview"){try{return reply(200,(await preview()).public);}catch(error){return deny(code(error)==="42501"?404:["23514","22023","40001"].includes(code(error))?409:503);}}
 let prepared=false;
 try{
  // This authenticated SQL RPC is the authority for exact case-argument equality.
  const saved=safeReconciliation(await rpc(auth.db,"prepare_payment_reconciliation",args),auth.actorId,caseId);
  if(!saved)invalid();prepared=true;
  if(saved.capture||saved.resolution)return reply(200,saved);
  if(!deps.providerEnabled)return deny(503);
  const current=await preview();if(current.public.snapshot_hash!==saved.case.snapshot_hash)throw {code:"40001"};
  const checkout=args.p_family==="checkout";
  const value=checkout?await deps.retrieveCheckout(String(args.p_provider_object_id),current.public.account_id,current.public.livemode):await deps.retrieveRefund(String(args.p_provider_object_id),current.public.account_id,current.public.livemode);
  if(value.id!==args.p_provider_object_id)throw {code:"23514"};
  let evidence:Record<string,unknown>;
  const common={family:args.p_family,request_id:args.p_request_id,object_id:args.p_provider_object_id,account_id:current.public.account_id,livemode:current.public.livemode,amount_cents:current.public.amount_cents,currency:"usd"};
  if(checkout){const normalized=checkoutEvidence(value,current.context as unknown as CheckoutIntent);if(normalized.state==="reconciliation")throw {code:"23514"};evidence={...common,status:normalized.state,payment_id:normalized.payment_id,source_hash:current.context.source_hash};}
  else{const normalized=refundEvidence(value,current.context as unknown as RefundIntent);evidence={...common,status:normalized.status,provider_payment_id:normalized.provider_payment_id};}
  evidence.provider_observed_at=new Date(deps.now?.()??Date.now()).toISOString();
  await rpc(deps.service,"capture_payment_reconciliation",{p_case_id:caseId,p_reviewer_id:auth.actorId,p_provider_evidence:evidence});
  const captured=await read();if(!captured?.capture)invalid();return reply(200,captured);
 }catch(error){
  if(prepared){try{const recovered=await read();if(recovered?.capture)return reply(200,recovered);}catch{/* Capture remains uncertain. */}}
  if(["23505","23514","22023","40001"].includes(code(error)))return deny(409);
  if(code(error)==="42501")return deny(404);
  return reply(202,{error:"Reconciliation proof unconfirmed",case_id:caseId,retry_requires_recovery:true});
 }
};}
