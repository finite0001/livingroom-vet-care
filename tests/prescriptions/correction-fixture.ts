import { prescription, dispense, status } from "./renderer-fixture.ts";
import type { NativePrescriptionArtifact, NativeDispenseArtifact } from "../../supabase/functions/_shared/native-prescription-renderer.ts";
import type { CorrectionEvent, NativePrescriptionPrintV2, DispenseCorrectionDisclosure } from "../../supabase/functions/_shared/native-dispense-corrections.ts";
const id = (n: number) => `a9120000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export function correctionFixture(order: NativePrescriptionArtifact = prescription, fill: NativeDispenseArtifact = dispense): NativePrescriptionPrintV2 {
  const pickup = { id: id(1), document_hash: "d".repeat(64), picked_up_at: "2026-09-16T11:00:00Z", recipient_name: "Original recipient", recipient_relationship: "Owner", actor_id: order.prescriber.user_id };
  const events: CorrectionEvent[] = [];
  function append(kind: CorrectionEvent["kind"], note: string) {
    const prior = events.at(-1), sequence = events.length + 1;
    const e: CorrectionEvent = { version: 1, id: id(10 + sequence), target: { authorization_id: order.authorization_id, pet_id: order.patient.id, dispense_id: fill.id }, authorization_hash: order.authorization_hash, dispense_document_hash: "e".repeat(64), sequence, prior_event_id: prior?.id ?? null, prior_record_hash: prior?.record_hash ?? null, actor: { id: order.prescriber.user_id, name: kind === "clinical_annotation" ? "Synthetic DVM" : "Synthetic staff", authority: kind === "clinical_annotation" ? "active_dvm" : "active_staff" }, kind, reason: "Synthetic reviewed correction", note, amends_event_id: null, pickup_amendment: null, reviewed_context_hash: "f".repeat(64), created_at: `2026-09-16T12:${String(sequence).padStart(2, "0")}:00Z`, record_hash: String(sequence).repeat(64) };
    events.push(e); return e;
  }
  append("operational_annotation", "Original packaging note clarified; no quantity changed.");
  append("clinical_annotation", "Clinician review is an annotation, not a new medication order.");
  const disputed = append("pickup_amendment", "Original recipient assertion disputed.");
  disputed.pickup_amendment = { original_pickup_id: pickup.id, disposition: "recorded_in_error", handoff: null };
  const corrected = append("pickup_amendment", "Corrected handoff assertion recorded by staff.");
  corrected.amends_event_id = disputed.id;
  corrected.pickup_amendment = { original_pickup_id: pickup.id, disposition: "corrected_handoff", handoff: { picked_up_at: "2026-09-16T11:05:00Z", recipient_name: "Corrected recipient", recipient_relationship: "Authorized caregiver" } };
  const corrections: DispenseCorrectionDisclosure = { version: 1, head: { event_id: corrected.id, version: 4, record_hash: corrected.record_hash }, events, latest_pickup_amendment: { event_id: corrected.id, version: 4, value: corrected.pickup_amendment } };
  return { version: 2, prescription: structuredClone(order), status: { ...status, authorization_id: order.authorization_id, authorization_hash: order.authorization_hash, checked_at: "2026-09-16T13:00:00Z" }, dispense: structuredClone(fill), correction_summary: { version: 1, event_count: 4, affected_dispense_count: 1, heads_hash: "c".repeat(64) }, dispense_corrections: corrections, original_pickup: pickup };
}
