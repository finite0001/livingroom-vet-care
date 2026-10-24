import { ExactJsonNumber, type ExactJson } from "./exact-json.ts";
import { reviewInstantMicroseconds } from "./exact-values.ts";
import { hashReviewEvent, hashReviewObligation, hashReviewParentRequest, hashReviewPreparationContext, hashReviewSourceRow, hashReviewTarget } from "./component-hashes.ts";
import { verifyProspectivePacketStructure } from "./prospective-packet-structure.ts";
import type { PreparedReviewPacket } from "./prepared-packet.ts";
import type { RecordReviewRequest } from "./request.ts";

interface EvidenceObject { readonly [key: string]: ExactJson }
// Literal C0/A1 dispatch; prefix matching would admit unreviewed native actions.
const adapters = {
  receive_inventory: "movement_v1", adjust_inventory: "movement_v1", record_patient_treatment: "treatment_v1",
  record_anesthesia_drug_administration: "anesthesia_v1", record_native_dispense: "dispense_v1", record_native_pickup: "pickup_v1",
  "record_native_dispense_return:intake": "return_v1", "record_native_dispense_return:dispose": "return_v1", "record_native_dispense_return:restock": "return_v1",
  "record_native_dispense_return_v2:intake": "return_v2", "record_native_dispense_return_v2:dispose": "return_v2", "record_native_dispense_return_v2:restock": "return_v2",
  "record_native_dispense_return_v2:retract_intake": "retraction_v1", "record_native_dispense_return_v2:retract_disposal": "retraction_v1", "record_native_dispense_return_v2:retract_restock": "retraction_v1",
  "record_native_return_discrepancy:report": "discrepancy_v1", "record_native_return_discrepancy:note": "discrepancy_v1",
  "record_native_return_discrepancy:resolve_corrected": "discrepancy_v1", "record_native_return_discrepancy:resolve_confirmed_original": "discrepancy_v1",
  "append_native_dispense_correction:clinical_annotation": "annotation_v1", "append_native_dispense_correction:operational_annotation": "annotation_v1", "append_native_dispense_correction:pickup_amendment": "annotation_v1",
} as const;
function invalid(): never { throw new Error("Prospective component commitments or parent relationships differ"); }
function object(value: ExactJson): EvidenceObject {
  if (!value || typeof value !== "object" || Array.isArray(value) || value instanceof ExactJsonNumber) invalid();
  return value as EvidenceObject;
}
function equal(a: ExactJson, b: ExactJson): boolean {
  if (a instanceof ExactJsonNumber || b instanceof ExactJsonNumber)
    return a instanceof ExactJsonNumber && b instanceof ExactJsonNumber && a.token === b.token;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return a === b;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => equal(value, b[index]));
  const aa = object(a), bb = object(b);
  return Object.keys(aa).length === Object.keys(bb).length && Object.keys(aa).every(key => Object.prototype.hasOwnProperty.call(bb, key) && equal(aa[key], bb[key]));
}
function instant(value: ExactJson): bigint {
  if (typeof value !== "string") invalid();
  return reviewInstantMicroseconds(value);
}

/** Additional LOCAL consistency checks for the prospective DTO, after lossless
 * decoding and packet parsing. This is not complete ReviewEvidenceAdmission:
 * native document semantics, direct graph closure, historical selection and
 * deployment/Auth/database authority remain required independently. Hashes
 * establish consistency of supplied components, not genuine row membership.
 * Never rebuild or hash the whole prepared packet.
 */
export async function verifyProspectiveComponentConsistency(packet: PreparedReviewPacket, request: Readonly<RecordReviewRequest>): Promise<void> {
  verifyProspectivePacketStructure(packet, request);
  for (let index = 0; index < packet.source_rows.length; index++) {
    const source = packet.source_rows[index];
    if (await hashReviewSourceRow(source.relation, source.row) !== packet.adapter.source_refs[index].row_hash) invalid();
  }
  const event = packet.event, obligation = packet.obligation;
  if (adapters[packet.adapter.event_kind] !== packet.adapter.adapter_id) invalid();
  if (event.secondary_review_required !== true || await hashReviewTarget(packet.target) !== obligation.target_hash ||
    await hashReviewObligation(obligation) !== obligation.binding_hash) invalid();

  function retained(relation: string, id: ExactJson, role: string): EvidenceObject {
    const sources = packet.source_rows.filter(source => source.relation === relation && source.row.id === id);
    if (sources.length !== 1) invalid();
    const index = packet.source_rows.indexOf(sources[0]);
    if (packet.adapter.source_refs[index].role !== role) invalid();
    return sources[0].row;
  }
  if (!equal(retained("public.controlled_stock_events", event.id, "reviewed_target"), event) ||
    !equal(retained("public.controlled_stock_preparations", event.id, "reviewed_target"), packet.parent_preparation)) invalid();
  for (let index = 0; index < packet.source_rows.length; index++) {
    const source = packet.source_rows[index];
    if (source.relation !== "public.controlled_stock_events") continue;
    const parent = source.row, role = packet.adapter.source_refs[index].role;
    const preparation = retained("public.controlled_stock_preparations", parent.id, role), action = retained("public.controlled_stock_actions", parent.id, role);
    const context = object(preparation.context), frozen = object(preparation.frozen), basis = object(context.basis), permission = object(frozen.permission);
    const argumentsValue = object(preparation.canonical_arguments);
    let kind = parent.writer;
    if (["record_native_dispense_return", "record_native_dispense_return_v2", "record_native_return_discrepancy"].includes(String(parent.writer)))
      kind = String(parent.writer) + ":" + String(object(object(argumentsValue.request).intent).action);
    else if (parent.writer === "append_native_dispense_correction") kind = parent.writer + ":" + String(object(argumentsValue.request).kind);
    if (kind !== parent.event_kind || typeof kind !== "string" || !Object.prototype.hasOwnProperty.call(adapters, kind) ||
      await hashReviewEvent(parent) !== parent.record_hash || await hashReviewPreparationContext(preparation) !== parent.context_hash ||
      await hashReviewParentRequest(preparation) !== preparation.request_hash ||
      parent.product_id !== event.product_id || parent.opening_id !== event.opening_id ||
      preparation.actor_id !== parent.actor_id || preparation.product_id !== parent.product_id ||
      action.actor_id !== parent.actor_id || action.writer !== parent.writer || action.session_id !== parent.session_id ||
      action.request_hash !== preparation.request_hash || instant(action.recorded_at) !== instant(parent.recorded_at) ||
      preparation.writer !== parent.writer || instant(parent.recorded_at) < instant(preparation.created_at) ||
      preparation.policy_version_id !== parent.policy_version_id || preparation.opening_id !== parent.opening_id ||
      context.product_id !== preparation.product_id || context.policy_version_id !== preparation.policy_version_id ||
      context.opening_id !== preparation.opening_id || context.state_head_id !== preparation.state_head_id ||
      parent.basis !== basis.kind || parent.note !== basis.note || parent.secondary_review_required !== permission.secondary_review ||
      !equal(parent.clinical_snapshot, { catalog: frozen.catalog, original_result: parent.canonical_result })) invalid();
    if (parent.basis === "physical_record") {
      if (instant(parent.observed_at) !== instant(basis.observed_at) || instant(parent.observed_at) > instant(parent.recorded_at)) invalid();
    } else if (parent.observed_at !== null) invalid();

    const heads = packet.transitions.filter(transition => transition.event_id === parent.id)
      .sort((a, b) => String(a.container_id) < String(b.container_id) ? -1 : String(a.container_id) > String(b.container_id) ? 1 : 0)
      .map(transition => ({ container_id: transition.container_id, version: transition.version_after,
        location_id: transition.after_location_id, custodian_id: transition.after_custodian_id,
        status: transition.after_status, last_event_id: transition.event_id }));
    if (!equal(action.receipt, { version: new ExactJsonNumber("1"), id: parent.id, writer: parent.writer,
      actor_id: parent.actor_id, canonical_result: parent.canonical_result, event: parent, containers: heads })) invalid();
  }
  const historical = object(obligation.historical);
  if (historical.anchor_basis !== (event.basis === "physical_record" ? "observed_at" : "recorded_at")) invalid();
  const anchor = historical.anchor_basis === "observed_at" ? event.observed_at : event.recorded_at;
  if (instant(historical.selection_anchor) !== instant(anchor)) invalid();
}
