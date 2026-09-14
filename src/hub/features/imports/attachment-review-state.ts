import { z } from "zod";
import { attachmentParentSchema } from "./attachment-discovery-state.ts";
import type { AttachmentFileIntent } from "./attachment-file-state.ts";
const uuid = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), date = z.string().refine(v => Number.isFinite(Date.parse(v)));
const source = z.object({ schema_version: z.literal(1), run_id: uuid, page: z.number().int().positive(), parent: attachmentParentSchema, attachment_snapshot_id: uuid, attachment_external_id: z.string(), attachment_payload_hash: hash, attachment_observed_head_version: z.number().int().positive() }).strict();
const record = z.object({ id: uuid, actor_id: uuid, request_id: uuid, pet_id: uuid, animal_link_id: uuid, source_origin: z.string().url(), source_site_uid: z.string(), attachment_external_id: z.string(), request_hash: hash, capture_hash: hash, source_context: source, title: z.string().min(1).max(200), review_reason: z.string().min(1).max(2000), previous_record_id: uuid.nullable(), version: z.number().int().positive(), entry_method: z.literal("staff_reviewed_api_attachment_v1"), record_hash: hash, created_at: date }).strict();
const cursor = z.object({ before_at: date, before_id: uuid }).strict();
const pageSchema = z.object({ request_id: uuid, pet_id: uuid, animal_link_id: uuid, attachment_external_id: z.string(), latest_record_id: uuid.nullable(), records: z.array(record).max(20), has_more: z.boolean(), next_cursor: cursor.nullable() }).strict();
export interface AttachmentReviewCursor { before_at: string; before_id: string; }
export function parseAttachmentReviewHistory(value: unknown, expected: Pick<AttachmentFileIntent, "id" | "pet" | "parent" | "externalId">) {
  const page = pageSchema.parse(value), ids = new Set<string>(), versions = new Set<number>();
  if (page.request_id !== expected.id || page.pet_id !== expected.pet || page.animal_link_id !== expected.parent.animal_link_id || page.attachment_external_id !== expected.externalId) throw new Error("Approval history belongs to another source.");
  for (const r of page.records) {
    const c = r.source_context;
    if (ids.has(r.id) || versions.has(r.version) || r.pet_id !== expected.pet || r.animal_link_id !== expected.parent.animal_link_id || r.source_origin !== expected.parent.source_origin || r.source_site_uid !== expected.parent.source_site_uid || r.attachment_external_id !== expected.externalId || c.parent.pet_id !== r.pet_id || c.parent.animal_link_id !== r.animal_link_id || c.parent.source_origin !== r.source_origin || c.parent.source_site_uid !== r.source_site_uid || c.attachment_external_id !== r.attachment_external_id || (r.version === 1) !== (r.previous_record_id === null) || r.previous_record_id === r.id) throw new Error("Approval history identity or lineage differs.");
    ids.add(r.id!); versions.add(r.version!);
  }
  for (const r of page.records) {
    const prior = page.records.find(p => p.id === r.previous_record_id);
    if (prior && prior.version !== r.version - 1) throw new Error("Approval predecessor version differs.");
  }
  if ((page.records.length > 0 && !page.latest_record_id) || page.has_more !== (page.next_cursor !== null)) throw new Error("Approval history summary differs.");
  if (page.next_cursor) { const last = page.records.at(-1); if (!last || last.id !== page.next_cursor.before_id || last.created_at !== page.next_cursor.before_at) throw new Error("Approval cursor differs."); }
  return { ...page, next_cursor: page.next_cursor ? { before_at: page.next_cursor.before_at!, before_id: page.next_cursor.before_id! } : null };
}
