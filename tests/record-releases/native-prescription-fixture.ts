import { apiAttachmentArtifact } from "./api-attachment-fixture.ts";
import { prescription, dispense } from "../prescriptions/renderer-fixture.ts";
import type { NativePrescriptionRelease, NativeDispenseRelease } from "../../supabase/functions/_shared/record-release-native-prescriptions.ts";
export function nativeReleaseArtifact(mixed = false) {
  const a = apiAttachmentArtifact(), s = a.preview.snapshot;
  s.schema_version = 10;
  if (!mixed) {
    for (const key of Object.keys(s)) if (Array.isArray(s[key as keyof typeof s])) Object.assign(s, { [key]: [] });
    for (const key of Object.keys(s.selection!)) Object.assign(s.selection!, { [key]: [] });
  }
  const p: NativePrescriptionRelease = {
    id: prescription.authorization_id, authorization_hash: prescription.authorization_hash,
    artifact: { ...structuredClone(prescription), patient: { ...prescription.patient, id: s.patient.id }, household: { ...prescription.household, id: s.recipient.client_id } },
    status: { state: "active", head_id: null, head_version: 0, event_at: null, reason: null, replacement_id: null },
    usage: { version: 2, native_fill_accounting: "implemented", dispensed_quantity: "10.000", used_fill_slots: 1, remaining_quantity: "80.000", forfeited_quantity: "0.000", unopened_fill_slots: 2, allowance_basis: "native_practice_stock", open_slot: { id: "00000000-0000-4000-8000-000000000020", index: 0, version: 1, remaining_quantity: "20.000" }, fulfillment_head: { event_id: "00000000-0000-4000-8000-000000000021", version: 1 }, external_fulfillment: "unknown" },
  };
  const details = structuredClone(dispense);
  const { invoice_id: _invoice, ...artifact } = details;
  const d: NativeDispenseRelease = { id: dispense.id, artifact_hash: "b".repeat(64), artifact, prescription: structuredClone(p), pickup: null };
  s.native_prescriptions = [p]; s.native_dispenses = [d];
  s.selection = { ...s.selection, native_prescription_ids: [p.id], native_dispense_ids: [d.id] };
  return a;
}
