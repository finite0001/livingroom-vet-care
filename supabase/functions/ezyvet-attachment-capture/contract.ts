import { parsePage, type AttachmentParent, type EzyVetConfig } from "../ezyvet-import/adapter.ts";
import { ImportError } from "../ezyvet-import/import-error.ts";
import { maxAttachmentBytes } from "../ezyvet-import/attachment-bytes.ts";
export const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const hash = /^[a-f0-9]{64}$/;
const invalid = (): never => { throw new ImportError("CAPTURE_RESPONSE_INVALID"); };
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, pattern: RegExp): string { if (typeof value !== "string" || !pattern.test(value)) invalid(); return value as string; }
function integer(value: unknown, maximum = 2147483647): number { if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > maximum) invalid(); return value as number; }
function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, ordered(v)]));
  return value;
}
export const same = (a: unknown, b: unknown) => JSON.stringify(ordered(a)) === JSON.stringify(ordered(b));
export interface Identity { id: string; pet: string; actor: string; requestHash: string; }
export interface Source extends Record<string, unknown> {
  parent: AttachmentParent & Record<string, unknown>;
  attachment_external_id: string;
  attachment_metadata: Record<string, unknown>;
}
export interface Intent {
  request_id: string; actor_id: string; pet_id: string; request_hash: string; intent_hash: string;
  bucket: "ezyvet-attachments"; object_path: string; content_sha256: string; file_size: number; mime_type: string;
}
export interface Capture { request_id: string; capture_hash: string; content_sha256: string; }
export interface Recovery { status: "pending" | "captured" | "abandoned"; source: Source; intent: Intent | null; capture: Capture | null; }
export interface Lease { lease_id: string; lease_until: string; source: Source; intent: Intent | null; }
export function parseIntent(value: unknown, identity: Identity, source: Source): Intent {
  const i = object(value);
  if (i.request_id !== identity.id || i.actor_id !== identity.actor || i.pet_id !== identity.pet || i.request_hash !== identity.requestHash || i.bucket !== "ezyvet-attachments" ||
    !same(i.before_metadata, source.attachment_metadata) || !same(i.after_metadata, source.attachment_metadata)) invalid();
  const prefix = `${identity.actor}/${identity.pet}/${identity.id}/`;
  if (typeof i.object_path !== "string" || !i.object_path.startsWith(prefix) || !uuid.test(i.object_path.slice(prefix.length).split("/")[0]) || i.object_path.slice(prefix.length).split("/").length !== 2 || !i.object_path.endsWith("/original")) invalid();
  return { request_id: identity.id, actor_id: identity.actor, pet_id: identity.pet, request_hash: identity.requestHash, bucket: "ezyvet-attachments", object_path: i.object_path as string,
    intent_hash: text(i.intent_hash, hash), content_sha256: text(i.content_sha256, hash), file_size: integer(i.file_size, maxAttachmentBytes), mime_type: text(i.mime_type, /^(application\/pdf|image\/jpeg|image\/png)$/) };
}
export function parseCapture(value: unknown, identity: Identity, intent: Intent): Capture {
  const c = object(value);
  if (c.request_id !== identity.id || c.actor_id !== identity.actor || c.pet_id !== identity.pet || c.intent_hash !== intent.intent_hash || c.bucket !== intent.bucket || c.object_path !== intent.object_path ||
    c.content_sha256 !== intent.content_sha256 || c.file_size !== intent.file_size || c.mime_type !== intent.mime_type) invalid();
  text(c.storage_object_id, uuid);
  return { request_id: identity.id, capture_hash: text(c.capture_hash, hash), content_sha256: intent.content_sha256 };
}
export function parseRecovery(value: unknown, identity: Identity, config: EzyVetConfig): Recovery {
  const envelope = object(value), r = object(envelope.request);
  if (r.id !== identity.id || r.actor_id !== identity.actor || r.pet_id !== identity.pet || r.request_hash !== identity.requestHash || (typeof r.status !== "string" || !["pending", "captured", "abandoned"].includes(r.status))) invalid();
  const c = object(r.source_context), p = object(c.parent), selected = object(r.request_payload);
  if (c.schema_version !== 1 || p.pet_id !== identity.pet || p.source_origin !== config.baseUrl || p.source_site_uid !== config.siteUid || (typeof p.parent_type !== "string" || !["Animal", "Consult"].includes(p.parent_type))) invalid();
  text(p.animal_link_id, uuid); text(p.client_id, uuid); text(p.parent_snapshot_id, uuid); text(p.parent_payload_hash, hash); integer(p.parent_observed_head_version);
  text(c.run_id, uuid); text(c.attachment_snapshot_id, uuid); text(c.attachment_payload_hash, hash); integer(c.attachment_observed_head_version); integer(c.page, 1000);
  if (selected.run_id !== c.run_id || selected.page !== c.page || selected.snapshot_id !== c.attachment_snapshot_id || selected.payload_hash !== c.attachment_payload_hash || selected.observed_head_version !== c.attachment_observed_head_version) invalid();
  const metadata = object(c.attachment_metadata);
  const parsed = parsePage({ items: [{ attachment: metadata }], meta: { items_page: 1, items_page_total: 1 } }, "attachment", 1).items[0];
  if (parsed.external_id !== c.attachment_external_id || metadata.record_type !== p.parent_type || String(metadata.record_id) !== p.parent_external_id) invalid();
  const source = c as Source;
  const intent = envelope.capture_intent === null ? null : parseIntent(envelope.capture_intent, identity, source);
  const capture = envelope.capture === null ? null : intent ? parseCapture(envelope.capture, identity, intent) : invalid();
  if ((r.status === "captured") !== (capture !== null)) invalid();
  return { status: r.status as Recovery["status"], source, intent, capture };
}
export function parseLease(value: unknown, identity: Identity, expected: Source, now: number): Lease {
  const row = object(value);
  if (row.request_id !== identity.id || row.pet_id !== identity.pet || row.request_hash !== identity.requestHash || !same(row.source_context, expected)) invalid();
  text(row.lease_id, uuid);
  if (typeof row.lease_until !== "string" || !Number.isFinite(Date.parse(row.lease_until)) || Date.parse(row.lease_until) <= now + 2000) invalid();
  return { lease_id: row.lease_id as string, lease_until: row.lease_until as string, source: expected, intent: row.capture_intent === null ? null : parseIntent(row.capture_intent, identity, expected) };
}
