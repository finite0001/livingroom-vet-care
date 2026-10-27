import { z } from "zod";
import { ExactJsonNumber, protocolInteger, type ExactJson } from "../record-review/exact-json.ts";
import { reviewUuidSchema as uuid } from "../record-review/request.ts";
import { reviewEventKindSchema } from "../record-review/queue-model.ts";
import { reviewContextQuantity, reviewInstantMicroseconds } from "../record-review/exact-values.ts";
import { nativeFrozenSchema } from "../record-review/native-movement-structure.ts";
import { verifyProspectiveSourceRowStructure } from "../record-review/prospective-packet-structure.ts";
import { controlledStockWriterSchema } from "./gateway.ts";
import type { ControlledLegacyIntent } from "./legacy-intent.ts";
import { entryObject, sameEntryJson, serializeEntryJson, type EntryObject } from "./codec.ts";
const one=z.preprocess(v=>v instanceof ExactJsonNumber?protocolInteger(v,1,1):v,z.literal(1));
const rawOne=z.instanceof(ExactJsonNumber).refine(v=>{try{return protocolInteger(v,1,1)===1;}catch{return false;}});
const rawInteger=z.instanceof(ExactJsonNumber).refine(v=>{try{protocolInteger(v,0,2147483647);return true;}catch{return false;}});
const rawObject=z.custom<EntryObject>(v=>{try{entryObject(v);return true;}catch{return false;}});
const sourceRow=(relation:string)=>z.custom<EntryObject>(v=>{try{verifyProspectiveSourceRowStructure(relation,v);return true;}catch{return false;}});
const instant=z.string().refine(v=>{try{reviewInstantMicroseconds(v);return true;}catch{return false;}});
const text=(maximum:number,multiline=false)=>z.string().min(1).refine(v=>v===v.trim()&&[...v].length<=maximum&&[...v].every(c=>{const n=c.codePointAt(0)!;return n>=32&&n!==127||multiline&&(n===9||n===10);}));
const version=z.string().regex(/^(0|[1-9][0-9]{0,18})$/).refine(v=>BigInt(v)<=9223372036854775807n);
const decimal=z.string().refine(v=>{try{reviewContextQuantity(v);return true;}catch{return false;}});
const nonnegative=z.string().regex(/^(0|[1-9][0-9]{0,10})\.[0-9]{3}$/);
const unique=<T,>(items:readonly T[],key:(value:T)=>string)=>new Set(items.map(key)).size===items.length;
export const entryLineSchema=z.object({lot_id:uuid,channel:z.enum(["available","prepared","return_held"]),dispense_id:uuid.nullable(),intake_id:uuid.nullable(),quantity_delta:decimal}).strict();
export const entryPermissionSchema=z.object({enabled:z.literal(true),roles:z.array(z.enum(["ADMIN","DVM","STAFF"])).min(1).max(3),basis:z.enum(["physical_record","correction_assertion","annotation","discrepancy_assertion"]),witness:z.enum(["none","c2_required"]),secondary_review:z.boolean(),location_kinds:z.array(z.enum(["clinic","mobile_kit"])).min(1).max(2)}).strict();
const status=z.enum(["onsite","handed_off","disposed"]);
const after=z.object({status,location_id:uuid.nullable(),custodian_id:uuid.nullable()}).strict().refine(v=>v.status==="onsite"?v.location_id!==null:v.location_id===null&&v.custodian_id===null);
const create=z.object({kind:z.enum(["stock","prepared"]),label:text(200),stock_lot_id:uuid.nullable(),site_id:uuid,location_id:uuid,custodian_id:uuid.nullable()}).strict();
const allocation=z.object({id:uuid,expected_version:rawInteger.nullable(),create:create.nullable(),after,lines:z.array(entryLineSchema).max(100)}).strict().refine(v=>(v.expected_version===null)===(v.create!==null));
export const entryContextSchema=z.object({version:rawOne,product_id:uuid,policy_version_id:uuid,state_head_id:uuid,opening_id:uuid,basis:z.object({kind:entryPermissionSchema.shape.basis,observed_at:instant.nullable(),note:text(4000,true).nullable()}).strict(),containers:z.array(allocation).max(32)}).strict().superRefine((v,c)=>{
 if(!v.containers.every((x,i)=>!i||v.containers[i-1].id<x.id)||v.containers.reduce((n,x)=>n+x.lines.length,0)>200||
  (v.basis.kind==="physical_record")!==(v.basis.observed_at!==null))c.addIssue({code:z.ZodIssueCode.custom,message:"Exact ordered custody context required"});
});
const head=z.object({version,location_id:uuid.nullable(),custodian_id:uuid.nullable(),status}).strict();
const optionCell=z.object({cell_id:uuid,lot_id:uuid,channel:entryLineSchema.shape.channel,dispense_id:uuid.nullable(),allocation_id:uuid.nullable(),intake_id:uuid.nullable(),quantity:nonnegative,lot_number:z.string().max(800),expires_on:z.string().max(128)}).strict();
export const entryOptionsSchema=z.object({product_id:uuid,product_name:text(200),policy_version_id:uuid,state_head_id:uuid,opening_id:uuid,stock_unit:text(50),permission:entryPermissionSchema,
 sites:z.array(z.object({id:uuid,label:text(200)}).strict()).max(256),locations:z.array(z.object({id:uuid,site_id:uuid,label:text(200),kind:z.enum(["clinic","mobile_kit"]),initial_custodian_id:uuid.nullable()}).strict()).max(256),custodians:z.array(z.object({id:uuid,name:text(200)}).strict()).max(256),
 containers:z.array(z.object({id:uuid,label:text(200),kind:z.enum(["stock","prepared"]),site_id:uuid,head,cells:z.array(optionCell).max(512),after_modes:z.array(z.enum(["preserve","handoff","dispose","restore_onsite"])).max(4).refine(v=>v.every((x,i)=>!i||v[i-1]<x))}).strict()).max(512),
 effect_lines:z.array(entryLineSchema).max(200),new_container_kinds:z.array(z.enum(["stock","prepared"])).max(1)}).strict().superRefine((v,c)=>{
 if(!unique(v.sites,x=>x.id)||!unique(v.locations,x=>x.id)||!unique(v.custodians,x=>x.id)||!unique(v.containers,x=>x.id)||
 v.locations.some(l=>!v.sites.some(s=>s.id===l.site_id))||v.containers.some(x=>!v.sites.some(s=>s.id===x.site_id)||!unique(x.cells,y=>y.cell_id)))c.addIssue({code:z.ZodIssueCode.custom,message:"Complete unique option membership required"});
});
export interface EntryOptions extends z.infer<typeof entryOptionsSchema>{}
export interface EntryContext extends z.infer<typeof entryContextSchema>{}
export const entryPointerSchema=z.object({schema_version:one,actor_id:uuid,operation_id:uuid,writer:controlledStockWriterSchema,product_id:uuid,event_kind:reviewEventKindSchema}).strict();
export interface EntryPointer extends z.infer<typeof entryPointerSchema>{}
export const entryIntentSchema=z.object({writer:controlledStockWriterSchema,operation_id:uuid,product_id:uuid.nullable(),event_kind:reviewEventKindSchema.nullable(),legacy_arguments:rawObject,canonical_arguments:rawObject}).strict();
export interface EntryIntent extends z.infer<typeof entryIntentSchema>{}
const frozen=nativeFrozenSchema.extend({native:rawObject.nullable(),permission:entryPermissionSchema}).strict();
const rawHeadVersion=z.instanceof(ExactJsonNumber).refine(v=>/^(0|[1-9][0-9]{0,18})$/.test(v.token)&&BigInt(v.token)<=9223372036854775807n);
const receiptHead=z.object({container_id:uuid,version:rawHeadVersion,location_id:uuid.nullable(),custodian_id:uuid.nullable(),status,last_event_id:uuid.nullable()}).strict();
const receipt=z.object({version:rawOne,id:uuid,writer:controlledStockWriterSchema,actor_id:uuid,canonical_result:rawObject,event:sourceRow("public.controlled_stock_events"),containers:z.array(receiptHead).max(32)}).strict();
export const entryPreparationSchema=z.object({version:rawOne,id:uuid,writer:controlledStockWriterSchema,actor_id:uuid,canonical_arguments:rawObject,context:entryContextSchema,frozen,expires_at:instant,state:z.enum(["prepared","saved","cancelled","expired"]),receipt:receipt.nullable()}).strict();
export interface EntryPreparation extends z.infer<typeof entryPreparationSchema>{}
export const entryProbeSchema=z.object({schema_version:one,actor_id:uuid,intent:entryIntentSchema,mode:z.enum(["unmanaged","managed","blocked"]),blocked_reason:z.enum(["stock_not_active","policy_changed","investigation_hold","no_current_permission","no_permitted_location","witness_workflow_unavailable","source_unsupported"]).nullable(),options:entryOptionsSchema.nullable()}).strict();
export interface EntryProbe extends z.infer<typeof entryProbeSchema>{}
export const entryReplySchema=z.object({schema_version:one,state:z.enum(["not_found","prepared","saved","abandoned","expired","stale"]),data:z.object({pointer:entryPointerSchema,intent:entryIntentSchema.nullable(),preparation:entryPreparationSchema.nullable(),canonical_result:rawObject.nullable(),receipt:receipt.nullable()}).strict()}).strict();
export interface EntryReply extends z.infer<typeof entryReplySchema>{}
export function canonicalEntryArguments(snapshot:ControlledLegacyIntent):EntryObject {
 const a=entryObject(snapshot.legacyArguments);
 if(snapshot.writer==="receive_inventory"||snapshot.writer==="adjust_inventory"){
  if(!(a.p_quantity instanceof ExactJsonNumber))throw new Error("Original numeric quantity required.");
  const q=a.p_quantity.token,n=reviewContextQuantity(q);if(snapshot.writer==="receive_inventory"&&n<=0n)throw new Error("Positive receipt quantity required.");
  return Object.freeze(snapshot.writer==="receive_inventory"?{lot_id:a.p_lot_id,product_id:a.p_product_id,lot_number:a.p_lot_number,expires_on:a.p_expires_on,location:a.p_location,quantity:q,reason:a.p_reason}:{lot_id:a.p_lot_id,quantity:q,reason:a.p_reason});
 }
 return Object.freeze(snapshot.writer==="record_anesthesia_drug_administration"?{record_id:a.p_record_id,pet_id:a.p_pet_id,request:a.p_request}:{request:a.p_request});
}
function mismatch():never{throw new Error("Controlled entry does not match its original intent.");}
function expectedKind(snapshot:ControlledLegacyIntent){
 const request=entryObject(snapshot.legacyArguments).p_request;
 let kind:string=snapshot.writer;
 if(snapshot.writer==="record_native_dispense_return"||snapshot.writer==="record_native_dispense_return_v2"||snapshot.writer==="record_native_return_discrepancy")kind+=":"+entryObject(entryObject(request).intent).action;
 if(snapshot.writer==="append_native_dispense_correction")kind+=":"+entryObject(request).kind;
 return reviewEventKindSchema.parse(kind);
}
export function recoveredEntrySnapshot(intent:EntryIntent):ControlledLegacyIntent{
 const a=intent.legacy_arguments;
 const keys=intent.writer==="receive_inventory"?["p_id","p_lot_id","p_product_id","p_lot_number","p_expires_on","p_location","p_quantity","p_reason"]:intent.writer==="adjust_inventory"?["p_id","p_lot_id","p_quantity","p_reason"]:intent.writer==="record_anesthesia_drug_administration"?["p_id","p_record_id","p_pet_id","p_request"]:["p_id","p_request"];
 if(Object.keys(a).length!==keys.length||keys.some(k=>!Object.prototype.hasOwnProperty.call(a,k))||a.p_id!==intent.operation_id)mismatch();
 if(intent.writer!=="receive_inventory"&&intent.writer!=="adjust_inventory")entryObject(a.p_request);
 return{writer:intent.writer,operationId:intent.operation_id,legacyArguments:a,requestBody:serializeEntryJson(a)};
}

export function entryIntentMatches(intent:EntryIntent,snapshot:ControlledLegacyIntent):boolean {
 return intent.writer===snapshot.writer&&intent.operation_id===snapshot.operationId&&sameEntryJson(intent.legacy_arguments,snapshot.legacyArguments)&&sameEntryJson(intent.canonical_arguments,canonicalEntryArguments(snapshot));
}
export function parseEntryProbe(raw:ExactJson,actorId:string,snapshot:ControlledLegacyIntent):EntryProbe {
 const value=entryProbeSchema.parse(raw);if(value.actor_id!==actorId||!entryIntentMatches(value.intent,snapshot))mismatch();
 const nonstock=value.intent.product_id===null||value.intent.event_kind===null;
 if(!nonstock&&value.intent.event_kind!==expectedKind(snapshot))mismatch();
 if(nonstock&&(value.mode!=="unmanaged"||value.intent.product_id!==null||value.intent.event_kind!==null||snapshot.writer!=="record_patient_treatment"||entryObject(entryObject(snapshot.legacyArguments).p_request).historical!==true))mismatch();
 if(value.mode==="managed"){
  if(!value.options||value.blocked_reason!==null||nonstock||value.options.product_id!==value.intent.product_id)mismatch();
  const kinds=snapshot.writer==="receive_inventory"?["stock"]:snapshot.writer==="record_native_dispense"?["prepared"]:[];
  if(!sameEntryJson(value.options.new_container_kinds,kinds))mismatch();
 }else if(value.options!==null||(value.mode==="blocked")!==(value.blocked_reason!==null))mismatch();
 return value;
}
export function parseEntryReply(raw:ExactJson,pointer:EntryPointer,snapshot?:ControlledLegacyIntent):EntryReply {
 const reply=entryReplySchema.parse(raw),d=reply.data;
 if(!sameEntryJson(d.pointer,pointer))mismatch();
 if(d.intent){const original=recoveredEntrySnapshot(d.intent);if(!entryIntentMatches(d.intent,original)||d.intent.event_kind!==expectedKind(original))mismatch();}
 if(d.intent&&(d.intent.writer!==pointer.writer||d.intent.operation_id!==pointer.operation_id||d.intent.product_id!==pointer.product_id||d.intent.event_kind!==pointer.event_kind||snapshot&&!entryIntentMatches(d.intent,snapshot)))mismatch();
 if(reply.state==="not_found"&&(d.intent!==null||d.preparation!==null))mismatch();
 if(reply.state!=="not_found"&&reply.state!=="abandoned"&&(!d.intent||!d.preparation))mismatch();
 if((reply.state==="saved")!==(d.receipt!==null&&d.canonical_result!==null))mismatch();
 if(reply.state!=="saved"&&(d.receipt!==null||d.canonical_result!==null))mismatch();
 const p=d.preparation;
 if(p&&(p.id!==pointer.operation_id||p.writer!==pointer.writer||p.actor_id!==pointer.actor_id||p.context.product_id!==pointer.product_id||!d.intent||!sameEntryJson(p.canonical_arguments,d.intent.canonical_arguments)||p.context.basis.kind!==p.frozen.permission.basis))mismatch();
 if(p){
  if(reply.state==="prepared"&&p.state!=="prepared"||reply.state==="expired"&&p.state!=="expired")mismatch();
  if(p.frozen.catalog.id!==pointer.product_id||p.frozen.containers.length!==p.context.containers.length)mismatch();
  p.frozen.containers.forEach((frame,i)=>{const c=p.context.containers[i];if(frame.id!==c.id)mismatch();
   if(c.create){if(frame.container!==null||frame.head!==null||frame.cells.length!==0)mismatch();}
   else if(!frame.container||!frame.head||frame.container.id!==c.id||frame.head.container_id!==c.id||!sameEntryJson(frame.head.version,c.expected_version))mismatch();
  });
 }
 if(p&&((p.state==="saved")!==(p.receipt!==null)))mismatch();
 if(reply.state==="saved"){
  if(!p||!d.receipt||!d.canonical_result||p.state!=="saved"||!sameEntryJson(p.receipt,d.receipt)||!sameEntryJson(d.receipt.canonical_result,d.canonical_result))mismatch();
  const e=d.receipt.event;
  if(e.policy_version_id!==p.context.policy_version_id||e.opening_id!==p.context.opening_id||e.basis!==p.context.basis.kind||e.note!==p.context.basis.note||e.secondary_review_required!==p.frozen.permission.secondary_review)mismatch();
  if(p.context.basis.observed_at===null?e.observed_at!==null:typeof e.observed_at!=="string"||reviewInstantMicroseconds(e.observed_at)!==reviewInstantMicroseconds(p.context.basis.observed_at))mismatch();
  if(d.receipt.id!==pointer.operation_id||d.receipt.writer!==pointer.writer||d.receipt.actor_id!==pointer.actor_id||e.id!==pointer.operation_id||e.writer!==pointer.writer||e.actor_id!==pointer.actor_id||e.product_id!==pointer.product_id||e.event_kind!==pointer.event_kind||!sameEntryJson(e.canonical_result,d.canonical_result)||d.receipt.containers.length!==p.context.containers.length)mismatch();
  d.receipt.containers.forEach((head,i)=>{const c=p.context.containers[i];if(head.container_id!==c.id||head.last_event_id!==pointer.operation_id||head.status!==c.after.status||head.location_id!==c.after.location_id||head.custodian_id!==c.after.custodian_id||!(head.version instanceof ExactJsonNumber)||BigInt(head.version.token)!==(c.expected_version===null?1n:BigInt(c.expected_version.token)+1n))mismatch();});
 }else if(p?.receipt!==null&&p?.receipt!==undefined)mismatch();
 return reply;
}
