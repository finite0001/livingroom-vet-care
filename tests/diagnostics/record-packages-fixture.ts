import type { ReleaseBundle } from "../../supabase/functions/_shared/record-release-renderer.ts";
import { sha256Hex } from "../../supabase/functions/_shared/release-email-payload.ts";
import { releaseArtifact } from "../record-releases/fixture.ts";
export const fixtureId = (n: number) =>
  `b3600000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const diagnosticFixtureBytes = new TextEncoder().encode(
  "%PDF-1.4\nsynthetic unit contract\n%%EOF",
);
export async function diagnosticPackageFixture(
  mode: "current" | "historical" = "current",
  patientId = fixtureId(1),
  clientId = fixtureId(2),
): Promise<ReleaseBundle> {
  const s = structuredClone(releaseArtifact.preview.snapshot);
  Object.assign(s, {
    schema_version: 14,
    encounters: [],
    certificates: [],
    lab_results: [],
    attachments: [],
    dental_charts: [],
    qol_records: [],
    anesthesia_records: [],
    lesions: [],
    problems: [],
    weights: [],
    treatments: [],
    patient_summaries: [],
    lab_reports: [],
    external_records: [],
    imported_histories: [],
    problem_source_extractions: [],
    imported_vaccinations: [],
    imported_prescriptions: [],
    api_attachments: [],
    native_prescriptions: [],
    native_dispenses: [],
  });
  s.patient.id = patientId;
  s.recipient.client_id = clientId;
  const v = {
    id: fixtureId(3),
    panel_id: fixtureId(4),
    version: 1,
    label: "Synthetic <script>alert(1)</script>",
    reviewed_at: "2026-10-01T01:00:00Z",
    source_hash: "a".repeat(64),
  };
  const b = {
    binding_version: 1 as const,
    job_id: v.id,
    pet_id: s.patient.id,
    panel_id: v.panel_id,
    mode,
    version: v.version,
    label: v.label,
    reviewed_at: v.reviewed_at,
    source_hash: v.source_hash,
    snapshot_hash: "b".repeat(64),
    manifest_sha256: "c".repeat(64),
    sha256: await sha256Hex(diagnosticFixtureBytes),
    byte_length: diagnosticFixtureBytes.length,
    embedded_versions: [
      v,
      {
        ...v,
        id: fixtureId(5),
        panel_id: fixtureId(6),
        label: "Earlier panel",
      },
    ],
    total_panels: 3,
    bucket: "diagnostic-pdfs" as const,
    object_path: `${s.patient.id}/${v.id}/original.pdf`,
    object_id: fixtureId(7),
    object_created_at: "2026-10-01T01:01:00Z",
    object_updated_at: "2026-10-01T01:01:00Z",
    object_version: "synthetic-body-v1",
  };
  s.diagnostic_pdfs = [
    {
      binding: b,
      binding_hash: "d".repeat(64),
      review_context: b.embedded_versions.map((v) => ({
        panel_id: v.panel_id,
        head_id: v.id,
        version: 2,
      })),
    },
  ];
  s.selection = {
    native_prescription_ids: [],
    native_dispense_ids: [],
    api_attachment_ids: [],
    imported_prescription_ids: [],
    imported_vaccination_ids: [],
    imported_history_ids: [],
    diagnostic_pdf_ids: mode === "current" ? [v.id] : [],
    diagnostic_pdf_historical_ids: mode === "historical" ? [v.id] : [],
  };
  s.attachments = [
    {
      id: v.id,
      version: 1,
      file_name: `diagnostic-${v.id}.pdf`,
      file_path: b.object_path,
      bucket: b.bucket,
      mime_type: "application/pdf",
      file_size: diagnosticFixtureBytes.length,
      content_sha256: b.sha256,
      document_date: "2026-09-30",
      category: "diagnostic_pdf",
      diagnostic_pdf_ref: { job_id: v.id, mode, binding_hash: "d".repeat(64) },
    },
  ];
  return {
    release: {
      id: fixtureId(8),
      pet_id: s.patient.id,
      client_id: s.recipient.client_id,
      channel: "EMAIL",
      recipient: s.recipient.address,
      selection: s.selection,
      snapshot: s,
      source_hash: "e".repeat(64),
      created_by: fixtureId(9),
      created_at: "2026-10-01T02:00:00Z",
    },
    events: [],
    eligible: true,
    ineligibility_reason: null,
  };
}
