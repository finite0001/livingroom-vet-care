export interface ReleaseApiOriginalRecord {
  id: string; action_id: string; approved_by: string; approved_at: string; pet_id: string; client_id: string; patient_version: number;
  animal_link_id: string; capture_id: string; capture_request_id: string; capture_hash: string; request_hash: string;
  record_hash: string; source_origin: string; source_site_uid: string; source_animal_id: string; source_attachment_id: string;
  source_file_id: string; snapshot_id: string; observed_head_version: number; stable_metadata_sha256: string; raw_record_sha256: string;
  metadata: { id: string; file_id: string; record_type: "Animal"; record_id: string; active?: string | number | boolean | null; primary_image?: string | number | boolean | null; created_at?: string | number | null; modified_at?: string | number | null; mime_type?: string | null; name?: string | null; notes?: string | null }; content_sha256: string; mime_type: string; file_size: number; captured_at: string;
  entry_method: "staff_reviewed_ezyvet_api_attachment_v1"; source_current_at_review: boolean; previous_record_id: string | null;
  version: number; kind: "original" | "replacement"; review_reason: string;
}

import type { ReleaseSnapshot } from "./record-release-renderer.ts";
export interface ReleaseApiOriginalAcknowledgment {
  id: string; action_id: string; record_id: string; pet_id: string; actor_id: string;
  record_hash: string; capture_hash: string; created_at: string;
}
export interface ReleaseApiOriginal { record: ReleaseApiOriginalRecord; acknowledgment: ReleaseApiOriginalAcknowledgment }
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const positive = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const date = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v));
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const fail = (): never => { throw new Error("Reviewed API original provenance is incomplete or differs."); };
function exact(v: unknown, keys: string[]): asserts v is Record<string, unknown> {
  if (!object(v) || Object.keys(v).length !== keys.length || keys.some(k => !Object.prototype.hasOwnProperty.call(v, k))) fail();
}
export function validateReleaseApiOriginals(s: ReleaseSnapshot): void {
  if (s.schema_version !== 9) {
    if (s.api_originals !== undefined || s.selection?.api_original_ids !== undefined) fail();
    return;
  }
  const ids = s.selection?.api_original_ids;
  if (!Array.isArray(ids) || ids.length > 20 || ids.some(id => !uuid(id)) || new Set(ids).size !== ids.length || !Array.isArray(s.api_originals) || s.api_originals.length !== ids.length) fail();
  const seen = new Set<string>();
  for (const entry of s.api_originals!) {
    exact(entry, ["record", "acknowledgment"]);
    const r = entry.record, a = entry.acknowledgment;
    exact(r, ["id", "action_id", "approved_by", "approved_at", "pet_id", "client_id", "patient_version", "animal_link_id", "capture_id", "capture_request_id", "capture_hash", "request_hash", "record_hash", "source_origin", "source_site_uid", "source_animal_id", "source_attachment_id", "source_file_id", "snapshot_id", "observed_head_version", "stable_metadata_sha256", "raw_record_sha256", "metadata", "content_sha256", "mime_type", "file_size", "captured_at", "entry_method", "source_current_at_review", "previous_record_id", "version", "kind", "review_reason"]);
    exact(a, ["id", "action_id", "record_id", "pet_id", "actor_id", "record_hash", "capture_hash", "created_at"]);
    if (["id", "action_id", "approved_by", "pet_id", "client_id", "animal_link_id", "capture_id", "capture_request_id", "snapshot_id"].some(k => !uuid(r[k])) ||
      ["capture_hash", "request_hash", "record_hash", "stable_metadata_sha256", "raw_record_sha256", "content_sha256"].some(k => !hash(r[k])) ||
      !ids!.includes(r.id as string) || seen.has(r.id as string) || r.pet_id !== s.patient.id || r.client_id !== s.recipient.client_id ||
      !positive(r.patient_version) || !positive(r.observed_head_version) || !positive(r.version) || !positive(r.file_size) || Number(r.file_size) > 20971520 ||
      !date(r.approved_at) || !date(r.captured_at) || r.entry_method !== "staff_reviewed_ezyvet_api_attachment_v1" || typeof r.source_current_at_review !== "boolean" ||
      !["https://api.ezyvet.com", "https://api.trial.ezyvet.com"].includes(String(r.source_origin)) || typeof r.source_site_uid !== "string" || !r.source_site_uid || r.source_site_uid.length > 4096 ||
      !["application/pdf", "image/jpeg", "image/png"].includes(String(r.mime_type)) || typeof r.review_reason !== "string" || !r.review_reason.trim() || r.review_reason.trim() !== r.review_reason || r.review_reason.length > 2000 ||
      (r.kind === "original" ? r.version !== 1 || r.previous_record_id !== null : r.kind !== "replacement" || !uuid(r.previous_record_id) || Number(r.version) < 2) ||
      ["source_animal_id", "source_attachment_id", "source_file_id"].some(k => typeof r[k] !== "string" || !/^(0|[1-9][0-9]*)$/.test(r[k] as string) || !Number.isSafeInteger(Number(r[k]))) ||
      ["id", "action_id", "record_id", "pet_id", "actor_id"].some(k => !uuid(a[k])) || !date(a.created_at) || a.record_id !== r.id || a.pet_id !== r.pet_id || a.record_hash !== r.record_hash || a.capture_hash !== r.capture_hash) fail();
    const m = r.metadata;
    if (!object(m) || m.id !== r.source_attachment_id || m.file_id !== r.source_file_id || m.record_type !== "Animal" || m.record_id !== r.source_animal_id || Object.keys(m).some(k => !["id", "file_id", "record_type", "record_id", "active", "primary_image", "created_at", "modified_at", "mime_type", "name", "notes"].includes(k))) fail();
    for (const [k, v] of Object.entries(m)) {
      if (v !== null && typeof v !== "string" && typeof v !== "boolean" && !(typeof v === "number" && Number.isFinite(v))) fail();
      if (typeof v === "string" && v.length > (k === "notes" ? 16384 : 1024)) fail();
      if (["mime_type", "name", "notes"].includes(k) && v !== null && typeof v !== "string") fail();
      if (["created_at", "modified_at"].includes(k) && typeof v === "boolean") fail();
    }
    seen.add(r.id as string);
  }
}
const esc = (v: unknown) => String(v ?? "Not recorded").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export function renderReleaseApiOriginals(s: ReleaseSnapshot): string {
  validateReleaseApiOriginals(s);
  if (s.schema_version !== 9 || !s.api_originals?.length) return "";
  return `<article><h2>Reviewed ezyVet API originals</h2><p>These original files were imported from ezyVet, admitted after provenance review, and separately acknowledged by a veterinarian. Original bytes are delivered unchanged as separate files after verification. Historical provider observations do not assert current provider contents. They were the latest nonwithdrawn chart versions when this package was reviewed; later changes can invalidate delivery.</p>${s.api_originals.map(({record:r, acknowledgment:a}) => `<section><h3>${esc(r.metadata.name || "ezyVet attachment " + r.source_attachment_id)} · chart version ${esc(r.version)}</h3><p>Source: ${esc(r.source_origin)} · site ${esc(r.source_site_uid)} · animal ${esc(r.source_animal_id)} · attachment ${esc(r.source_attachment_id)} · file ${esc(r.source_file_id)}</p><p>Provenance admitted by ${esc(r.approved_by)} at ${esc(r.approved_at)}. ${esc(r.review_reason)}</p><p>${r.source_current_at_review ? "Provider observation current at admission." : "Historical provider observation at admission."} ${r.kind === "replacement" ? "Replaces chart record " + esc(r.previous_record_id) + "; previous evidence remains in the chart." : "Original chart admission."}</p><p>Veterinary acknowledgment by ${esc(a.actor_id)} at ${esc(a.created_at)} for this exact chart record and captured original. Acknowledgment ${esc(a.id)}.</p><p>Record ${esc(r.id)} · record SHA-256 ${esc(r.record_hash)} · capture ${esc(r.capture_id)} · capture SHA-256 ${esc(r.capture_hash)}</p><p>Captured at ${esc(r.captured_at)} · request ${esc(r.capture_request_id)} · source snapshot ${esc(r.snapshot_id)} · observation version ${esc(r.observed_head_version)}</p><p>Stable metadata SHA-256 ${esc(r.stable_metadata_sha256)} · observed raw metadata SHA-256 ${esc(r.raw_record_sha256)}</p>${r.metadata.notes ? `<p>Source attachment notes: ${esc(r.metadata.notes)}</p>` : ""}<p>Unchanged original: ${esc(r.mime_type)} · ${esc(r.file_size)} bytes · byte SHA-256 ${esc(r.content_sha256)}</p></section>`).join("")}</article>`;
}
