import { z } from "zod";
import { decodeAdministrationJson } from "../administration/response.ts";
import { reviewJsonbTextBytes } from "../record-review/prepared-packet.ts";
import { hashReviewEvent } from "../record-review/component-hashes.ts";
import { reviewQuantityThousandths } from "../record-review/exact-values.ts";
import { ExactJsonNumber, type ExactJson } from "../record-review/exact-json.ts";
import { parseReviewIdentity, sameReviewIdentity, type ReviewIdentity, type ReviewRpcConfig, type ReviewSessionSource } from "../record-review/raw-rpc.ts";
import { controlledStockWriterSchema } from "./gateway.ts";
import type { ControlledLegacyIntent } from "./legacy-intent.ts";
import { entryObject, entryRequestBody, serializeEntryJson, sameEntryJson, readEntryResponse } from "./codec.ts";
import { canonicalEntryArguments, recoveredEntrySnapshot, entryContextSchema, entryPointerSchema, parseEntryProbe, parseEntryReply, type EntryContext, type EntryPointer, type EntryProbe, type EntryReply } from "./schema.ts";
import {admitGlobalSavedEntry}from"./saved-result.ts";
import { parseRecorderWitnessStatus, type RecorderWitnessStatus } from "../witness/schema.ts";
const configuration=z.object({projectRef:z.string().regex(/^[a-z]{20}$/),url:z.string().url(),publishableKey:z.string().regex(/^sb_publishable_[A-Za-z0-9_-]+$/).max(4096)}).strict().refine(v=>v.url===`https://${v.projectRef}.supabase.co`);
const routes={probe:"probe_controlled_stock_intent_v1",prepare:"prepare_managed_stock_intent_v1",read:"read_managed_stock_intent_v1",execute:"execute_managed_stock_intent_v1",close:"close_managed_stock_intent_v1"}as const;
export class EntryClientError extends Error {
  readonly definitive:boolean;
  constructor(definitive=false){super(definitive?"The original entry was rejected. Review its values and current evidence.":"The entry result is unconfirmed. Check its original operation before continuing.");this.name="EntryClientError";this.definitive=definitive;}
}
export interface EntryClient {
 probe(intent:ControlledLegacyIntent,identity:ReviewIdentity):Promise<EntryProbe>;
 prepare(pointer:EntryPointer,intent:ControlledLegacyIntent,context:EntryContext,identity:ReviewIdentity):Promise<EntryReply>;
 read(pointer:EntryPointer,identity:ReviewIdentity):Promise<EntryReply>;
 execute(pointer:EntryPointer,identity:ReviewIdentity):Promise<EntryReply>;
 executeWitnessed(pointer:EntryPointer,displayed:EntryReply,identity:ReviewIdentity):Promise<EntryReply>;
 witnessStatus(pointer:EntryPointer,identity:ReviewIdentity):Promise<RecorderWitnessStatus>;
 close(pointer:EntryPointer,identity:ReviewIdentity):Promise<EntryReply>;
 complete(pointer:EntryPointer,identity:ReviewIdentity):Promise<EntryReply>;
 legacy(intent:ControlledLegacyIntent,identity:ReviewIdentity):Promise<ExactJson>;
}
function validateIntent(intent:ControlledLegacyIntent):void {
 controlledStockWriterSchema.parse(intent.writer);
 if(entryObject(intent.legacyArguments).p_id!==intent.operationId||intent.requestBody.length>131072||serializeEntryJson(intent.legacyArguments)!==intent.requestBody)throw new EntryClientError(true);
}
function bindLegacy(raw:ExactJson,intent:ControlledLegacyIntent,actorId:string):ExactJson {
 const row=entryObject(raw),a=entryObject(intent.legacyArguments);
 if(row.id!==intent.operationId||(row.actor_id??row.created_by)!==actorId)throw new EntryClientError();
 if(intent.writer==="receive_inventory"||intent.writer==="adjust_inventory"){
  if(row.lot_id!==a.p_lot_id||row.kind!==(intent.writer==="receive_inventory"?"receive":"adjust")||row.reason!==a.p_reason||!(row.quantity instanceof ExactJsonNumber)||!(a.p_quantity instanceof ExactJsonNumber)||reviewQuantityThousandths(row.quantity)!==reviewQuantityThousandths(a.p_quantity))throw new EntryClientError();
 }else{
  let request=a.p_request;
  if(intent.writer==="record_anesthesia_drug_administration")request={...entryObject(request),pet_id:a.p_pet_id,source:"Anesthesia record "+a.p_record_id};
  if(!sameEntryJson(row.request,request))throw new EntryClientError();
 }
 return raw;
}
async function errorCode(response:Response,signal:AbortSignal,deadline:number):Promise<string|null>{
 if(!/^application\/json(?:\s*;|\s*$)/i.test(response.headers.get("content-type")??"")){void response.body?.cancel().catch(()=>{});return null;}
 const reader=response.body?.getReader();if(!reader)return null;let size=0;const raw=new Uint8Array(65536);
 try{
  for(;;){if(signal.aborted||performance.now()>=deadline)throw new EntryClientError();const{value,done}=await reader.read();if(signal.aborted||performance.now()>=deadline)throw new EntryClientError();if(done)break;if(value.byteLength>raw.length-size)throw new EntryClientError();raw.set(value,size);size+=value.byteLength;}
  const object=entryObject(decodeAdministrationJson(raw.subarray(0,size)));
  return typeof object.code==="string"?object.code:null;
 }catch{void reader.cancel().catch(()=>{});return null;}finally{reader.releaseLock();}
}
export function createEntryClient(configInput:ReviewRpcConfig,sessions:ReviewSessionSource,fetcher:typeof fetch=globalThis.fetch):EntryClient {
 const config=Object.freeze(configuration.parse(configInput));
 async function call<T>(rpc:string,body:string,identityInput:ReviewIdentity,admit:(raw:ExactJson,readAuthorization:(pointer:EntryPointer)=>Promise<ExactJson>)=>T|Promise<T>,allowDefinitive=false,before?:(request:(name:string,body:string)=>Promise<ExactJson>)=>Promise<void>):Promise<T>{
  const identity=parseReviewIdentity(identityInput),deadline=performance.now()+30000,abort=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  const check=()=>{if(abort.signal.aborted||performance.now()>=deadline||!sessions.isCurrent(identity))throw new EntryClientError();};
  const request=async(name:string,requestBody:string,definitive:boolean)=>{
   check();const session=await sessions.current();check();
   if(!session||!sameReviewIdentity(session,identity)||!/^[-A-Za-z0-9_]+\.[-A-Za-z0-9_]+\.[-A-Za-z0-9_]+$/.test(session.accessToken)||session.accessToken.length>16384)throw new EntryClientError();
   const response=await fetcher(`${config.url}/rest/v1/rpc/${name}`,{method:"POST",mode:"cors",credentials:"omit",redirect:"error",cache:"no-store",signal:abort.signal,headers:{apikey:config.publishableKey,Authorization:`Bearer ${session.accessToken}`,"Content-Type":"application/json",Accept:"application/json"},body:requestBody});check();
   if(!response.ok){const code=await errorCode(response,abort.signal,deadline);check();const known=definitive&&response.status>=400&&response.status<500&&code!==null&&["23514","23503","23502","23505","42501","PT409","22P02","22003","22007","22008","42883","PGRST202"].includes(code);throw new EntryClientError(known);}
   const raw=await readEntryResponse(response,abort.signal,deadline);check();return raw;
  };
  const work=async()=>{if(before){await before((name,requestBody)=>request(name,requestBody,false));check();}const raw=await request(rpc,body,allowDefinitive);check();const value=await admit(raw,pointer=>request("read_managed_stock_intent_authorization_v1",entryRequestBody(pointer,8192),false));check();return value;};
  try{return await Promise.race([work(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(new EntryClientError());},30000);})]);}
  catch(error){abort.abort();if(error instanceof EntryClientError)throw error;throw new EntryClientError();}finally{clearTimeout(timer);}
 }
 async function operation(method:"prepare"|"read"|"execute"|"close",pointerInput:EntryPointer,identity:ReviewIdentity,intent?:ControlledLegacyIntent,context?:EntryContext,complete=false,witnessed?:EntryReply):Promise<EntryReply>{
  const pointer=entryPointerSchema.parse(pointerInput);if(pointer.actor_id!==identity.actorId)throw new EntryClientError(true);
  let request:unknown=pointer;
  if(method==="prepare"){
   if(!intent||!context||pointer.writer!==intent.writer||pointer.operation_id!==intent.operationId||context.product_id!==pointer.product_id)throw new EntryClientError(true);validateIntent(intent);const canonical=canonicalEntryArguments(intent);entryContextSchema.parse(context);
   // Independently retain the original public v3 facade's five-field cap too.
   entryRequestBody({actor_id:pointer.actor_id,operation_id:pointer.operation_id,writer:pointer.writer,arguments:canonical,context});
   request={...pointer,legacy_arguments:intent.legacyArguments,context};
  }
  const before=witnessed?async(send:(name:string,body:string)=>Promise<ExactJson>)=>{
   if(method!=="execute"||witnessed.state!=="prepared"||!witnessed.data.preparation||witnessed.data.preparation.frozen.permission.witness!=="c2_required"||!sameEntryJson(witnessed.data.pointer,pointer))throw new EntryClientError();
   const fresh=parseEntryReply(await send(routes.read,entryRequestBody(pointer,8192)),pointer);
   if(fresh.state!=="prepared"||!sameEntryJson(fresh.data.preparation,witnessed.data.preparation)||!sameEntryJson(fresh.data.intent,witnessed.data.intent))throw new EntryClientError();
   const status=parseRecorderWitnessStatus(await send("read_managed_stock_witness_status_v1",entryRequestBody(pointer,8192)),pointer);
   if(status.state!=="witnessed")throw new EntryClientError();
  }:undefined;
  return call(routes[method],entryRequestBody(request,method==="prepare"?131072:8192),identity,async(raw,readAuthorization)=>{
   const reply=parseEntryReply(raw,pointer,intent);
   if(method==="prepare"&&(!context||!reply.data.preparation||!sameEntryJson(reply.data.preparation.context,context)))throw new EntryClientError();
   if(reply.state==="saved"&&reply.data.intent&&reply.data.canonical_result)bindLegacy(reply.data.canonical_result,recoveredEntrySnapshot(reply.data.intent),pointer.actor_id);
   if(reply.data.receipt&&await hashReviewEvent(reply.data.receipt.event)!==reply.data.receipt.event.record_hash)throw new EntryClientError();
   if(complete){if(reply.state!=="saved")throw new EntryClientError();await admitGlobalSavedEntry(reply,()=>readAuthorization(pointer));}
   return reply;
  },false,before);
 }
 return Object.freeze({
  probe(intent,identity){validateIntent(intent);return call(routes.probe,entryRequestBody({schema_version:1,actor_id:identity.actorId,writer:intent.writer,legacy_arguments:intent.legacyArguments}),identity,raw=>parseEntryProbe(raw,identity.actorId,intent),true);},
  prepare(pointer,intent,context,identity){return operation("prepare",pointer,identity,intent,context);},
  complete(pointer,identity){return operation("read",pointer,identity,undefined,undefined,true);},
  read(pointer,identity){return operation("read",pointer,identity);},execute(pointer,identity){return operation("execute",pointer,identity);},close(pointer,identity){return operation("close",pointer,identity);},
  executeWitnessed(pointer,displayed,identity){return operation("execute",pointer,identity,undefined,undefined,false,displayed);},
  witnessStatus(pointerInput,identity){const pointer=entryPointerSchema.parse(pointerInput);if(pointer.actor_id!==identity.actorId)throw new EntryClientError();return call("read_managed_stock_witness_status_v1",entryRequestBody(pointer,8192),identity,raw=>parseRecorderWitnessStatus(raw,pointer));},
  legacy(intent,identity){validateIntent(intent);return call(intent.writer,intent.requestBody,identity,raw=>bindLegacy(raw,intent,identity.actorId),true);},
 });
}
