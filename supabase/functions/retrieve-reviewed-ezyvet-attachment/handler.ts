import { readAttachmentBytes } from "../ezyvet-import/attachment-bytes.ts";
import { parseAttachmentMetadataPage } from "../ezyvet-import/attachment-metadata.ts";
import type { ChartOriginalContext, ChartOriginalDependencies } from "./types.ts";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hash = /^[a-f0-9]{64}$/;
class RetrievalError extends Error { readonly code: string; readonly status: number; constructor(code: string, status = 503) { super(code); this.code = code; this.status = status; } }
const fail = (): never => { throw new RetrievalError("CHART_ORIGINAL_UNAVAILABLE"); };
function object(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function exact(value: unknown, keys: string[]): asserts value is Record<string, unknown> { if (!object(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) fail(); }
function text(value: unknown): value is string { return typeof value === "string"; }
function identifier(value: unknown): boolean { return text(value) && uuid.test(value); }
function digest(value: unknown): boolean { return text(value) && hash.test(value); }
function positive(value: unknown): boolean { return typeof value === "number" && Number.isSafeInteger(value) && value >= 1; }
function timestamp(value: unknown): boolean { return text(value) && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)); }
async function context(value: unknown, recordId: string, petId: string): Promise<ChartOriginalContext> {
  exact(value, ["record", "original"]);
  const r = value.record, o = value.original;
  exact(r, ["id", "action_id", "approved_by", "approved_at", "pet_id", "client_id", "patient_version", "animal_link_id", "capture_id", "capture_request_id", "capture_hash", "request_hash", "record_hash", "source_origin", "source_site_uid", "source_animal_id", "source_attachment_id", "source_file_id", "snapshot_id", "observed_head_version", "stable_metadata_sha256", "raw_record_sha256", "metadata", "content_sha256", "mime_type", "file_size", "captured_at", "entry_method", "source_current_at_review", "previous_record_id", "version", "kind", "review_reason"]);
  exact(o, ["bucket_id", "object_path", "storage_object_id", "content_sha256", "mime_type", "file_size"]);
  if (r.id !== recordId || r.pet_id !== petId || ["id", "action_id", "approved_by", "pet_id", "client_id", "animal_link_id", "capture_id", "capture_request_id", "snapshot_id"].some(k => !identifier(r[k])) ||
    ["capture_hash", "request_hash", "record_hash", "stable_metadata_sha256", "raw_record_sha256", "content_sha256"].some(k => !digest(r[k])) ||
    !positive(r.patient_version) || !positive(r.observed_head_version) || !positive(r.version) || !positive(r.file_size) || Number(r.file_size) > 20971520 ||
    !timestamp(r.approved_at) || !timestamp(r.captured_at) || r.entry_method !== "staff_reviewed_ezyvet_api_attachment_v1" || typeof r.source_current_at_review !== "boolean" ||
    !text(r.source_origin) || !["https://api.trial.ezyvet.com", "https://api.ezyvet.com"].includes(r.source_origin) || !text(r.source_site_uid) || !r.source_site_uid || r.source_site_uid.length > 4096 ||
    !text(r.mime_type) || !["application/pdf", "image/jpeg", "image/png"].includes(r.mime_type) || !text(r.review_reason) || r.review_reason.trim() !== r.review_reason || r.review_reason.length < 1 || r.review_reason.length > 2000 ||
    (r.previous_record_id !== null && !identifier(r.previous_record_id)) || (r.kind !== "original" && r.kind !== "replacement") ||
    (r.kind === "original" ? r.previous_record_id !== null || r.version !== 1 : r.previous_record_id === null || Number(r.version) < 2)) fail();
  if (["source_animal_id", "source_attachment_id", "source_file_id"].some(k => !text(r[k]) || !/^(0|[1-9][0-9]{0,15})$/.test(r[k] as string))) fail();
  const parsed = await parseAttachmentMetadataPage({ items: [{ attachment: r.metadata }], meta: { items_page: 1, items_page_total: 1, items_page_size: 10, items_total: 1 } }, { animalId: r.source_animal_id as string, page: 1 });
  const observation = parsed.observations[0];
  if (observation.external_id !== r.source_attachment_id || observation.file_id !== r.source_file_id || observation.stable_metadata_sha256 !== r.stable_metadata_sha256 || !object(r.metadata) || Object.keys(r.metadata).some(k => !Object.hasOwn(observation.metadata, k))) fail();
  if (o.bucket_id !== "ezyvet-attachment-originals" || !identifier(o.storage_object_id) || o.content_sha256 !== r.content_sha256 || o.mime_type !== r.mime_type || o.file_size !== r.file_size || !text(o.object_path)) fail();
  const segments = (o.object_path as string).split("/");
  if (segments.length !== 5 || segments[0] !== r.approved_by || segments[1] !== petId || segments[2] !== r.capture_request_id || !identifier(segments[3]) || segments[4] !== "original") fail();
  return value as unknown as ChartOriginalContext;
}
function frozenIdentity(value: ChartOriginalContext): string {
  const canonical = (item: unknown): unknown => Array.isArray(item) ? item.map(canonical) : object(item) ? Object.fromEntries(Object.keys(item).sort().map(k => [k, canonical(item[k])])) : item;
  return JSON.stringify(canonical(value));
}
export function createHandler(dependencies: ChartOriginalDependencies) {
  return async (request: Request): Promise<Response> => {
    let origin: string;
    try { origin = new URL(dependencies.env("APP_URL") || "").origin; } catch { return new Response(null, { status: 503 }); }
    const headers = { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", Vary: "Origin" };
    const respond = (error: string, status: number) => new Response(JSON.stringify({ error }), { status, headers: { ...headers, "Content-Type": "application/json" } });
    if (request.headers.get("Origin") && request.headers.get("Origin") !== origin) return respond("ORIGIN_DENIED", 403);
    if (request.method === "OPTIONS") return new Response(null, { headers });
    if (request.method !== "POST") return respond("METHOD_NOT_ALLOWED", 405);
    const auth = request.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) return respond("UNAUTHORIZED", 401);
    const bearer = auth.slice(7);
    try {
      const user = await dependencies.gateway.authenticate(bearer);
      if (!user) return respond("UNAUTHORIZED", 401);
      if (user.activeDvm !== true) return respond("ACTIVE_DVM_REQUIRED", 403);
      const reader = request.body?.getReader(); if (!reader) return respond("INVALID_REQUEST", 400);
      const buffer = new Uint8Array(1024); let size = 0;
      try { while (true) { const chunk = await reader.read(); if (chunk.done) break; if (size + chunk.value.byteLength > buffer.length) { void reader.cancel().catch(() => {}); return respond("INVALID_REQUEST", 400); } buffer.set(chunk.value, size); size += chunk.value.byteLength; } } finally { reader.releaseLock(); }
      let body: unknown;
      try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, size))); } catch { return respond("INVALID_REQUEST", 400); }
      if (!object(body) || Object.keys(body).length !== 2 || !identifier(body.record_id) || !identifier(body.pet_id)) return respond("INVALID_REQUEST", 400);
      const recordId = body.record_id as string, petId = body.pet_id as string;
      const initial = await context(await dependencies.gateway.context(recordId, petId, user.id), recordId, petId);
      const response = await dependencies.gateway.readOriginal(initial.original);
      const file = await readAttachmentBytes(response, initial.original.mime_type, AbortSignal.timeout(20_000));
      if (file.sha256 !== initial.original.content_sha256 || file.size !== initial.original.file_size || file.mimeType !== initial.original.mime_type) throw new RetrievalError("CHART_ORIGINAL_BYTES_CHANGED", 409);
      const currentUser = await dependencies.gateway.authenticate(bearer);
      if (!currentUser || currentUser.id !== user.id || currentUser.activeDvm !== true) return respond("ACTIVE_DVM_REQUIRED", 403);
      const current = await context(await dependencies.gateway.context(recordId, petId, user.id), recordId, petId);
      if (frozenIdentity(initial) !== frozenIdentity(current)) fail();
      const extension = file.mimeType === "application/pdf" ? "pdf" : file.mimeType === "image/png" ? "png" : "jpg";
      return new Response(file.bytes, { headers: { ...headers, "Content-Type": file.mimeType, "Content-Length": String(file.size), "Content-Disposition": `attachment; filename="ezyvet-chart-original-${recordId}.${extension}"` } });
    } catch (error) {
      if (error instanceof RetrievalError) return respond(error.code, error.status);
      if (error && typeof error === "object" && "code" in error && error.code === "42501") return respond("CHART_ORIGINAL_ACCESS_DENIED", 403);
      return respond("CHART_ORIGINAL_UNAVAILABLE", 503);
    }
  };
}
