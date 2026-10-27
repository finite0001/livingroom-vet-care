/** Offline synthetic HTTP composition data. Existing source-shaped rows supply
 * field grammar only; no current server membership, Auth or write is asserted. */
import { decodeExactJson, ExactJsonNumber, type ExactJson } from "../../src/hub/features/controlled-drugs/record-review/exact-json.ts";
import { entryObject, serializeEntryJson } from "../../src/hub/features/controlled-drugs/entry/codec.ts";
import { snapshotControlledLegacyIntent } from "../../src/hub/features/controlled-drugs/entry/legacy-intent.ts";
import { parseEntryProbe, entryPointerSchema, type EntryContext } from "../../src/hub/features/controlled-drugs/entry/schema.ts";
export const decode=(value:string)=>decodeExactJson(new TextEncoder().encode(value));
export function entryFixtureFromBytes(raw:Uint8Array){
 const packet=entryObject(entryObject(entryObject(decodeExactJson(raw)).data).packet);
 const rows=packet.source_rows as readonly ExactJson[];
 const row=(relation:string)=>entryObject(entryObject(rows.find(value=>entryObject(value).relation===relation)).row);
 const preparation=row("public.controlled_stock_preparations"),event=row("public.controlled_stock_events"),action=row("public.controlled_stock_actions"),frozen=entryObject(preparation.frozen),catalog=entryObject(frozen.catalog);
 const frame=entryObject((frozen.containers as readonly ExactJson[])[0]),head=entryObject(frame.head),container=entryObject(frame.container),cell=entryObject(entryObject((frame.cells as readonly ExactJson[])[0]).cell);
 const snapshot=snapshotControlledLegacyIntent("adjust_inventory",{p_id:event.id,p_lot_id:cell.lot_id,p_quantity:-1,p_reason:"Synthetic local adjustment"});
 const identity={actorId:String(event.actor_id),sessionId:"00000000-0000-4000-8000-000000000001",generation:1};
 const pointer=entryPointerSchema.parse({schema_version:1,actor_id:event.actor_id,operation_id:event.id,writer:event.writer,product_id:event.product_id,event_kind:event.event_kind});
 const intent={writer:event.writer,operation_id:event.id,product_id:event.product_id,event_kind:event.event_kind,legacy_arguments:snapshot.legacyArguments,canonical_arguments:preparation.canonical_arguments};
 const options={product_id:event.product_id,product_name:String(catalog.name),policy_version_id:event.policy_version_id,state_head_id:preparation.state_head_id,opening_id:event.opening_id,stock_unit:catalog.unit,permission:frozen.permission,
  sites:[{id:container.controlling_site_id,label:"Synthetic site"}],locations:[{id:head.location_id,site_id:container.controlling_site_id,label:"Synthetic safe",kind:"clinic",initial_custodian_id:head.custodian_id}],custodians:[{id:event.actor_id,name:"Synthetic staff"}],
  containers:[{id:container.id,label:container.label,kind:container.kind,site_id:container.controlling_site_id,head:{version:"0",location_id:head.location_id,custodian_id:head.custodian_id,status:head.status},cells:[{cell_id:cell.id,lot_id:cell.lot_id,channel:cell.channel,dispense_id:cell.dispense_id,allocation_id:cell.allocation_id,intake_id:cell.intake_id,quantity:"20.000",lot_number:"Synthetic lot",expires_on:"2027-01-01"}],after_modes:["preserve"]}],effect_lines:frozen.expected_effects,new_container_kinds:[]};
 const probeRaw={schema_version:1,actor_id:event.actor_id,intent,mode:"managed",blocked_reason:null,options};
 const encode=(value:unknown)=>serializeEntryJson(value,4194304);
 const probe=parseEntryProbe(decode(encode(probeRaw)),identity.actorId,snapshot);
 const prepared={version:new ExactJsonNumber("1"),id:event.id,writer:event.writer,actor_id:event.actor_id,canonical_arguments:preparation.canonical_arguments,context:preparation.context,frozen,expires_at:preparation.expires_at,state:"prepared",receipt:null};
 const reply=(state:"prepared"|"saved"|"abandoned"|"not_found")=>({schema_version:1,state,data:{pointer,intent:state==="not_found"?null:intent,preparation:state==="not_found"||state==="abandoned"?null:{...prepared,state,receipt:state==="saved"?action.receipt:null},canonical_result:state==="saved"?event.canonical_result:null,receipt:state==="saved"?action.receipt:null}});
 return{snapshot,identity,pointer,intent,probe,probeRaw,prepared,preparationSource:preparation,reply,encode,context:preparation.context as unknown as EntryContext,event};
}
