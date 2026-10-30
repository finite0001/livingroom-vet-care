import { z } from "zod";
import { createFulfillmentApi } from "../../prescriptions/fulfillment-api.ts";
import { createFulfillmentCorrectionsApi, correctionTargetSchema } from "../../prescriptions/fulfillment-corrections-api.ts";
import { createNativeReturnsApi } from "../../prescriptions/fulfillment-returns-api.ts";
import { createNativeReconciliationApi, createNativeReturnDiscrepancyApi } from "../../prescriptions/fulfillment-reconciliation-api.ts";
import { nativePrescriptionAuthorizationSchema, parsePrescriptionAuthorization, type PrescriptionRpc } from "../../prescriptions/prescription-api.ts";
import type { ExactJson } from "../record-review/exact-json.ts";
import { entryObject } from "./codec.ts";
import { admitLegacyResult } from "./legacy-result.ts";
import type { EntryReply } from "./schema.ts";
// These are pure original observers. Any future accidental transport call from
// an observer fails closed; this dependency can never make an RPC or write.
const noTransport:PrescriptionRpc={rpc(){throw new Error("Saved-result admission cannot invoke a native RPC.");}};
const uuid=z.string().uuid();
/** Called only for an independently verified owned saved C0 reply. The loader
 * must be the source-contracted owned-pointer authorization read, under the SAME
 * captured identity, signal and original deadline as that C0 read. */
export async function admitGlobalSavedEntry(reply:EntryReply,loadAuthorization:()=>Promise<ExactJson>):Promise<void>{
 const {intent,preparation,canonical_result:raw,pointer}=reply.data;
 if(reply.state!=="saved"||!intent||!preparation||!raw)throw new Error("An owned saved result is required.");
 const writer=intent.writer,request=entryObject(intent.legacy_arguments).p_request,id=pointer.operation_id,actor=pointer.actor_id;
 if(writer==="receive_inventory"||writer==="adjust_inventory"||writer==="record_patient_treatment"||writer==="record_anesthesia_drug_administration")return;
 const q=entryObject(request);
 if(writer==="record_native_dispense"||writer==="record_native_pickup"){
  const authorizationId=uuid.parse(q.authorization_id),pet=uuid.parse(q.pet_id),native=entryObject(preparation.frozen.native),head=entryObject(native.authorization);
  if(head.id!==authorizationId)throw new Error("The captured authorization head differs.");
  const document=await loadAuthorization();
  const prior=parsePrescriptionAuthorization(admitLegacyResult(nativePrescriptionAuthorizationSchema,document),pet,authorizationId);
  if(prior.authorization_hash!==head.hash||prior.context.draft.fields.product_id!==pointer.product_id||prior.artifact.fulfillment_mode!=="practice_stock"||prior.artifact.unit!==preparation.frozen.catalog.unit)throw new Error("The immutable authorization differs from the captured source.");
  createFulfillmentApi(noTransport,actor,prior).admitSaved(id,writer==="record_native_dispense"?"dispense":"pickup",request,raw);return;
 }
 const t=writer==="append_native_dispense_correction"?q:entryObject(entryObject(q.intent).target);
 const target=correctionTargetSchema.parse({authorization_id:t.authorization_id,pet_id:t.pet_id,dispense_id:t.dispense_id});
 if(writer==="append_native_dispense_correction")createFulfillmentCorrectionsApi(noTransport,actor,target).admitSaved(id,request,raw);
 else if(writer==="record_native_dispense_return")createNativeReturnsApi(noTransport,actor,target).admitSaved(id,request,raw);
 else if(writer==="record_native_dispense_return_v2")createNativeReconciliationApi(noTransport,actor,target).admitSaved(id,request,raw);
 else if(writer==="record_native_return_discrepancy")createNativeReturnDiscrepancyApi(noTransport,actor,target).admitSaved(id,request,raw);
 else throw new Error("Unknown original saved writer.");
}
