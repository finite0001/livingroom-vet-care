import { z } from "zod";
import type { OriginalCapture } from "./attachment-capture-state.ts";
const uuid = z.string().uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const date = z.string().datetime({ offset: true }).refine(value =>
  Number.isFinite(Date.parse(value)) && !/\.\d{7}/.test(value));
// PostgreSQL retains microseconds; Date.parse alone truncates to milliseconds.
function timestamp(value: string): bigint {
  const fraction = /\.(\d+)(?:Z|[+-]\d{2}:?\d{2})$/.exec(value)?.[1] ?? "";
  return BigInt(Date.parse(value)) * 1000n + BigInt(fraction.padEnd(6, "0").slice(3));
}
function precedes(at: string, id: string, beforeAt: string, beforeId: string) {
  const delta = timestamp(at) - timestamp(beforeAt);
  return delta < 0n || (delta === 0n && id < beforeId);
}
const recordSchema = z.object({
  id: uuid, actor_id: uuid, request_id: uuid, pet_id: uuid, animal_link_id: uuid,
  source_origin: z.string().url(), source_site_uid: z.string(), attachment_external_id: z.string(),
  request_hash: hash, capture_hash: hash, title: z.string().min(1).max(200),
  review_reason: z.string().min(1).max(2000), previous_record_id: uuid.nullable(),
  version: z.number().int().positive(), entry_method: z.literal("staff_reviewed_api_attachment_v2"),
  record_hash: hash, created_at: date,
}).strict();
const cursorSchema = z.object({ before_at: date, before_id: uuid }).strict();
export interface ReviewCursor extends z.infer<typeof cursorSchema> {}
export interface OriginalReviewRecord extends z.infer<typeof recordSchema> {}
const pageSchema = z.object({
  request_id: uuid, pet_id: uuid, animal_link_id: uuid, attachment_external_id: z.string(),
  latest_record_id: uuid.nullable(), records: z.array(recordSchema).max(20),
  has_more: z.boolean(), next_cursor: cursorSchema.nullable(),
}).strict();
export function parseReviewHistory(value: unknown, capture: OriginalCapture, cursor: ReviewCursor | null) {
  const page = pageSchema.parse(value);
  if (capture.status !== "ready" || page.request_id !== capture.id || page.pet_id !== capture.pet_id ||
      page.animal_link_id !== capture.animal_link_id || page.attachment_external_id !== capture.external_id)
    throw new Error("Review history scope differs");
  const ids = new Set<string>();
  for (let index = 0; index < page.records.length; index++) {
    const record = page.records[index];
    if (ids.has(record.id) || record.pet_id !== capture.pet_id || record.animal_link_id !== capture.animal_link_id ||
        record.attachment_external_id !== capture.external_id || record.source_origin !== capture.parent_context.source_origin ||
        record.source_site_uid !== capture.parent_context.source_site_uid ||
        (record.request_id === capture.id && (record.capture_hash !== capture.capture?.capture_hash || record.request_hash !== capture.request_hash)) ||
        (index > 0 && record.version >= page.records[index - 1].version) ||
        (index > 0 && !precedes(record.created_at, record.id, page.records[index - 1].created_at, page.records[index - 1].id)) ||
        (cursor && !precedes(record.created_at, record.id, cursor.before_at, cursor.before_id)))
      throw new Error("Review record identity differs");
    ids.add(record.id);
  }
  const last = page.records[page.records.length - 1];
  if (page.has_more !== Boolean(page.next_cursor) || (page.has_more && (!last || page.next_cursor?.before_id !== last.id || page.next_cursor.before_at !== last.created_at)) ||
      (!cursor && page.latest_record_id !== (page.records[0]?.id ?? null)))
    throw new Error("Review history cursor differs");
  return page;
}
