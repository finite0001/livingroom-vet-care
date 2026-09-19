import { clinicalHistoryArtifact } from "./clinical-history-fixture.ts";
import type { ReleaseImportedVaccination } from "../../supabase/functions/_shared/record-release-renderer.ts";
const id = (n: number) =>
  `b7000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export function vaccinationArtifact() {
  const a = clinicalHistoryArtifact(), s = a.preview.snapshot;
  s.schema_version = 7;
  const v: ReleaseImportedVaccination = {
    id: id(1),
    pet_id: s.patient.id,
    client_id: s.recipient.client_id,
    animal_link_id: id(2),
    version: 1,
    version_hash: "7".repeat(64),
    source: {
      origin: "https://api.trial.ezyvet.com",
      site_uid: "synthetic",
      animal_id: "77",
      vaccination_id: "902",
    },
    snapshot_id: id(3),
    payload_hash: "8".repeat(64),
    observed_head_version: 1,
    original: {
      id: "902",
      consult_id: "901",
      description: "Outside <script>vaccine</script>",
      date_of_administration: "ambiguous date",
      date_of_next_administration: null,
      qty: "1",
      active: "unknown",
    },
    consult: {
      snapshot_id: id(4),
      payload_hash: "9".repeat(64),
      observed_head_version: 1,
      external_id: "901",
    },
    reviewed: {
      administered_on: null,
      administration_date_status: "uninterpreted",
      source_next_due_on: null,
      next_date_status: "unknown",
      status: "unknown",
      outside_author: null,
    },
    product: null,
    reason: "DVM preserved unknown source meaning",
    replaces_id: null,
    expected_predecessor_hash: null,
    approved_by: id(5),
    approved_at: "2026-09-13T12:00:00Z",
    current: {
      is_current: true,
      is_latest: true,
      identity_valid: true,
      snapshot_id: id(3),
      head_version: 1,
      consult_snapshot_id: id(4),
      consult_head_version: 1,
    },
    correction_history: [],
  };
  v.correction_history = [{
    id: v.id,
    version: v.version,
    version_hash: v.version_hash,
    replaces_id: null,
    reason: v.reason,
    approved_by: v.approved_by,
    approved_at: v.approved_at,
  }];
  s.imported_vaccinations = [v];
  s.selection = { imported_vaccination_ids: [v.id] };
  return a;
}
