import type { ReviewIdentity } from "../record-review/raw-rpc.ts";
import type { ReviewStaffSessionSource } from "../record-review/staff-session.ts";
import type { ExactJson } from "../record-review/exact-json.ts";
import { ControlledStockWriteError, type ControlledStockWriteHandler, type ControlledStockWriter } from "./gateway.ts";
import { snapshotControlledLegacyIntent, type ControlledLegacyIntent } from "./legacy-intent.ts";
import { EntryClientError, type EntryClient } from "./client.ts";
import { entryIntentMatches, entryPointerSchema, type EntryContext, type EntryPointer, type EntryProbe, type EntryReply } from "./schema.ts";
import { sameEntryJson } from "./codec.ts";
import type { RecorderWitnessStatus } from "../witness/schema.ts";
export interface EntryStorage { getItem(key:string):string|null;setItem(key:string,value:string):void;removeItem(key:string):void }
export interface EntryLock { exclusive<T>(key:string,work:()=>Promise<T>):Promise<T> }
export interface EntryPrompts {
 plan(probe:EntryProbe,identity:Readonly<ReviewIdentity>):Promise<EntryContext|null>;
 inspect(reply:EntryReply,identity:Readonly<ReviewIdentity>,checkWitness?:()=>Promise<RecorderWitnessStatus>):Promise<"execute"|"close"|"leave">;
}
export interface EntryService extends ControlledStockWriteHandler {
 pending(actorId:string):EntryPointer|null;
 recover(mode:"read"|"close",identity:Readonly<ReviewIdentity>):Promise<EntryReply>;
 executePending(identity:Readonly<ReviewIdentity>):Promise<EntryReply>;
 completePending(identity:Readonly<ReviewIdentity>):Promise<EntryReply>;
 witnessStatusPending(identity:Readonly<ReviewIdentity>):Promise<RecorderWitnessStatus>;
}
export function entryStorageKey(actorId:string):string {
 entryPointerSchema.shape.actor_id.parse(actorId);return"lrv:controlled-stock-entry:v1:"+actorId;
}
export function browserEntryLock():EntryLock {
 return{async exclusive(key,work){
  if(!globalThis.navigator?.locks)throw new ControlledStockWriteError("CONTROLLED_ENTRY_UNAVAILABLE",true);
  return navigator.locks.request(key,{mode:"exclusive",ifAvailable:true},lock=>{
   if(!lock)throw new ControlledStockWriteError("CONTROLLED_ENTRY_UNAVAILABLE",true);return work();
  });
 }};
}
function pendingError():never{throw new ControlledStockWriteError("CONTROLLED_ENTRY_PENDING",false);}
function unavailable():never{throw new ControlledStockWriteError("CONTROLLED_ENTRY_UNAVAILABLE",true);}
/** Only IDs persist. Original clinical/body values remain in the caller/service
 * memory. This is a coordinator, never backend source or permission authority. */
export function createEntryService(client:EntryClient,sessions:ReviewStaffSessionSource,storage:EntryStorage,locks:EntryLock,prompts:EntryPrompts):EntryService {
 const volatile=new Map<string,EntryPointer>();
 function pending(actorId:string):EntryPointer|null{
  const text=storage.getItem(entryStorageKey(actorId));
  if(text===null)return volatile.get(actorId)??null;
  if(text.length>8192)pendingError();
  let pointer:EntryPointer;try{pointer=entryPointerSchema.parse(JSON.parse(text));}catch{pendingError();}
  if(pointer.actor_id!==actorId||JSON.stringify(pointer)!==text)pendingError();
  const remembered=volatile.get(actorId);if(remembered&&!sameEntryJson(remembered,pointer))pendingError();
  return Object.freeze(pointer);
 }
 function retain(pointer:EntryPointer):void{
  if(pending(pointer.actor_id))pendingError();
  volatile.set(pointer.actor_id,pointer);const text=JSON.stringify(pointer);storage.setItem(entryStorageKey(pointer.actor_id),text);
  if(storage.getItem(entryStorageKey(pointer.actor_id))!==text)pendingError();
 }
 function clear(pointer:EntryPointer):void{
  if(!sameEntryJson(pending(pointer.actor_id),pointer))pendingError();
  const key=entryStorageKey(pointer.actor_id),text=JSON.stringify(pointer);
  try{storage.removeItem(key);if(storage.getItem(key)!==null)pendingError();}
  catch{
   // Preserve a usable ID-only recovery pointer after a failed receipt cleanup.
   try{storage.setItem(key,text);}catch{/* The same IDs remain in volatile memory. */}
   pendingError();
  }
  volatile.delete(pointer.actor_id);
 }
 function check(identity:Readonly<ReviewIdentity>):void{if(!sessions.isCurrent(identity))unavailable();}
 function deliver<T>(reply:EntryReply,pointer:EntryPointer,snapshot:ControlledLegacyIntent,identity:Readonly<ReviewIdentity>,admit:(raw:ExactJson)=>T):T{
  check(identity);if(reply.state!=="saved"||!reply.data.intent||!entryIntentMatches(reply.data.intent,snapshot)||!reply.data.canonical_result)pendingError();
  let result:T;try{result=admit(reply.data.canonical_result);}catch{
   const error=new ControlledStockWriteError("CONTROLLED_ENTRY_PENDING",false);error.message="The entry is recorded, but this view could not admit its saved result. Recover the original entry; do not prepare another.";throw error;
  }
  if(result&&typeof(result as{then?:unknown}).then==="function")pendingError();
  check(identity);clear(pointer);check(identity);return result;
 }
 async function finish<T>(reply:EntryReply,pointer:EntryPointer,snapshot:ControlledLegacyIntent,identity:Readonly<ReviewIdentity>,admit:(raw:ExactJson)=>T):Promise<T>{
  check(identity);
  if(pointer.writer!==snapshot.writer||pointer.operation_id!==snapshot.operationId)pendingError();
  if(reply.state==="abandoned"){clear(pointer);throw new ControlledStockWriteError("CONTROLLED_ENTRY_CANCELLED",true);}
  if(!reply.data.intent||!entryIntentMatches(reply.data.intent,snapshot))pendingError();
  if(reply.state==="saved")return deliver(reply,pointer,snapshot,identity,admit);
  const c2=reply.data.preparation?.frozen.permission.witness==="c2_required";
  const choice=await prompts.inspect(reply,identity,c2?async()=>{check(identity);const status=await client.witnessStatus(pointer,identity);check(identity);return status;}:undefined);check(identity);
  if(choice==="close"){
   const closed=await client.close(pointer,identity);check(identity);
   if(closed.state==="saved")return deliver(closed,pointer,snapshot,identity,admit);
   if(closed.state!=="abandoned")pendingError();clear(pointer);throw new ControlledStockWriteError("CONTROLLED_ENTRY_CANCELLED",true);
  }
  if(choice!=="execute"||reply.state!=="prepared")pendingError();
  const saved=await(c2?client.executeWitnessed(pointer,reply,identity):client.execute(pointer,identity));check(identity);return deliver(saved,pointer,snapshot,identity,admit);
 }
 const service:EntryService={
  pending,
  async invoke<T>(writer:ControlledStockWriter,args:unknown,identity:Readonly<ReviewIdentity>,admit:(raw:ExactJson)=>T):Promise<T>{
   // Synchronous capture happens before the first UI, lock or Auth await.
   let snapshot:ControlledLegacyIntent;
   try{snapshot=snapshotControlledLegacyIntent(writer,args);check(identity);}catch{unavailable();}
   let managed=false,legacyStarted=false;
   try{return await locks.exclusive(entryStorageKey(identity.actorId),async()=>{
    check(identity);const pointer=pending(identity.actorId);
    if(pointer){managed=true;const reply=await client.read(pointer,identity);check(identity);return finish(reply,pointer,snapshot,identity,admit);}
    const probe=await client.probe(snapshot,identity);check(identity);
    // A previously verified global recovery may have cleared the browser IDs
    // while the original caller still retains this operation. Read that exact
    // owned ID before any new managed planning; never prepare it again blindly.
    let own:EntryPointer|null=null;
    if(probe.mode!=="unmanaged"&&probe.intent.product_id!==null&&probe.intent.event_kind!==null){
     own=entryPointerSchema.parse({schema_version:1,actor_id:identity.actorId,operation_id:snapshot.operationId,writer:snapshot.writer,product_id:probe.intent.product_id,event_kind:probe.intent.event_kind});
     const existing=await client.read(own,identity);check(identity);
     if(existing.state!=="not_found"){
      if(existing.state==="abandoned")throw new ControlledStockWriteError("CONTROLLED_ENTRY_CANCELLED",true);
      retain(own);managed=true;return finish(existing,own,snapshot,identity,admit);
     }
    }
    if(probe.mode==="blocked")unavailable();
    if(probe.mode==="unmanaged"){
     // Unmanaged uncertainty remains with the existing writer hook. It has no
     // C0 journal or invented C0 recovery state. Only an explicit submit retries.
     legacyStarted=true;
     const raw=await client.legacy(snapshot,identity);check(identity);
     let result:T;try{result=admit(raw);}catch{pendingError();}
     if(result&&typeof(result as{then?:unknown}).then==="function")pendingError();check(identity);return result;
    }
    const context=await prompts.plan(probe,identity);check(identity);
    if(context===null)throw new ControlledStockWriteError("CONTROLLED_ENTRY_CANCELLED",true);
    if(!own)unavailable();
    retain(own);managed=true;check(identity);
    const prepared=await client.prepare(own,snapshot,context,identity);check(identity);
    if(prepared.state==="prepared"&&prepared.data.preparation&&!sameEntryJson(prepared.data.preparation.frozen.permission,probe.options?.permission))pendingError();
    return finish(prepared,own,snapshot,identity,admit);
   });}catch(error){
    if(error instanceof ControlledStockWriteError){
     if(managed&&error.code!=="CONTROLLED_ENTRY_CANCELLED"&&!(error.code==="CONTROLLED_ENTRY_PENDING"&&!error.definitive))pendingError();
     throw error;
    }
    if(error instanceof EntryClientError&&error.definitive&&!managed){
     const rejected=new ControlledStockWriteError("CONTROLLED_ENTRY_UNAVAILABLE",true);rejected.message=error.message;throw rejected;
    }
    if(!managed&&!legacyStarted)unavailable();pendingError();
   }
  },
  async recover(mode,identity){
   return locks.exclusive(entryStorageKey(identity.actorId),async()=>{
    check(identity);const pointer=pending(identity.actorId);if(!pointer)pendingError();
    const reply=await client[mode](pointer,identity);check(identity);
    if(reply.state==="abandoned"){clear(pointer);check(identity);}return reply;
   });
  },
  async completePending(identity){
   return locks.exclusive(entryStorageKey(identity.actorId),async()=>{
    check(identity);const pointer=pending(identity.actorId);if(!pointer)pendingError();
    const reply=await client.complete(pointer,identity);check(identity);
    if(reply.state!=="saved")pendingError();clear(pointer);check(identity);return reply;
   });
  },
  async executePending(identity){
   return locks.exclusive(entryStorageKey(identity.actorId),async()=>{
    check(identity);const pointer=pending(identity.actorId);if(!pointer)pendingError();
    const before=await client.read(pointer,identity);check(identity);if(before.state!=="prepared")pendingError();
    const reply=await(before.data.preparation?.frozen.permission.witness==="c2_required"?client.executeWitnessed(pointer,before,identity):client.execute(pointer,identity));check(identity);
    if(reply.state!=="saved")pendingError();check(identity);return reply;
   });
  },
  async witnessStatusPending(identity){return locks.exclusive(entryStorageKey(identity.actorId),async()=>{check(identity);const pointer=pending(identity.actorId);if(!pointer)pendingError();const before=await client.read(pointer,identity);check(identity);if(before.state!=="prepared")pendingError();const status=await client.witnessStatus(pointer,identity);check(identity);return status;});},
 };
 return Object.freeze(service);
}
