import { validateReleaseApiAttachments } from "./record-release-api-attachments.ts";
import type { ReleaseSnapshot } from "./record-release-renderer.ts";
export interface ReleaseCaptureReference {
  family: "lab_report" | "external_record";
  version_id: string;
  receipt_id: string;
  receipt_hash: string;
  capture_hash: string;
}
export interface ReleaseSourceAcknowledgment {
  id: string;
  acknowledged_by: string;
  acknowledged_at: string;
  capture_hash: string;
  document_version: number;
}
export interface ReleaseSourceVersion {
  id: string;
  version: number;
  kind: string;
  previous_version_id: string | null;
  latest_version_id: string;
  historical: boolean;
  document_id: string;
  document_version: number;
  receipt_id: string;
  receipt_hash: string;
  capture_hash: string;
  content_sha256: string;
  mime_type: string;
  file_size: number;
  received_at: string;
  reviewed_by: string;
  reviewed_at: string;
  acknowledgments: ReleaseSourceAcknowledgment[];
}
export interface ReleaseLabReport extends ReleaseSourceVersion {
  kind: "original" | "corrected";
  order_id: string;
  source_account_id: string;
  source_review_id: string;
  latest_source_review_id: string;
  source: {
    provider_label: string;
    account_reference: string;
    environment_label: string;
    entry_method: "staff_entered_v1";
    source_patient_reference: string;
    source_order_reference: string;
    source_report_reference: string;
  };
}
export interface ReleaseExternalRecord extends ReleaseSourceVersion {
  kind: "original" | "replacement";
  animal_link_id: string;
  source: {
    provider_label: "ezyVet";
    source_origin: string;
    source_site_uid: string;
    source_animal_id: string;
    entry_method: "staff_reviewed_manual_export_v1";
    export_reference: string;
  };
}
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const hash = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const instant = (v: unknown) =>
  typeof v === "string" && Number.isFinite(Date.parse(v));
const string = (v: unknown) =>
  typeof v === "string" && v.length > 0 && v.length <= 2000;
const fail = () => {
  throw new Error(
    "Incomplete version 5 source provenance; obtain a fresh reviewed snapshot.",
  );
};
/** Validate both directions so missing optional attachment fields cannot downgrade verified sources. */
export function validateReleaseSourceProvenance(s: ReleaseSnapshot): void {
  validateReleaseApiAttachments(s);
  if (s.schema_version !== 5 && s.schema_version !== 6 && s.schema_version !== 7 && s.schema_version !== 8 && s.schema_version !== 9 && s.schema_version !== 10) return;
  if (
    !Array.isArray(s.lab_reports) || !Array.isArray(s.external_records) ||
    !Array.isArray(s.attachments)
  ) fail();
  const expected = new Map<string, ReleaseCaptureReference[]>();
  const sourceIds = new Set<string>();
  const documentIds = new Set<string>();
  for (const d of s.attachments) {
    if (documentIds.has(d.id)) fail();
    documentIds.add(d.id);
  }
  for (
    const [family, rows] of [["lab_report", s.lab_reports], [
      "external_record",
      s.external_records,
    ]] as const
  ) {
    for (const r of rows!) {
      if (
        !r || !uuid(r.id) || sourceIds.has(family + ":" + r.id) ||
        !Number.isSafeInteger(r.version) || r.version < 1 ||
        !uuid(r.document_id) || !uuid(r.receipt_id) ||
        !uuid(r.latest_version_id) || !uuid(r.reviewed_by) ||
        !Number.isSafeInteger(r.document_version) || r.document_version < 1 ||
        !Number.isSafeInteger(r.file_size) || r.file_size < 1 ||
        r.file_size > 20971520 || !hash(r.receipt_hash) ||
        !hash(r.capture_hash) || !hash(r.content_sha256) ||
        !instant(r.received_at) || !instant(r.reviewed_at) ||
        typeof r.historical !== "boolean" ||
        r.historical !== (r.latest_version_id !== r.id) ||
        !Array.isArray(r.acknowledgments)
      ) fail();
      sourceIds.add(family + ":" + r.id);
      if (
        r.kind === "original"
          ? (r.previous_version_id !== null || r.version !== 1)
          : (!uuid(r.previous_version_id) || r.version < 2)
      ) fail();
      const aIds = new Set<string>();
      for (const a of r.acknowledgments) {
        if (
          !a || !uuid(a.id) || aIds.has(a.id) || !uuid(a.acknowledged_by) ||
          !instant(a.acknowledged_at) || a.capture_hash !== r.capture_hash ||
          a.document_version !== r.document_version
        ) fail();
        aIds.add(a.id);
      }
      if (family === "lab_report") {
        const l = r as ReleaseLabReport;
        if (
          !["original", "corrected"].includes(l.kind) || !uuid(l.order_id) ||
          !uuid(l.source_account_id) || !uuid(l.source_review_id) ||
          !uuid(l.latest_source_review_id) ||
          !l.source || l.source.entry_method !== "staff_entered_v1" ||
          ![
            l.source.provider_label,
            l.source.account_reference,
            l.source.environment_label,
            l.source.source_patient_reference,
            l.source.source_order_reference,
            l.source.source_report_reference,
          ].every(string)
        ) fail();
      } else {
        const e = r as ReleaseExternalRecord;
        if (
          !["original", "replacement"].includes(e.kind) ||
          !uuid(e.animal_link_id) || !e.source ||
          e.source.provider_label !== "ezyVet" ||
          e.source.entry_method !== "staff_reviewed_manual_export_v1" ||
          ![
            e.source.source_origin,
            e.source.source_site_uid,
            e.source.source_animal_id,
            e.source.export_reference,
          ].every(string)
        ) fail();
      }
      const d = s.attachments.find((d) => d.id === r.document_id);
      if (
        !d || d.version !== r.document_version || d.mime_type !== r.mime_type ||
        d.file_size !== r.file_size || d.content_sha256 !== r.content_sha256
      ) fail();
      expected.set(r.document_id, [...(expected.get(r.document_id) || []), {
        family,
        version_id: r.id,
        receipt_id: r.receipt_id,
        receipt_hash: r.receipt_hash,
        capture_hash: r.capture_hash,
      }]);
    }
  }
  const key = (p: ReleaseCaptureReference) =>
    [p.family, p.version_id, p.receipt_id, p.receipt_hash, p.capture_hash].join(
      ":",
    );
  for (const d of s.attachments) {
    const refs = expected.get(d.id);
    if (!refs) {
      if ((s.schema_version === 9 || s.schema_version === 10) && d.bucket === "ezyvet-attachment-originals") continue;
      if (
        d.content_sha256 !== undefined || d.provenance_captures !== undefined
      ) fail();
      continue;
    }
    if (
      !hash(d.content_sha256) || !Array.isArray(d.provenance_captures) ||
      d.provenance_captures.length !== refs.length ||
      new Set(d.provenance_captures.map(key)).size !== refs.length ||
      d.provenance_captures.some((p) =>
        !p || !refs.some((r) => key(r) === key(p))
      )
    ) fail();
  }
}
const esc = (v: unknown) =>
  String(v ?? "Not recorded").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function renderReleaseSourceProvenance(s: ReleaseSnapshot): string {
  if (s.schema_version !== 5 && s.schema_version !== 6 && s.schema_version !== 7 && s.schema_version !== 8 && s.schema_version !== 9 && s.schema_version !== 10) return "";
  validateReleaseSourceProvenance(s);
  const common = (r: ReleaseSourceVersion) =>
    `<p>Version ${r.version} · ${esc(r.kind)} · ${
      r.historical ? "Historical version" : "Current version"
    } · Record ${esc(r.id)}</p><p>Previous version: ${
      esc(r.previous_version_id)
    } · Latest version: ${esc(r.latest_version_id)}</p><p>Received ${
      esc(r.received_at)
    } · Locally reviewed ${esc(r.reviewed_at)} · Local reviewer ${
      esc(r.reviewed_by)
    }</p><p>Original attachment ${
      s.attachments.findIndex((d) =>
        d.id === r.document_id && d.version === r.document_version
      ) + 1
    }: ${
      esc(
        s.attachments.find((d) =>
          d.id === r.document_id && d.version === r.document_version
        )!.file_name,
      )
    }</p><p>Original document ${
      esc(r.document_id)
    } · Version ${r.document_version} · SHA-256 ${esc(r.content_sha256)}</p>${
      r.acknowledgments.length
        ? r.acknowledgments.map((a) =>
          `<p>Exact-version acknowledgment by ${esc(a.acknowledged_by)} · ${
            esc(a.acknowledged_at)
          } · Document version ${a.document_version}</p>`
        ).join("")
        : "<p>No exact-version acknowledgment recorded.</p>"
    }`;
  return `${
    s.lab_reports!.length
      ? `<article><h2>Selected laboratory report provenance</h2>${
        s.lab_reports!.map((r) =>
          `<section><h3>${esc(r.source.provider_label)} · ${
            esc(r.source.source_report_reference)
          }</h3><p>Account ${esc(r.source.account_reference)} · Environment ${
            esc(r.source.environment_label)
          } · Patient reference ${
            esc(r.source.source_patient_reference)
          } · Order reference ${
            esc(r.source.source_order_reference)
          }</p><p>Staff-entered laboratory source</p><p>Original source identity review ${
            esc(r.source_review_id)
          } · Latest source identity review ${
            esc(r.latest_source_review_id)
          }</p>${common(r)}</section>`
        ).join("")
      }</article>`
      : ""
  }${
    s.external_records!.length
      ? `<article><h2>Selected external medical originals</h2>${
        s.external_records!.map((r) =>
          `<section><h3>${esc(r.source.provider_label)} · Export ${
            esc(r.source.export_reference)
          }</h3><p>Source origin ${esc(r.source.source_origin)} · Site ${
            esc(r.source.source_site_uid)
          } · Animal reference ${
            esc(r.source.source_animal_id)
          }</p><p>Staff-reviewed manual export</p>${common(r)}</section>`
        ).join("")
      }</article>`
      : ""
  }${
    s.lab_reports!.length || s.external_records!.length
      ? "<aside><p>These are local source reviews and byte-verification records. The outside author is unknown unless recorded in the original document; the local reviewer is not the outside author. A captured digest does not establish provider authenticity. An exact-version acknowledgment is not the outside clinician’s signature or an endorsement of every finding.</p></aside>"
      : ""
  }`;
}
