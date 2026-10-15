import assert from "node:assert/strict";
import { test } from "node:test";
import { draftDefinitionSchema, draftEntrySchema, draftReviewSchema, draftHistorySchema, parseDraftRequest, verifyDraftReceipt } from "../../src/hub/features/controlled-drugs/draft-model.ts";
import { draftRequestHash, rememberDraftPointer, readDraftPointer, forgetDraftPointer } from "../../src/hub/features/controlled-drugs/review-pointer.ts";
const actor="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",id="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",product="cccccccc-cccc-4ccc-8ccc-cccccccccccc",versionId="dddddddd-dddd-4ddd-8ddd-dddddddddddd",action="eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const definition={product_id:product,product_version:3,stock_unit:"mL",generic_name:"Fixture substance",brand_name:null,schedule:"II",concentration:"10 mg/mL",concentration_source:"Fixture label",classification_source:"Fixture classification",configuration_note:"Draft only"};
const request={id,expected_version:2,definition,review_note:"Reviewed draft sources",attest_review:true};
const metadata={id:action,actor_id:actor,operation:"draft_configuration" as const};
const entry={id,state:"draft",product_id:product,version_id:versionId,version:3,definition,product_snapshot:{id:product,version:3,name:"Fixture medication",kind:"medication",manufacturer:"Fixture manufacturer",unit:"mL",active:true},actor_id:actor,actor_name:"Fixture reviewer",created_at:"2026-10-15T01:02:03.123456Z"};
const receipt={...metadata,entry};
test("controlled draft accepts only explicit source-backed proposed medication metadata",()=>{
 assert.equal(draftDefinitionSchema.safeParse(definition).success,true);
 for(const invalid of[{...definition,schedule:""},{...definition,schedule:"I"},{...definition,schedule:2},{...definition,active:true},{...definition,stock_quantity:"10"},{...definition,classification_source:""},{...definition,concentration:"10\tmg/mL"}])assert.equal(draftDefinitionSchema.safeParse(invalid).success,false);
 assert.throws(()=>parseDraftRequest("draft_configuration",{...request,attest_review:false}));
 assert.throws(()=>parseDraftRequest("draft_configuration",{...request,id:id.toUpperCase()}));
});
test("draft-only state and exact medication unit/version snapshot cannot be reinterpreted",()=>{
 assert.equal(draftEntrySchema.safeParse(entry).success,true);
 for(const invalid of[{...entry,state:"active"},{...entry,product_id:actor},{...entry,product_snapshot:{...entry.product_snapshot,kind:"vaccine"}},{...entry,product_snapshot:{...entry.product_snapshot,unit:"mg"}},{...entry,product_snapshot:{...entry.product_snapshot,version:4}}])assert.equal(draftEntrySchema.safeParse(invalid).success,false);
});
test("saved draft evidence binds original UUID, actor, predecessor and every reviewed field",()=>{
 const parsed=parseDraftRequest("draft_configuration",request);assert.equal(verifyDraftReceipt(metadata,parsed,receipt).entry.version,3);
 for(const invalid of[{...receipt,id:versionId},{...receipt,actor_id:product},{...receipt,entry:{...entry,id:action}},{...receipt,entry:{...entry,version:4}},{...receipt,entry:{...entry,definition:{...definition,schedule:"III"}}}])assert.throws(()=>verifyDraftReceipt(metadata,parsed,invalid));
});
test("recovery state cannot invent, detach or erase committed draft evidence",()=>{
 const review={...metadata,request,expires_at:"2026-10-15T02:00:00.000000Z",receipt,state:"saved"};
 assert.equal(draftReviewSchema.safeParse(review).success,true);
 for(const invalid of[{...review,state:"prepared"},{...review,receipt:null},{...review,request:{...request,review_note:undefined}},{...review,request:{...request,definition:{...definition,concentration:"100 mg/mL"}}}])assert.equal(draftReviewSchema.safeParse(invalid).success,false);
 assert.equal(draftReviewSchema.safeParse({...metadata,operation:null,request:null,expires_at:null,receipt:null,state:"cancelled"}).success,true);
 assert.equal(draftReviewSchema.safeParse({...metadata,operation:null,request:null,expires_at:null,receipt:null,state:"expired"}).success,false);
});
test("bounded draft history stays on one identity and exact descending continuation",()=>{
 const older={...entry,version:2,version_id:action};const base={entry,current_product:entry.product_snapshot,history:[entry,older],next:2};
 assert.equal(draftHistorySchema.safeParse(base).success,true);
 for(const invalid of[{...base,history:[older,entry]},{...base,history:[entry,{...older,id:actor}]},{...base,next:1}])assert.equal(draftHistorySchema.safeParse(invalid).success,false);
});
interface Storage { getItem(key:string):string|null;setItem(key:string,value:string):void;removeItem(key:string):void }
function storage():Storage{const data=new Map<string,string>();return{getItem:key=>data.get(key)??null,setItem:(key,value)=>void data.set(key,value),removeItem:key=>void data.delete(key)};}
test("owned recovery pointer persists only a fingerprint and cannot replace uncertain review",async()=>{
 const store=storage(),hash=await draftRequestHash(parseDraftRequest("draft_configuration",request)),pointer={...metadata,request_hash:hash};
 rememberDraftPointer(store,pointer);assert.deepEqual(readDraftPointer(store,actor,"draft_configuration"),pointer);
 assert.equal(JSON.stringify(pointer).includes(definition.generic_name),false);
 assert.throws(()=>rememberDraftPointer(store,{...pointer,id:versionId}));
 assert.throws(()=>forgetDraftPointer(store,{...pointer,request_hash:"0".repeat(64)}));
 forgetDraftPointer(store,pointer);assert.equal(readDraftPointer(store,actor,"draft_configuration"),null);
 const changed=await draftRequestHash(parseDraftRequest("draft_configuration",{...request,definition:{...definition,schedule:"III"}}));assert.notEqual(changed,hash);
});
test("corrupt or failed durable pointer storage prevents submission instead of losing recovery",async()=>{
 const pointer={...metadata,request_hash:await draftRequestHash(parseDraftRequest("draft_configuration",request))};
 assert.throws(()=>rememberDraftPointer({getItem:()=>null,setItem:()=>{},removeItem:()=>{}},pointer));
 assert.throws(()=>readDraftPointer({getItem:()=>'{"id":"broken"}',setItem:()=>{},removeItem:()=>{}},actor,"draft_configuration"));
 const store=storage();rememberDraftPointer(store,pointer);assert.equal(readDraftPointer(store,product,"draft_configuration"),null);
});
