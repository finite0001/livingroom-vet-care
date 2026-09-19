import { prescription, dispense, status } from "./renderer-fixture.ts";
import type { NativePrescriptionArtifact, NativeDispenseArtifact } from "../../supabase/functions/_shared/native-prescription-renderer.ts";
import type { NativePrescriptionPrintV3, ReturnEvent, ReturnPolicy, ReturnBalance } from "../../supabase/functions/_shared/native-dispense-returns.ts";
const id = (n: number) => `a9130000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const emptySummary = { version: 1 as const, event_count: 0, affected_dispense_count: 0, heads_hash: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945" };
export function returnFixture(order: NativePrescriptionArtifact = prescription, fill: NativeDispenseArtifact = dispense): NativePrescriptionPrintV3 {
  const allocation = id(30), lot = fill.lots[0];
  const policy: ReturnPolicy = { version: 1, enabled: true, review_reference: "Synthetic policy review; not clinical approval", actor_id: order.prescriber.user_id, actor_name: "Synthetic DVM", reviewed_at: "2026-09-16T11:00:00Z", record_hash: "a".repeat(64) };
  const events: ReturnEvent[] = [];
  function append(action: ReturnEvent["action"], n: string, intakeId: string | null) {
    const prior = events.at(-1), sequence = events.length + 1;
    const e: ReturnEvent = { version: 1, id: id(sequence), target: { authorization_id: order.authorization_id, pet_id: order.patient.id, dispense_id: fill.id }, authorization_hash: order.authorization_hash, dispense_document_hash: "e".repeat(64), sequence, prior_event_id: prior?.id ?? null, prior_record_hash: prior?.record_hash ?? null, actor: { id: order.prescriber.user_id, name: "Synthetic return reviewer", authority: action === "restock" ? "active_dvm" : "active_staff" }, action, intake_id: intakeId, allocations: [{ allocation_id: allocation, lot_id: lot.id, quantity: n, movement_id: action === "restock" ? id(50 + sequence) : null }], custody: action === "intake" ? "clinic_retained" : null, package_condition: action === "intake" ? "sealed_intact" : null, storage_history: action === "intake" ? "controlled" : null, reason: "Synthetic physical return", note: "Synthetic client-shareable custody note", policy: action === "restock" ? policy : null, reviewed_context_hash: "b".repeat(64), created_at: `2026-09-16T12:0${sequence}:00Z`, record_hash: String(sequence).repeat(64) };
    events.push(e); return e;
  }
  const first = append("intake", "5.000", null);
  append("dispose", "1.000", first.id); append("restock", "3.000", first.id);
  const other = append("intake", "1.000", null); other.custody = "client_returned"; other.package_condition = "opened"; other.storage_history = "unknown";
  const last = events.at(-1)!;
  const balance: ReturnBalance = { allocation_id: allocation, lot_id: lot.id, lot_number: lot.number, expires_on: lot.expires_on, dispensed_quantity: "10.000", returned_quantity: "6.000", remaining_returnable_quantity: "4.000", held_quantity: "2.000", disposed_quantity: "1.000", restocked_quantity: "3.000" };
  return { version: 3, prescription: structuredClone(order), status: { ...status, authorization_id: order.authorization_id, authorization_hash: order.authorization_hash, checked_at: "2026-09-16T13:00:00Z" }, dispense: structuredClone(fill), correction_summary: structuredClone(emptySummary), dispense_corrections: { version: 1, head: { version: 0, event_id: null, record_hash: null }, events: [], latest_pickup_amendment: null }, original_pickup: null, return_summary: { version: 1, event_count: 4, affected_dispense_count: 1, heads_hash: "c".repeat(64) }, dispense_returns: { version: 1, head: { event_id: last.id, version: 4, record_hash: last.record_hash }, events, allocations: [balance] } };
}
