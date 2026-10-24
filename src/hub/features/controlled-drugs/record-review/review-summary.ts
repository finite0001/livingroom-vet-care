import { ExactJsonNumber } from "./exact-json.ts";
import type { PreparedReviewPacket } from "./prepared-packet.ts";

export interface ReviewStockLine {
  id: string;
  container: string;
  channel: string;
  quantity: string;
  unit: string;
}
export interface ReviewRelationship { label: string; id: string; recordHash?: string }
export interface ReviewReadableSummary {
  eventKind: string;
  product: string;
  originalPerformer: string;
  observation: string;
  observedAt: string | null;
  recordedAt: string;
  originalNote: string;
  clinicalDose: string | null;
  clinicalRoute: string | null;
  stockLines: readonly ReviewStockLine[];
  relationships: readonly ReviewRelationship[];
  deadline: string;
  dueAt: string | null;
  deadlineReason: string | null;
  anchor: string;
  anchorBasis: string;
  anchorLocalDate: string;
  selectedStaffedDate: string;
  historicalPolicy: string;
  historicalCalendar: string;
}
const missing = "Historical information missing";
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) &&
  !(value instanceof ExactJsonNumber) ? value as Record<string, unknown> : {};
const text = (value: unknown, absent = missing) => typeof value === "string" && value.length ? value : absent;
const eventLabels: Record<string, string> = {
  receive_inventory: "Inventory received", adjust_inventory: "Inventory adjustment", record_patient_treatment: "Patient treatment",
  record_anesthesia_drug_administration: "Anesthesia drug administration", record_native_dispense: "Dispense prepared", record_native_pickup: "Dispense picked up",
  "record_native_dispense_return:intake": "Retained medication intake", "record_native_dispense_return:dispose": "Retained medication disposal",
  "record_native_dispense_return:restock": "Retained medication restock", "record_native_dispense_return_v2:intake": "Retained medication intake",
  "record_native_dispense_return_v2:dispose": "Retained medication disposal", "record_native_dispense_return_v2:restock": "Retained medication restock",
  "record_native_dispense_return_v2:retract_intake": "Intake correction", "record_native_dispense_return_v2:retract_disposal": "Disposal correction",
  "record_native_dispense_return_v2:retract_restock": "Restock correction", "record_native_return_discrepancy:report": "Discrepancy reported",
  "record_native_return_discrepancy:note": "Discrepancy note", "record_native_return_discrepancy:resolve_corrected": "Discrepancy resolved with corrections",
  "record_native_return_discrepancy:resolve_confirmed_original": "Discrepancy resolved by confirming original",
  "append_native_dispense_correction:clinical_annotation": "Clinical annotation", "append_native_dispense_correction:operational_annotation": "Operational annotation",
  "append_native_dispense_correction:pickup_amendment": "Pickup amendment",
};
const deadlines: Record<string, string> = { configured: "Historical policy deadline", not_configured: "No deadline configured",
  not_assigned: "Deadline assigned to another native event", historical_policy_unavailable: "Historical policy unavailable", calendar_unavailable: "Historical calendar unavailable" };
const reasons: Record<string, string> = { kind_not_configured: "This event kind has no configured deadline.", other_native_kind_selected: "The original dispense family selected another event kind.",
  no_policy_at_anchor: "No policy was available at the retained selection time.", policy_disabled_at_anchor: "The historical policy was disabled.",
  missing_managed_dispense_family: "The original managed dispense family is unavailable.", family_site_unproven: "The original family site is unproven.",
  anchor_outside_calendar_range: "The selection time falls outside the historical calendar range.", anchor_outside_coverage: "The historical calendar does not cover the selection time.",
  no_later_staffed_day_in_coverage: "No later staffed day is retained in calendar coverage.", site_unproven: "The event site is unproven." };

/** Presentation from the admitted historical packet only. No live lookups,
 * quantity sums, dose inference, newest amendment selection or unit fallback.
 */
export function summarizePreparedReview(packet: PreparedReviewPacket): ReviewReadableSummary {
  const event = packet.event, catalog = record(packet.clinical_snapshot.catalog), historical = record(packet.obligation.historical);
  const cells = new Map(packet.cells.map(value => [value.id, value]));
  const containers = new Map(packet.containers.map(value => [value.id, value]));
  const stockLines = packet.event_lines.filter(line => line.event_id === packet.target.event_id).map((line, index) => {
    const cell = cells.get(line.cell_id), container = cell && containers.get(cell.container_id);
    return { id: text(line.id, String(index)), container: text(container?.label, "Historical container label missing"),
      channel: ({ available: "Available stock", prepared: "Prepared custody", return_held: "Return held custody" })[text(cell?.channel)] ?? "Historical stock category missing",
      quantity: line.quantity_delta instanceof ExactJsonNumber ? String(line.quantity_delta) : "Historical quantity missing",
      unit: text(container?.stock_unit, "Historical stock unit missing") };
  });
  const relationships: ReviewRelationship[] = [];
  function relationship(label: string, id: unknown, recordHash?: unknown) {
    if (typeof id === "string") relationships.push({ label, id, ...(typeof recordHash === "string" ? { recordHash } : {}) });
  }
  const ownSource = (relation: string) => record(packet.source_rows.find(source => source.relation === relation && source.key.id === packet.target.event_id)?.row);
  const treatment = ownSource("public.patient_treatments");
  const returned = ownSource("public.native_return_events"), correction = record(record(returned.document).correction_target);
  relationship("Corrects return record", correction.event_id, correction.record_hash);
  const discrepancy = ownSource("public.native_return_discrepancy_events"), document = record(discrepancy.document), source = record(document.source);
  relationship("Discrepancy source return", source.event_id, source.record_hash); relationship("Discrepancy case", discrepancy.case_id);
  if (Array.isArray(document.correction_ids)) document.correction_ids.forEach(id => relationship("Resolution correction", id));
  const annotation = ownSource("public.native_dispense_correction_events"), annotated = record(annotation.document);
  relationship("Original dispense", annotation.dispense_id); relationship("Amends prior record", annotated.amends_event_id);
  relationship("Original pickup", record(annotated.pickup_amendment).original_pickup_id);
  return {
    eventKind: eventLabels[packet.adapter.event_kind] ?? missing, product: text(catalog.name, "Historical product name missing"),
    originalPerformer: text(event.actor_name, "Historical performer name missing"),
    observation: event.basis === "physical_record" ? "Recorded physical event" : event.basis === "correction_assertion" ? "Correction assertion" :
      event.basis === "discrepancy_assertion" ? "Discrepancy assertion" : event.basis === "annotation" ? "Annotation" : missing,
    observedAt: typeof event.observed_at === "string" ? event.observed_at : null,
    recordedAt: text(event.recorded_at), originalNote: text(event.note, "Historical note missing"), stockLines, relationships,
    clinicalDose: typeof treatment.dose === "string" ? treatment.dose : null, clinicalRoute: typeof treatment.route === "string" ? treatment.route : null,
    deadline: deadlines[text(historical.deadline_basis)] ?? "Historical deadline information missing",
    dueAt: typeof historical.due_at === "string" ? historical.due_at : null,
    deadlineReason: typeof historical.unavailable_reason === "string" ? reasons[historical.unavailable_reason] ?? "Historical deadline reason missing" : null,
    anchor: text(historical.selection_anchor), anchorBasis: historical.anchor_basis === "observed_at" ? "Actual event time" : historical.anchor_basis === "recorded_at" ? "Server recorded time" : missing,
    anchorLocalDate: text(historical.anchor_local_date, historical.anchor_local_date === null ? "No local date retained" : missing),
    selectedStaffedDate: text(historical.selected_staffed_date, historical.selected_staffed_date === null ? "No staffed date selected" : missing),
    historicalPolicy: text(historical.policy_id, historical.policy_id === null ? "No historical policy selected" : missing),
    historicalCalendar: text(historical.calendar_id, historical.calendar_id === null ? "No historical calendar selected" : missing),
  };
}
