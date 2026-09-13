import { createHash } from "node:crypto";
import { provenanceArtifact } from "./provenance-fixture.ts";
import type {
  ReleaseExternalRecord,
  ReleaseLabReport,
} from "../../supabase/functions/_shared/record-release-renderer.ts";
export const sourceOriginalBytes = new TextEncoder().encode(
  "%PDF-synthetic-source-original",
);
const id = (n: number) =>
  `b5000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
/** Synthetic, frozen schema5 examples: lab original/correction and external original/replacement. */
export function sourceProvenanceArtifact() {
  const a = provenanceArtifact();
  const s = a.preview.snapshot;
  s.schema_version = 5;
  const digest = createHash("sha256").update(sourceOriginalBytes).digest("hex");
  const common = (n: number) => ({
    id: id(n),
    version: 1,
    previous_version_id: null as string | null,
    latest_version_id: id(n),
    historical: false,
    document_id: id(n + 100),
    document_version: 1,
    receipt_id: id(n + 200),
    receipt_hash: "a".repeat(64),
    capture_hash: String(n).slice(-1).repeat(64),
    content_sha256: digest,
    mime_type: "application/pdf",
    file_size: sourceOriginalBytes.length,
    received_at: "2026-09-12T10:00:00Z",
    reviewed_by: id(900),
    reviewed_at: "2026-09-12T11:00:00Z",
    acknowledgments: [] as ReleaseLabReport["acknowledgments"],
  });
  const lab = (n: number): ReleaseLabReport => ({
    ...common(n),
    kind: "original",
    order_id: id(500),
    source_account_id: id(501),
    source_review_id: id(502),
    source: {
      provider_label: "Antech (synthetic)",
      account_reference: "Synthetic practice account",
      environment_label: "Synthetic manual intake",
      entry_method: "staff_entered_v1",
      source_patient_reference: "patient-synthetic",
      source_order_reference: "order-synthetic",
      source_report_reference: "report-" + n,
    },
  });
  const external = (n: number): ReleaseExternalRecord => ({
    ...common(n),
    kind: "original",
    animal_link_id: id(503),
    source: {
      provider_label: "ezyVet",
      source_origin: "https://api.trial.ezyvet.com",
      source_site_uid: "synthetic-site",
      source_animal_id: "synthetic-animal",
      entry_method: "staff_reviewed_manual_export_v1",
      export_reference: "synthetic-export-" + n,
    },
  });
  const l1 = lab(1), l2 = lab(2), e1 = external(3), e2 = external(4);
  l1.historical = true;
  l1.latest_version_id = l2.id;
  l2.kind = "corrected";
  l2.version = 2;
  l2.previous_version_id = l1.id;
  e1.historical = true;
  e1.latest_version_id = e2.id;
  e2.kind = "replacement";
  e2.version = 2;
  e2.previous_version_id = e1.id;
  for (const r of [l1, e2]) {
    r.acknowledgments = [{
      id: id(Number(r.version) + 600 + (r === e2 ? 10 : 0)),
      acknowledged_by: id(901),
      acknowledged_at: "2026-09-12T12:00:00Z",
      capture_hash: r.capture_hash,
      document_version: r.document_version,
    }];
  }
  s.lab_reports = [l1, l2];
  s.external_records = [e1, e2];
  s.lab_results = [];
  s.attachments = [...s.lab_reports, ...s.external_records].map((r) => ({
    id: r.document_id,
    version: r.document_version,
    file_name: `synthetic-${r.id}.pdf`,
    file_path: `private/synthetic/${r.document_id}`,
    bucket: "patient-documents" as const,
    mime_type: "application/pdf" as const,
    file_size: r.file_size,
    document_date: null,
    category: "medical_record",
    content_sha256: digest,
    provenance_captures: [{
      family: s.lab_reports!.includes(r as ReleaseLabReport)
        ? "lab_report" as const
        : "external_record" as const,
      version_id: r.id,
      receipt_id: r.receipt_id,
      receipt_hash: r.receipt_hash,
      capture_hash: r.capture_hash,
    }],
  }));
  return a;
}
