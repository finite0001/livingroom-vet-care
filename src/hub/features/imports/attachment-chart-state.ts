import { z } from "zod";
import {
  recordSchema,
  cursorSchema,
  precedes,
} from "./attachment-review-history.ts";
import type { ReviewCursor } from "./attachment-review-history.ts";
const pageSchema = z
  .object({
    pet_id: z.string().uuid(),
    records: z
      .array(
        z
          .object({
            record: recordSchema,
            is_latest: z.boolean(),
            source_current: z.boolean(),
          })
          .strict(),
      )
      .max(20),
    has_more: z.boolean(),
    next_cursor: cursorSchema.nullable(),
  })
  .strict();
export function parseAttachmentChart(
  value: unknown,
  pet: string,
  cursor: ReviewCursor | null,
) {
  const page = pageSchema.parse(value);
  if (page.pet_id !== pet) throw new Error("Chart patient differs");
  const ids = new Set<string>();
  const latest = new Set<string>();
  for (let index = 0; index < page.records.length; index++) {
    const { record: r, is_latest } = page.records[index];
    const previous = page.records[index - 1]?.record;
    const chain = `${r.animal_link_id}:${r.attachment_external_id}`;
    if (
      r.pet_id !== pet ||
      ids.has(r.id) ||
      r.previous_record_id === r.id ||
      (r.version === 1) !== (r.previous_record_id === null) ||
      (cursor &&
        !precedes(r.created_at, r.id, cursor.before_at, cursor.before_id)) ||
      (previous &&
        !precedes(r.created_at, r.id, previous.created_at, previous.id)) ||
      (is_latest && latest.has(chain))
    )
      throw new Error("Chart record identity or order differs");
    ids.add(r.id);
    if (is_latest) latest.add(chain);
    for (const other of page.records) {
      if (
        other.record.animal_link_id !== r.animal_link_id ||
        other.record.attachment_external_id !== r.attachment_external_id ||
        other.record.id === r.id
      )
        continue;
      if (
        other.record.version === r.version ||
        (is_latest && other.record.version > r.version) ||
        (r.previous_record_id === other.record.id &&
          other.record.version !== r.version - 1)
      )
        throw new Error("Chart review lineage differs");
    }
  }
  const last = page.records[page.records.length - 1]?.record;
  if (
    page.has_more !== !!page.next_cursor ||
    (page.next_cursor &&
      (!last ||
        page.next_cursor.before_id !== last.id ||
        page.next_cursor.before_at !== last.created_at))
  )
    throw new Error("Chart cursor differs");
  return page;
}
