import {hashPrivateLabResponse as hashPrivateResponse} from "./lab-report-verification.ts";
/** Manual report provenance verification. No ezyVet traffic or authenticity claim. */
export interface ExternalRecordDatabase {rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}>;}
export interface PrivateExternalDocument {id:string;version:number;bucket:string;file_path:string;file_size:number;mime_type:string;}
export interface ExternalRecordDependencies {
 enabled:boolean;origin:string|null;
 authenticate:(token:string)=>Promise<{actorId:string;db:ExternalRecordDatabase}|null>;
 service:ExternalRecordDatabase;
 download:(document:PrivateExternalDocument)=>Promise<Response>;
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,hash=/^[a-f0-9]{64}$/;
const mimeTypes=["application/pdf","image/jpeg","image/png"],maxBytes=20971520;
function unavailable():never{throw new Error("External record verification unavailable");}
function object(v:unknown):Record<string,unknown>{if(!v||typeof v!=="object"||Array.isArray(v))unavailable();return v as Record<string,unknown>;}
function text(v:unknown,re:RegExp){if(typeof v!=="string"||!re.test(v))unavailable();return v;}
function integer(v:unknown,max=2147483647){if(typeof v!=="number"||!Number.isSafeInteger(v)||v<1||v>max)unavailable();return v;}
function timestamp(v:unknown){if(typeof v!=="string"||!Number.isFinite(Date.parse(v)))unavailable();return v;}
function mime(v:unknown){if(typeof v!=="string"||!mimeTypes.includes(v))unavailable();return v;}
function receipt(value:unknown,actor:string,id:string){
 const r=object(value);const row={id:text(r.id,uuid),actor_id:text(r.actor_id,uuid),animal_link_id:text(r.animal_link_id,uuid),pet_id:text(r.pet_id,uuid),pet_version:integer(r.pet_version),document_id:text(r.document_id,uuid),document_version:integer(r.document_version),source_origin:text(r.source_origin,/^https:\/\/[^\s]+$/),source_site_uid:text(r.source_site_uid,/^[\s\S]{1,4096}$/),source_animal_id:text(r.source_animal_id,/^[\s\S]{1,500}$/),export_reference:text(r.export_reference,/^[\s\S]{1,500}$/),received_at:timestamp(r.received_at),previous_record_id:r.previous_record_id===null?null:text(r.previous_record_id,uuid),review_reason:text(r.review_reason,/^[\s\S]{1,2000}$/),mime_type:mime(r.mime_type),file_size:integer(r.file_size,maxBytes),receipt_hash:text(r.receipt_hash,hash),entry_method:r.entry_method,created_at:timestamp(r.created_at)};
 if(row.id!==id||row.actor_id!==actor||row.entry_method!=="staff_reviewed_manual_export_v1")unavailable();return row;
}
export function safeExternalRecord(value:unknown,actor:string,id:string){
 if(value===null)return null;const envelope=object(value),r=receipt(envelope.receipt,actor,id);let capture=null,record=null;
 if(envelope.capture!==null){const c=object(envelope.capture);if(c.receipt_id!==id||c.actor_id!==actor||c.receipt_hash!==r.receipt_hash||c.document_version!==r.document_version||c.file_size!==r.file_size||c.mime_type!==r.mime_type)unavailable();capture={receipt_id:id,actor_id:actor,receipt_hash:r.receipt_hash,document_version:r.document_version,content_sha256:text(c.content_sha256,hash),file_size:r.file_size,mime_type:r.mime_type,capture_hash:text(c.capture_hash,hash),captured_at:timestamp(c.captured_at)};}
 if(envelope.record!==null){const v=object(envelope.record);if(!capture||v.actor_id!==actor||v.receipt_id!==id||v.receipt_hash!==r.receipt_hash||v.capture_hash!==capture.capture_hash||v.document_id!==r.document_id||v.document_version!==r.document_version||v.pet_id!==r.pet_id||v.pet_version!==r.pet_version||v.animal_link_id!==r.animal_link_id||v.export_reference!==r.export_reference||v.previous_record_id!==r.previous_record_id||v.review_reason!==r.review_reason)unavailable();record={id:text(v.id,uuid),actor_id:actor,receipt_id:id,animal_link_id:r.animal_link_id,pet_id:r.pet_id,pet_version:r.pet_version,document_id:r.document_id,document_version:r.document_version,receipt_hash:r.receipt_hash,capture_hash:capture.capture_hash,export_reference:r.export_reference,previous_record_id:r.previous_record_id,version:integer(v.version),kind:text(v.kind,/^(original|replacement)$/),review_reason:r.review_reason,created_at:timestamp(v.created_at)};}

 return {receipt:r,capture,record};
}
async function rpc(db:ExternalRecordDatabase,name:string,args:Record<string,unknown>){const {data,error}=await db.rpc(name,args);if(error)throw error;return data;}
const stageKeys=["p_id","p_animal_link_id","p_expected_pet_version","p_document_id","p_document_version","p_export_reference","p_received_at","p_previous_record_id","p_review_reason"];
function errorCode(error:unknown){return error&&typeof error==="object"&&"code"in error?String(error.code):"";}
export function createExternalRecordVerificationHandler(deps:ExternalRecordDependencies){return async(req:Request)=>{
 const headers={"Cache-Control":"no-store, private","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff","Vary":"Origin",...(deps.origin?{"Access-Control-Allow-Origin":deps.origin}:{})};
 const reply=(status:number,v:unknown)=>Response.json(v,{status,headers});const deny=(status:number)=>reply(status,{error:"External record verification unavailable"});
 if(!deps.origin)return deny(503);if(req.headers.has("Origin")&&req.headers.get("Origin")!==deps.origin)return deny(403);
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:{...headers,"Access-Control-Allow-Methods":"POST","Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info"}});
 if(req.method!=="POST"||new URL(req.url).search)return deny(405);
 const token=req.headers.get("Authorization")?.match(/^Bearer (\S+)$/)?.[1];if(!token)return deny(401);
 let auth:Awaited<ReturnType<ExternalRecordDependencies["authenticate"]>>;try{auth=await deps.authenticate(token);}catch{return deny(503);}if(!auth)return deny(401);
 let input:Record<string,unknown>;
 try{
  if(!req.body||req.headers.get("Content-Type")?.split(";")[0].trim()!=="application/json")unavailable();
  const reader=req.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>16384){await reader.cancel();unavailable();}chunks.push(part.value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.length;}
  input=object(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes)));
  if(input.action!=="prepare"&&input.action!=="recover")unavailable();
  const keys=input.action==="prepare"?stageKeys:["p_receipt_id"];if(Object.keys(input).sort().join()!==["action",...keys].sort().join())unavailable();
  if(input.action==="prepare"){for(const k of ["p_id","p_animal_link_id","p_document_id"])text(input[k],uuid);integer(input.p_document_version);integer(input.p_expected_pet_version);text(input.p_export_reference,/^[\s\S]{1,500}$/);text(input.p_review_reason,/^[\s\S]{1,2000}$/);if(input.p_previous_record_id!==null)text(input.p_previous_record_id,uuid);timestamp(input.p_received_at);}else text(input.p_receipt_id,uuid);
 }catch{return deny(400);}
 const {action,...args}=input,id=String(action==="prepare"?args.p_id:args.p_receipt_id);
 const recover=async()=>safeExternalRecord(await rpc(auth.db,"recover_external_record_receipt",{p_receipt_id:id}),auth.actorId,id);
 if(action==="recover"){try{return reply(200,await recover());}catch(error){return deny(errorCode(error)==="42501"?404:503);}}
 if(!deps.enabled)return deny(503);
 let captureAttempted=false,expectedDigest:string|null=null;
 try{
  const staged=receipt(await rpc(auth.db,"stage_external_record_receipt",args),auth.actorId,id);
  if(staged.animal_link_id!==args.p_animal_link_id||staged.pet_version!==args.p_expected_pet_version||staged.document_id!==args.p_document_id||staged.document_version!==args.p_document_version||staged.export_reference!==args.p_export_reference||staged.previous_record_id!==args.p_previous_record_id||staged.review_reason!==args.p_review_reason)unavailable();
  const saved=await recover();if(!saved||saved.receipt.receipt_hash!==staged.receipt_hash)unavailable();if(saved.capture)return reply(200,saved);
  const context=object(await rpc(deps.service,"external_record_capture_context",{p_receipt_id:id,p_actor_id:auth.actorId}));
  const current=receipt(context.receipt,auth.actorId,id),d=object(context.document);
  if(current.receipt_hash!==staged.receipt_hash||d.id!==staged.document_id||d.version!==staged.document_version||d.file_size!==staged.file_size||d.mime_type!==staged.mime_type||d.bucket!=="patient-documents")unavailable();
  const path=text(d.file_path,/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/original$/i),segments=path.split("/");if(!uuid.test(segments[0])||segments[1]!==staged.pet_id||segments[2]!==staged.document_id)unavailable();
  const document:PrivateExternalDocument={id:staged.document_id,version:staged.document_version,bucket:"patient-documents",file_path:path,file_size:staged.file_size,mime_type:staged.mime_type};
  const digest=await hashPrivateResponse(await deps.download(document),document);captureAttempted=true;expectedDigest=digest;
  await rpc(deps.service,"capture_external_record_bytes",{p_receipt_id:id,p_actor_id:auth.actorId,p_expected_receipt_hash:staged.receipt_hash,p_document_version:document.version,p_content_sha256:digest,p_file_size:document.file_size,p_mime_type:document.mime_type});
  const verified=await recover();if(!verified?.capture||verified.capture.content_sha256!==digest)unavailable();return reply(200,verified);
 }catch(error){
  const code=errorCode(error);if(["23505","23514","22023","40001"].includes(code))return deny(409);if(code==="42501")return deny(404);
  if(captureAttempted){try{const saved=await recover();if(saved?.capture&&saved.capture.content_sha256===expectedDigest)return reply(200,saved);}catch{/* Unknown acknowledgement remains pending. */}}
  return reply(202,{error:"External record verification unconfirmed",receipt_id:id,retry_requires_recovery:true});
 }
};}
