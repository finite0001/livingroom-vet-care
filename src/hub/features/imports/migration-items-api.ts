import { z } from "zod";
import type { MigrationBinding, MigrationManifest } from "./migration-run-api.ts";

const uuid = z.string().uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const revision = z.number().int().positive();
export const migrationItemCursorSchema = z.object({ page: z.number().int().min(1).max(1000), ordinal: z.number().int().min(0).max(10), snapshot_id: uuid }).strict();
const itemSchema = migrationItemCursorSchema.extend({
  observed_head_version: revision.nullable(), external_id: z.string().min(1).max(128), payload_hash: hash,
  file_id: z.string().min(1).max(128).nullable(), raw_record_sha256: hash.nullable(), stable_metadata_sha256: hash.nullable(), evidence_hash: hash,
  current_snapshot_id: uuid.nullable(), current_head_version: revision.nullable(), payload_current: z.boolean(), exact_source_current: z.boolean().nullable(),
}).strict();
const pageSchema = z.object({
  version: z.literal(1), binding_id: uuid, scope_id: uuid, migration_run_id: uuid, child_run_id: uuid, context_hash: hash,
  resource: z.enum(["contact", "animal", "healthstatus", "consult", "history", "vaccination", "prescription", "prescriptionitem", "attachment"]),
  superseded: z.boolean(), mapping_matches_manifest: z.boolean(), mapping_source_current: z.boolean(), parent_current: z.boolean(), household_current: z.boolean(),
  occurrence_fidelity: z.enum(["page_ordinal", "deduplicated_page_snapshot"]), review_reconciled: z.literal(false), complete_coverage_verified: z.literal(false),
  observed_at: z.string().datetime({ offset: true }), items: z.array(itemSchema).max(100), has_more: z.boolean(), next_cursor: migrationItemCursorSchema.nullable(),
}).strict();
export interface MigrationItemCursor extends z.infer<typeof migrationItemCursorSchema> {}
export interface MigrationItem extends z.infer<typeof itemSchema> {}
export interface MigrationItemPage extends z.infer<typeof pageSchema> {}

function follows(left: MigrationItemCursor, right: MigrationItemCursor) {
  return left.page > right.page || (left.page === right.page && (left.ordinal > right.ordinal ||
    (left.ordinal === right.ordinal && left.snapshot_id.toLowerCase() > right.snapshot_id.toLowerCase())));
}
export function parseMigrationItems(value: unknown, manifest: MigrationManifest, binding: MigrationBinding, cursor: MigrationItemCursor | null, limit: number): MigrationItemPage {
  const result = pageSchema.parse(value), scope = manifest.scopes.find(row => row.id === binding.scope_id);
  if (!scope || result.binding_id !== binding.id || result.scope_id !== scope.id || result.migration_run_id !== manifest.run.id ||
    result.child_run_id !== binding.child_run_id || result.context_hash !== binding.context_hash || result.resource !== scope.resource ||
    result.resource !== binding.child_context.resource || binding.child_context.source_origin !== manifest.run.source_origin || binding.child_context.source_site_uid !== manifest.run.source_site_uid)
    throw new Error("Migration item scope differs");
  const attachment = result.resource === "attachment", headAvailable = !["contact", "animal", "healthstatus"].includes(result.resource);
  if (result.items.length > limit || (result.has_more && result.items.length !== limit) || result.occurrence_fidelity !== (attachment ? "page_ordinal" : "deduplicated_page_snapshot"))
    throw new Error("Migration item page differs");
  let previous = cursor;
  for (const item of result.items) {
    if (previous && !follows(item, previous)) throw new Error("Migration item cursor differs");
    if ((attachment ? item.ordinal < 1 : item.ordinal !== 0) || (item.observed_head_version !== null) !== headAvailable ||
      (item.current_snapshot_id === null) !== (item.current_head_version === null) ||
      (attachment ? [item.file_id, item.raw_record_sha256, item.stable_metadata_sha256].some(field => field === null) : [item.file_id, item.raw_record_sha256, item.stable_metadata_sha256].some(field => field !== null)) ||
      item.payload_current !== (item.current_snapshot_id === item.snapshot_id) ||
      item.exact_source_current !== (headAvailable ? item.payload_current && item.observed_head_version === item.current_head_version : null))
      throw new Error("Migration item evidence differs");
    previous = item;
  }
  const last = result.items.at(-1);
  const expected = result.has_more && last ? { page: last.page, ordinal: last.ordinal, snapshot_id: last.snapshot_id } : null;
  if ((expected === null) !== (result.next_cursor === null) || (expected && Object.keys(expected).some(key => expected[key as keyof MigrationItemCursor] !== result.next_cursor[key as keyof MigrationItemCursor])))
    throw new Error("Migration item continuation differs");
  return result;
}
