import { ExactJsonNumber } from "../record-review/exact-json.ts";
import { reviewContextQuantity, reviewInstantMicroseconds } from "../record-review/exact-values.ts";
import { countObservationTime } from "../count/count-entry.ts";
import { entryObject } from "./codec.ts";
import { entryContextSchema, type EntryContext, type EntryOptions, type EntryProbe } from "./schema.ts";
export interface EntryDraftLine { readonly effectIndex:string;readonly quantity:string }
export interface EntryDraftContainer {
 readonly id:string;readonly existingId:string|null;readonly kind:"stock"|"prepared";
 readonly label:string;readonly siteId:string;readonly locationId:string;readonly custodianId:string;
 readonly afterMode:""|"preserve"|"handoff"|"dispose"|"restore_onsite";
 readonly lines:readonly EntryDraftLine[];
}
export interface EntryPlanDraft { readonly note:string;readonly observedAt:string;readonly observedOffset:string;readonly confirmAdministration:boolean;readonly confirmNoAllocations:boolean;readonly containers:readonly EntryDraftContainer[] }
export function emptyEntryPlan():EntryPlanDraft{return{note:"",observedAt:"",observedOffset:"",confirmAdministration:false,confirmNoAllocations:false,containers:[]};}
export function existingEntryContainer(options:EntryOptions,id:string):EntryDraftContainer{
 const c=options.containers.find(x=>x.id===id);if(!c)throw new Error("Choose a current container.");
 return{id:c.id,existingId:c.id,kind:c.kind,label:c.label,siteId:c.site_id,locationId:"",custodianId:"",afterMode:"",lines:[]};
}
export function newEntryContainer(kind:"stock"|"prepared",id:string):EntryDraftContainer{return{id,existingId:null,kind,label:"",siteId:"",locationId:"",custodianId:"",afterMode:"",lines:[]};}
function invalid(message:string):never{throw new Error(message);}
/** Allocations are entered by staff, never filled from balances or expected
 * effects. Sorting new context IDs is the original protocol's ordering rule;
 * original writer arguments and all source/preparation snapshots stay intact. */
export function buildEntryContext(probe:EntryProbe,draft:EntryPlanDraft):EntryContext {
 if(probe.mode!=="managed"||!probe.options)invalid("This entry requires another available workflow.");
 const o=probe.options;
 if(draft.containers.length>32||new Set(draft.containers.map(c=>c.id)).size!==draft.containers.length)invalid("Use at most 32 distinct physical containers.");
 let observed:string|null=null;
 if(o.permission.basis==="physical_record"){
  if(probe.intent.writer==="record_patient_treatment"||probe.intent.writer==="record_anesthesia_drug_administration"){
   const original=entryObject(probe.intent.canonical_arguments.request).administered_at;
   if(!draft.confirmAdministration||typeof original!=="string")invalid("Confirm the actual administration time already entered.");reviewInstantMicroseconds(original);observed=original;
  }else{if(!draft.observedOffset)invalid("Choose the actual UTC offset for the physical observation.");observed=countObservationTime(draft.observedAt,draft.observedOffset);}
 }
 if(!draft.note||draft.note!==draft.note.trim())invalid("Enter an explicit clean note for this stock record.");
 if(o.effect_lines.length===0&&(!draft.confirmNoAllocations||draft.containers.length!==0))invalid("Review the absence of stock allocations for this assertion.");
 const assigned=o.effect_lines.map(()=>0n);let lineCount=0;
 const containers=draft.containers.map(d=>{
  const source=d.existingId?o.containers.find(c=>c.id===d.existingId):null;
  if(d.existingId&&(!source||d.id!==source.id||d.kind!==source.kind))invalid("Container identity changed; reload the entry.");
  if(!source&&!o.new_container_kinds.includes(d.kind))invalid("This writer cannot create that container kind.");
  if(!d.lines.length||d.lines.length>100||(lineCount+=d.lines.length)>200)invalid("Enter 1–100 allocations per container and at most 200 in total.");
  let expectedVersion:ExactJsonNumber|null=null;
  if(source){if(BigInt(source.head.version)>2147483647n)invalid("This container head is outside the original preparation protocol.");expectedVersion=new ExactJsonNumber(source.head.version);}
  const siteId=source?.site_id??d.siteId;
  if(!o.sites.some(s=>s.id===siteId))invalid("Choose a permitted controlling site.");
  const custody=()=>{
   const location=o.locations.find(l=>l.id===d.locationId&&l.site_id===siteId);
   if(!location||!o.permission.location_kinds.includes(location.kind)||!d.custodianId)invalid("Choose the actual permitted location and custody assignment.");
   if(d.custodianId!=="unassigned"&&!o.custodians.some(c=>c.id===d.custodianId))invalid("Choose an available custodian.");
   return{location_id:location.id,custodian_id:d.custodianId==="unassigned"?null:d.custodianId};
  };
  let after:{status:"onsite"|"handed_off"|"disposed";location_id:string|null;custodian_id:string|null};
  let create:EntryContext["containers"][number]["create"]=null;
  if(source){
   if(!d.afterMode||!source.after_modes.includes(d.afterMode))invalid("Choose the actual allowed custody result.");
   if(d.afterMode==="preserve")after={status:source.head.status,location_id:source.head.location_id,custodian_id:source.head.custodian_id};
   else if(d.afterMode==="restore_onsite")after={status:"onsite",...custody()};
   else after={status:d.afterMode==="handoff"?"handed_off":"disposed",location_id:null,custodian_id:null};
  }else{
   const position=custody(),stockLot=probe.intent.canonical_arguments.lot_id;
   if(d.kind==="stock"&&typeof stockLot!=="string")invalid("The receipt must retain its original stock lot.");
   create={kind:d.kind,label:d.label,stock_lot_id:d.kind==="stock"?stockLot as string:null,site_id:siteId,...position};after={status:"onsite",...position};
  }
  const keys=new Set<string>();
  const lines=d.lines.map(line=>{
   if(!/^(0|[1-9][0-9]*)$/.test(line.effectIndex)||line.effectIndex.length>3)invalid("Choose an original effect line.");
   const index=Number(line.effectIndex),e=o.effect_lines[index];if(!e)invalid("Choose an original effect line.");
   const quantity=reviewContextQuantity(line.quantity),expected=reviewContextQuantity(e.quantity_delta);
   if((quantity>0n)!==(expected>0n))invalid("An allocation must retain the original effect direction.");assigned[index]+=quantity;
   if((d.kind==="stock")!==(e.channel==="available"))invalid("The allocation channel does not belong in this container.");
   if(!source&&quantity<0n)invalid("A new container cannot supply existing stock.");
   if(create?.kind==="stock"&&e.lot_id!==create.stock_lot_id)invalid("Use the actual received lot.");
   const key=JSON.stringify([e.lot_id,e.channel,e.dispense_id,e.intake_id]);if(keys.has(key))invalid("Each container needs unique source allocation identities.");keys.add(key);
   if(source&&quantity<0n){const cell=source.cells.find(c=>c.lot_id===e.lot_id&&c.channel===e.channel&&c.dispense_id===e.dispense_id&&c.intake_id===e.intake_id);if(!cell||reviewContextQuantity(cell.quantity,true)+quantity<0n)invalid("This exact cell cannot supply that quantity.");}
   return{...e,quantity_delta:line.quantity};
  });
  return{id:d.id,expected_version:expectedVersion,create,after,lines};
 }).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
 if(assigned.some((n,i)=>n!==reviewContextQuantity(o.effect_lines[i].quantity_delta)))invalid("Every original effect must be allocated completely without combining source slots.");
 return entryContextSchema.parse({version:new ExactJsonNumber("1"),product_id:o.product_id,policy_version_id:o.policy_version_id,state_head_id:o.state_head_id,opening_id:o.opening_id,basis:{kind:o.permission.basis,observed_at:observed,note:draft.note},containers});
}
