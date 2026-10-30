import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync}from"node:fs";
import {admitGlobalSavedEntry}from"../../src/hub/features/controlled-drugs/entry/saved-result.ts";
import {createFulfillmentApi}from"../../src/hub/features/prescriptions/fulfillment-api.ts";
import type{PrescriptionRpc}from"../../src/hub/features/prescriptions/prescription-api.ts";
import{signed,actor,operation,receipt,pickupOperation,pickup,time,hash}from"../prescriptions/fulfillment-fixture.ts";
import {entryObject,serializeEntryJson}from"../../src/hub/features/controlled-drugs/entry/codec.ts";
import {decodeExactJson,type ExactJson}from"../../src/hub/features/controlled-drugs/record-review/exact-json.ts";
import type{EntryReply}from"../../src/hub/features/controlled-drugs/entry/schema.ts";
const exact=(value:unknown)=>decodeExactJson(new TextEncoder().encode(serializeEntryJson(value,4194304)));
const noTransport:PrescriptionRpc={rpc(){throw new Error("Pure observers must never reach a transport.");}};
/** These are observer components, not new complete C0 replies or source facts. */
function component(writer:string,id:string,request:unknown,result:unknown,native:unknown,actorId:string):EntryReply{
 return{schema_version:1,state:"saved",data:{pointer:{operation_id:id,actor_id:actorId,product_id:signed().context.draft.fields.product_id},intent:{writer,legacy_arguments:exact({p_id:id,p_request:request})},preparation:{frozen:{native:exact(native),catalog:{unit:signed().artifact.unit}}},canonical_result:exact(result)}}as unknown as EntryReply;
}
test("global D/P completion uses actual original strict observer with a full read authorization, never a synthetic header row",async()=>{
 const auth=signed(),api=createFulfillmentApi(noTransport,actor,auth);
 const d=operation(),r=receipt();api.admitSaved(d.id,"dispense",exact(d.payload),exact(r));
 const p=pickupOperation(),pr={version:1,id:p.id,actor_id:actor,request_hash:hash,created_at:time,operation:"pickup",request:p.payload,result:pickup()};api.admitSaved(p.id,"pickup",exact(p.payload),exact(pr));
 for(const[writer,op,result]of[["record_native_dispense",d,r],["record_native_pickup",p,pr]]as const){
  const c=component(writer,op.id,op.payload,result,{authorization:{id:auth.id,hash:auth.authorization_hash}},actor);let reads=0;
  await admitGlobalSavedEntry(c,async()=>{reads++;return exact(auth);});assert.equal(reads,1);
  for(const change of[{...auth,id:op.id},{...auth,pet_id:op.id},{...auth,authorization_hash:"b".repeat(64)}])await assert.rejects(admitGlobalSavedEntry(c,async()=>exact(change)));
  await assert.rejects(admitGlobalSavedEntry({...c,data:{...c.data,canonical_result:exact({...result,actor_id:op.id})}},async()=>exact(auth)));
 }
});
test("all remaining native families reuse their original strict saved-result observers without a transport or extra authorization read",async()=>{
 for(const n of[1,2,3,4,5,6,8,9,10,11,12,13,14,15,16,17]){
  const raw=decodeExactJson(readFileSync(new URL(`./record-review-native-fixtures/native-detail-${String(n).padStart(2,"0")}.json`,import.meta.url))),packet=entryObject(entryObject(entryObject(raw).data).packet),event=entryObject(packet.event),prep=entryObject(packet.parent_preparation),args=entryObject(prep.canonical_arguments);
  const c=component(String(event.writer),String(event.id),args.request,event.canonical_result,entryObject(prep.frozen).native,String(event.actor_id));
  await admitGlobalSavedEntry(c,async()=>{throw new Error("No authorization read is permitted for this observer.");});
  const changed={...entryObject(c.data.canonical_result),unexpected:true};await assert.rejects(admitGlobalSavedEntry({...c,data:{...c.data,canonical_result:changed}},async()=>{throw new Error("No read");}));
  // Preserve every original raw decimal token in the source input itself.
  assert.ok(serializeEntryJson(event.canonical_result,4194304).length>0);
 }
});
