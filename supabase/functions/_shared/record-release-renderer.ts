import { renderNativePrescriptions, type NativePrescriptionRelease, type NativeDispenseRelease } from "./record-release-native-prescriptions.ts";
export type { NativePrescriptionRelease, NativeDispenseRelease } from "./record-release-native-prescriptions.ts";
import { renderReleaseApiAttachments, type ReleaseApiAttachment } from "./record-release-api-attachments.ts";
import { renderImportedPrescriptions, type ReleaseImportedPrescription } from "./record-release-imported-prescriptions.ts";
export type { ReleaseImportedPrescription } from "./record-release-imported-prescriptions.ts";
import { renderImportedVaccinations, type ReleaseImportedVaccination } from "./record-release-imported-vaccinations.ts";
export type { ReleaseImportedVaccination } from "./record-release-imported-vaccinations.ts";
import { renderImportedHistory, type ReleaseImportedHistory, type ReleaseProblemExtraction } from "./record-release-imported-history.ts";
export type { ReleaseImportedHistory, ReleaseProblemExtraction } from "./record-release-imported-history.ts";
import { renderReleaseSourceProvenance, type ReleaseCaptureReference, type ReleaseLabReport, type ReleaseExternalRecord } from "./record-release-source-provenance.ts";
export type { ReleaseCaptureReference, ReleaseLabReport, ReleaseExternalRecord } from "./record-release-source-provenance.ts";
import {
  renderReleaseHistory,
  type HistorySources,
} from "./record-release-history.ts";
import {
  renderReleaseCharts,
  type ChartSources,
} from "./record-release-charts.ts";
import {
  renderVaccineCertificate,
  type IssuedCertificate,
} from "./vaccine-certificate-renderer.ts";
export interface ReleaseAttachment {
  id: string;
  version: number;
  file_name: string;
  file_path: string;
  bucket: "patient-documents" | "ezyvet-attachment-originals";
  api_attachment_ref?: { record_id: string; record_hash: string; capture_hash: string };
  mime_type: "application/pdf" | "image/jpeg" | "image/png";
  file_size: number;
  content_sha256?: string;
  provenance_captures?: ReleaseCaptureReference[];
  document_date: string | null;
  category: string;
}
export interface ReleaseSnapshot extends ChartSources, HistorySources {
  schema_version: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
  native_prescriptions?: NativePrescriptionRelease[];
  native_dispenses?: NativeDispenseRelease[];
  api_attachments?: ReleaseApiAttachment[];
  selection?: ReleaseSelection;
  imported_prescriptions?: ReleaseImportedPrescription[];
  imported_vaccinations?: ReleaseImportedVaccination[];
  imported_histories?: ReleaseImportedHistory[];
  problem_source_extractions?: ReleaseProblemExtraction[];
  lab_reports?: ReleaseLabReport[];
  external_records?: ReleaseExternalRecord[];
  patient: {
    id: string;
    version: number;
    name: string;
    species: string;
    breed: string | null;
    dob: string | null;
    birth_date_precision: string;
    microchip_id: string | null;
  };
  recipient: {
    client_id: string;
    client_version: number;
    name: string;
    channel: "EMAIL" | "SMS";
    address: string;
  };
  encounters: Array<{
    id: string;
    version: number;
    visit_at: string;
    visit_type: string;
    subjective: string;
    objective: string;
    assessment: string;
    plan: string;
    signed_by: string;
    signed_at: string;
    addenda: Array<{
      id: string;
      content: string;
      created_by: string;
      created_at: string;
    }>;
  }>;
  certificates: IssuedCertificate[];
  lab_results: Array<{
    id: string;
    version: number;
    test_name: string;
    accession: string;
    collected_date: string;
    result_date: string;
    result_document_id: string;
  }>;
  attachments: ReleaseAttachment[];
}
export interface ReleasePreview {
  snapshot: ReleaseSnapshot;
  source_hash: string;
}
export interface ReleaseRow extends ReleasePreview {
  id: string;
  pet_id: string;
  client_id: string;
  channel: "EMAIL" | "SMS";
  recipient: string;
  selection: ReleaseSelection;
  created_by: string;
  created_at: string;
}
export interface ReleaseSelection {
  native_prescription_ids?: string[];
  native_dispense_ids?: string[];
  api_attachment_ids?: string[];
  imported_prescription_ids?: string[];
  imported_vaccination_ids?: string[];
  imported_history_ids?: string[];
  lab_report_ids?: string[];
  external_record_ids?: string[];
  problem_ids?: string[];
  patient_summary_ids?: string[];
  weight_ids?: string[];
  treatment_ids?: string[];
  encounter_ids?: string[];
  certificate_ids?: string[];
  lab_order_ids?: string[];
  document_ids?: string[];
  dental_ids?: string[];
  qol_ids?: string[];
  anesthesia_ids?: string[];
  lesion_ids?: string[];
}
export interface ReleaseEvent {
  id: string;
  release_id: string;
  kind: "withdrawn" | "source_changed";
  reason: string;
  created_by: string | null;
  created_at: string;
}
export interface ReleaseBundle {
  release: ReleaseRow;
  events: ReleaseEvent[];
  eligible: boolean;
  ineligibility_reason: string | null;
}
export interface ReleaseArtifact {
  preview: ReleasePreview;
  confirmed?: {
    id: string;
    created_at: string;
    created_by: string;
    eligible: boolean;
    events: readonly ReleaseEvent[];
    ineligibility_reason: string | null;
  };
}
const escape = (value: unknown) =>
  String(value ?? "Not recorded").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
const field = (label: string, value: unknown) =>
  `<div><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`;
const instant = (value: string) => `${escape(value)} (ISO 8601 instant)`;
/** Deterministic review/export HTML. Original attachments remain separate immutable references;
 * this renderer never fetches, embeds, signs URLs, uploads, or claims to generate a PDF.
 * Call read_record_release again before rendering a confirmed package; never infer eligibility.
 */
export function renderRecordRelease(artifact: ReleaseArtifact): string {
  const { snapshot: s, source_hash: hash } = artifact.preview;
  if (![1, 2, 3, 4, 5, 6, 7, 8, 9, 10].includes(s.schema_version) || !/^[a-f0-9]{64}$/.test(hash))
    throw new Error("Unsupported release snapshot or missing review hash.");
  if (
    s.schema_version >= 4 &&
    (!Array.isArray(s.weights) ||
      s.weights.some(
        (w) =>
          !Array.isArray(w.import_provenance) ||
          w.import_provenance.some(
            (p) =>
              !p ||
              !["create", "link"].includes(p.action) ||
              !p.original ||
              !p.reviewed_values ||
              !Array.isArray(p.source_reviews) ||
              typeof p.latest_source_reviewed !== "boolean",
          ),
      ))
  ) {
    throw new Error(
      "Incomplete version 4 weight provenance; obtain a fresh reviewed snapshot.",
    );
  }

  if (
    s.encounters.length +
      s.certificates.length +
      s.lab_results.length +
      s.attachments.length +
      (s.dental_charts?.length || 0) +
      (s.qol_records?.length || 0) +
      (s.anesthesia_records?.length || 0) +
      (s.lesions?.length || 0) +
      (s.problems?.length || 0) +
      (s.schema_version >= 6 ? s.imported_histories?.length || 0 : 0) +
      (s.schema_version >= 7 ? s.imported_vaccinations?.length || 0 : 0) +
      (s.schema_version >= 8 ? s.imported_prescriptions?.length || 0 : 0) +
      (s.schema_version === 10 ? (s.native_prescriptions?.length || 0) + (s.native_dispenses?.length || 0) : 0) +
      (s.weights?.length || 0) +
      (s.treatments?.length || 0) +
      (s.patient_summaries?.length || 0) ===
    0
  )
    throw new Error("Cannot render an empty release.");
  if (
    s.lab_results.some(
      (l) => !s.attachments.some((a) => a.id === l.result_document_id),
    )
  )
    throw new Error(
      "A selected laboratory result is missing its original report reference.",
    );
  if (
    s.attachments.some(
      (a) =>
        !Number.isSafeInteger(a.file_size) ||
        a.file_size < 1 ||
        a.file_size > 20971520 ||
        !["application/pdf", "image/jpeg", "image/png"].includes(a.mime_type),
    )
  )
    throw new Error("Original attachment metadata is invalid.");
  const nativePrescriptions = renderNativePrescriptions(s);
  const apiAttachments = renderReleaseApiAttachments(s);
  const sourceProvenance = renderReleaseSourceProvenance(s);
  const confirmed = artifact.confirmed;
  const invalid =
    !!confirmed && (!confirmed.eligible || confirmed.events.length > 0);
  const label = !confirmed
    ? "REVIEW DRAFT — NOT CONFIRMED"
    : invalid
      ? "INVALIDATED RELEASE — HISTORICAL COPY"
      : "Reviewed medical records";
  const soap = s.encounters
    .map(
      (e) =>
        `<article><h2>Signed clinical encounter</h2><p>Visit ${instant(e.visit_at)} · ${escape(e.visit_type)} · Version ${escape(e.version)}</p>${["subjective", "objective", "assessment", "plan"].map((key) => `<section><h3>${key[0].toUpperCase() + key.slice(1)}</h3><p>${escape(e[key as "subjective" | "objective" | "assessment" | "plan"])}</p></section>`).join("")}<p>Signed ${instant(e.signed_at)} · Signer record ${escape(e.signed_by)}</p>${e.addenda.map((a) => `<section><h3>Signed-record addendum</h3><p>${escape(a.content)}</p><p>Recorded ${instant(a.created_at)} · Author record ${escape(a.created_by)}</p></section>`).join("")}</article>`,
    )
    .join("");
  const certs = s.certificates
    .map((c) => {
      const html = renderVaccineCertificate(c, []);
      const body = html.slice(
        html.indexOf("<body>") + 6,
        html.lastIndexOf("</body>"),
      );
      return `<article class="certificate"><h2>Included issued certificate</h2>${body}</article>`;
    })
    .join("");
  const labs = s.lab_results
    .map(
      (l) =>
        `<article><h2>Laboratory result: ${escape(l.test_name)}</h2><dl>${field("Accession", l.accession)}${field("Collected", l.collected_date)}${field("Result date", l.result_date)}${field("Reviewed result version", l.version)}${field("Original report", s.attachments.find((a) => a.id === l.result_document_id)?.file_name ?? "Missing attachment reference")}</dl><p>The original report is listed in the attachment manifest; its pages are not embedded in this HTML.</p></article>`,
    )
    .join("");
  const attachments = s.attachments.length
    ? `<article><h2>Original attachment manifest</h2><p>These separately stored originals were selected for this package. This HTML lists them; it does not contain their file bytes.</p><table><thead><tr><th>Original filename</th><th>Type</th><th>Size (bytes)</th><th>Document date</th><th>Version</th></tr></thead><tbody>${s.attachments.map((a) => `<tr><td>${escape(a.file_name)}</td><td>${escape(a.mime_type)}</td><td>${escape(a.file_size)}</td><td>${escape(a.document_date)}</td><td>${escape(a.version)}</td></tr>`).join("")}</tbody></table></article>`
    : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Medical records — ${escape(s.patient.name)}</title><style>@page{size:letter;margin:0.6in}body{font:12px/1.4 Georgia,serif;background:Canvas;color:CanvasText;max-width:7.3in;margin:24px auto;padding:12px}:root{--clinical-alert: hsl(0 72% 38%)}.clinical-alert{color:var(--clinical-alert)}h1{font-size:23px}h2{font-size:18px}h3{font-size:14px}article{border-top:1px solid;margin-top:18px;padding-top:12px}section{break-inside:avoid}p,dd{white-space:pre-wrap;overflow-wrap:anywhere}dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 16px}dt,th{font-weight:bold}dd{margin:0}table{width:100%;border-collapse:collapse}td,th{text-align:left;vertical-align:top;padding:6px;border-bottom:1px solid;overflow-wrap:anywhere}aside{border:2px solid;padding:12px}.certificate{break-before:page}footer{border-top:1px solid;margin-top:20px;font-size:10px}.watermark{display:none}@media print{body{margin:0;padding:0}.watermark{display:block;position:fixed;top:40%;left:8%;font-size:40px;opacity:.15;transform:rotate(-30deg);z-index:-1}h2,h3{break-after:avoid}}</style></head><body>${!confirmed || invalid ? `<div class="watermark">${!confirmed ? "REVIEW DRAFT" : "INVALIDATED RELEASE"}</div>` : ""}<header><h1>${escape(label)}</h1><p>Patient: ${escape(s.patient.name)} · ${escape(s.patient.species)} · ${escape(s.patient.breed)}</p><p>Birth date: ${escape(s.patient.dob)} (${escape(s.patient.birth_date_precision)}) · Microchip: ${escape(s.patient.microchip_id)}</p><p>Selected household recipient: ${escape(s.recipient.name)} · ${escape(s.recipient.channel)} · ${escape(s.recipient.address)}</p>${confirmed ? `<p>Package ${escape(confirmed.id)} · Confirmed ${instant(confirmed.created_at)}</p>` : "<p>Review the complete contents and household recipient before confirming. Nothing has been sent.</p>"}</header>${invalid ? `<aside role="alert"><strong>Not eligible for delivery.</strong><p>${escape(confirmed!.ineligibility_reason)}</p>${confirmed!.events.map((e) => `<p>${escape(e.kind)}: ${escape(e.reason)} · ${instant(e.created_at)}</p>`).join("")}</aside>` : ""}${renderReleaseHistory(s)}${renderImportedHistory(s)}${renderImportedVaccinations(s)}${renderImportedPrescriptions(s)}${nativePrescriptions}${soap}${certs}${labs}${sourceProvenance}${apiAttachments}${renderReleaseCharts(s, (id) => s.attachments.find((a) => a.id === id)?.file_name || "Not included in this package")}${attachments}<footer><p>Review fingerprint: ${escape(hash)}</p><p>Only explicitly selected clinical histories, signed records, issued certificates and shareable originals appear here. Clinical notes and provenance are included as authored and are not automatically redacted. Unsigned chart drafts are excluded. This artifact does not send records or include the bytes of separately stored attachments.</p></footer></body></html>`;
}
