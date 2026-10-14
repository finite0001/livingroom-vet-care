import assert from "node:assert/strict";
import { test } from "node:test";
import {
  identityReviewSchema, identityHistorySchema, namespaceRequestSchema, packageDefinitionSchema,
  parseIdentityRequest, verifyIdentityReceipt, identityCanonical,
} from "../../src/hub/features/inventory/supplier-imports/package-model.ts";
import {
  identityRequestHash, rememberIdentityPointer, readIdentityPointer, forgetIdentityPointer,
} from "../../src/hub/features/inventory/supplier-imports/review-pointer.ts";
const actor="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",id="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",product="cccccccc-cccc-4ccc-8ccc-cccccccccccc",versionId="dddddddd-dddd-4ddd-8ddd-dddddddddddd",namespace="eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",namespaceVersion="ffffffff-ffff-4fff-8fff-ffffffffffff";
const definition={product_id:product,product_version:3,stock_unit:"mL",label:"Reviewed vial",manufacturer:"Fixture manufacturer",strength:"10mg/mL",form:"injectable",purchase_unit:"vial",conversion:{stock_units_numerator:"10",purchase_units_denominator:"1"},active:true,identifiers:[{kind:"supplier_sku",namespace_id:namespace,namespace_version_id:namespaceVersion,value:"000123",raw_source:"000123"}]};
const request={id,expected_version:2,definition,review_note:"Reviewed exact vial identity",attest_review:true};
const metadata={id:namespace,actor_id:actor,operation:"package"as const};
const receipt={...metadata,entry:{id,kind:"package",product_id:product,version_id:versionId,version:3,definition,product_snapshot:{id:product,version:3,name:"Catalog medication",kind:"medication",manufacturer:"Fixture manufacturer",unit:"mL",active:true},actor_id:actor,actor_name:"Fixture reviewer",created_at:"2026-10-14T01:02:03.123456Z"}};
test("review binds the exact product, package definition and predecessor version",()=>{
 const parsed=parseIdentityRequest("package",request);assert.equal(verifyIdentityReceipt(metadata,parsed,receipt).entry.version,3);
 for(const change of[{...receipt,id:versionId},{...receipt,actor_id:product},{...receipt,entry:{...receipt.entry,id:namespace}},{...receipt,entry:{...receipt.entry,version:4}},{...receipt,entry:{...receipt.entry,definition:{...definition,conversion:{stock_units_numerator:"100",purchase_units_denominator:"1"}}}}])assert.throws(()=>verifyIdentityReceipt(metadata,parsed,change));
});
test("scope and clinical snapshot validation prevent implicit alias or unit changes",()=>{
 assert.equal(packageDefinitionSchema.safeParse({...definition,identifiers:[definition.identifiers[0],definition.identifiers[0]]}).success,false);
 assert.equal(packageDefinitionSchema.safeParse({...definition,identifiers:[{...definition.identifiers[0],namespace_version_id:null}]}).success,false);
 assert.equal(packageDefinitionSchema.safeParse({...definition,product_id:product.toUpperCase()}).success,false);
 assert.throws(()=>verifyIdentityReceipt(metadata,request,{...receipt,entry:{...receipt.entry,product_snapshot:{...receipt.entry.product_snapshot,unit:"mg"}}}));
 assert.throws(()=>verifyIdentityReceipt(metadata,request,{...receipt,entry:{...receipt.entry,product_snapshot:{...receipt.entry.product_snapshot,version:4}}}));
});
test("GTIN binding retains original code and requires normalized global scope",()=>{
 const gtin={kind:"gtin",namespace_id:null,namespace_version_id:null,value:"00036000291452",raw_source:"036000291452"};
 assert.equal(packageDefinitionSchema.safeParse({...definition,identifiers:[gtin]}).success,true);
 for(const invalid of[{...gtin,namespace_id:namespace},{...gtin,value:"036000291452"},{...gtin,raw_source:"036000291453"}])assert.equal(packageDefinitionSchema.safeParse({...definition,identifiers:[invalid]}).success,false);
});
test("saved and closed recovery states cannot invent or erase receipts",()=>{
 const review={id:metadata.id,actor_id:actor,operation:"package",request,expires_at:"2026-10-14T02:00:00.000000Z",receipt,state:"saved"};
 assert.equal(identityReviewSchema.safeParse(review).success,true);
 assert.equal(identityReviewSchema.safeParse({...review,state:"prepared"}).success,false);
 assert.equal(identityReviewSchema.safeParse({...review,receipt:null}).success,false);
 assert.equal(identityReviewSchema.safeParse({...review,request:{...request,review_note:undefined}}).success,false);
 assert.equal(identityReviewSchema.safeParse({id:metadata.id,actor_id:actor,operation:null,request:null,expires_at:null,receipt:null,state:"cancelled"}).success,true);
 assert.equal(identityReviewSchema.safeParse({id:metadata.id,actor_id:actor,operation:null,request:null,expires_at:null,receipt:null,state:"expired"}).success,false);
});
test("bounded history stays on one identity with a real continuation",()=>{
 const current=receipt.entry,older={...current,version:2,version_id:namespaceVersion};
 assert.equal(identityHistorySchema.safeParse({entry:current,current_product:current.product_snapshot,history:[current,older],next:2}).success,true);
 for(const history of[[older,current],[{...older,id:namespace}]])assert.equal(identityHistorySchema.safeParse({entry:current,current_product:current.product_snapshot,history,next:2}).success,false);
 assert.equal(identityHistorySchema.safeParse({entry:current,current_product:current.product_snapshot,history:[current],next:2}).success,false);
});
test("recovery pointers keep only original identity and canonical request fingerprint",async()=>{
 const storage=new Map<string,string>(),adapter={getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>{storage.set(key,value);},removeItem:(key:string)=>{storage.delete(key);}};
 const checked=parseIdentityRequest("package",request),hash=await identityRequestHash(checked),pointer={...metadata,request_hash:hash};
 const reordered={...request,definition:{...definition,conversion:{purchase_units_denominator:"1",stock_units_numerator:"10"}}};assert.equal(await identityRequestHash(parseIdentityRequest("package",reordered)),hash);
 rememberIdentityPointer(adapter,pointer);assert.deepEqual(readIdentityPointer(adapter,actor,"package"),pointer);assert.equal(readIdentityPointer(adapter,actor,"namespace"),null);
 const raw=[...storage.values()][0];assert.equal(raw.includes("Reviewed vial"),false);assert.equal(raw.includes("000123"),false);assert.equal(raw.includes("review_note"),false);
 const changed={...pointer,id:versionId};assert.throws(()=>rememberIdentityPointer(adapter,changed));assert.throws(()=>forgetIdentityPointer(adapter,changed));assert.deepEqual(readIdentityPointer(adapter,actor,"package"),pointer);
 forgetIdentityPointer(adapter,pointer);assert.equal(storage.size,0);
});
test("namespace review requires attestation and malformed stored details do not disappear",()=>{
 const ns={id,expected_version:null,definition:{supplier:"mwi",account_label:"Practice account",catalog_scope:"Product list",active:true},review_note:"Reviewed scope",attest_review:true};
 assert.equal(namespaceRequestSchema.safeParse(ns).success,true);assert.equal(namespaceRequestSchema.safeParse({...ns,attest_review:false}).success,false);
 assert.equal(namespaceRequestSchema.safeParse({...ns,definition:{...ns.definition,password:"unsupported"}}).success,false);
 const storage={getItem:()=>"{",setItem:()=>{throw new Error("must not write");},removeItem:()=>{throw new Error("must not remove");}};assert.throws(()=>readIdentityPointer(storage,actor,"namespace"),/unrecognized/);
 assert.throws(()=>identityCanonical(undefined),/JSON values/);
});
