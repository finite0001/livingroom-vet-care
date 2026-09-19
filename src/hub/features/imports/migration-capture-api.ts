import { z } from "zod";
import { parseMigrationBinding } from "./migration-run-api.ts";
import type { MigrationBinding, MigrationCursor, MigrationRpc } from "./migration-run-api.ts";
import type { MigrationItem } from "./migration-items-api.ts";
import { precedes } from "./attachment-review-history.ts";
const uuid = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
const date = z.string().datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)) && !/\.\d{7}/.test(value));
const count = z.number().int().nonnegative().safe();
const cursorSchema = z.object({ before_at: date, before_id: uuid }).strict();
const captureSchema = z.object({ request_id: uuid, created_at: date, status: z.enum(["prepared", "reserved", "ready", "blocked", "discarding", "abandoned"]),
  relationship: z.enum(["exact_occurrence", "same_source_version"]), source_current: z.boolean(), retry_after: date.nullable(), latest_error_code: z.string().regex(/^[A-Z_]{1,64}$/).nullable(),
  capture: z.object({ id: uuid, capture_hash: hash, content_sha256: hash, mime_type: z.enum(["application/pdf", "image/jpeg", "image/png"]), file_size: z.number().int().min(1).max(20971520), captured_at: date }).strict().nullable(),
  approved_versions: count, canceled_unconfirmed_decisions: count,
  latest_approval: z.object({ id: uuid, version: z.number().int().positive(), record_hash: hash, created_at: date, superseded: z.boolean() }).strict().nullable(),
}).strict();
const pageSchema = z.object({ version: z.literal(1), binding_id: uuid, scope_id: uuid, child_run_id: uuid, actor_id: uuid,
  page: z.number().int().min(1).max(1000), ordinal: z.number().int().min(1).max(10), snapshot_id: uuid, evidence_hash: hash, ownership: z.literal("current_actor_only"),
  captures: z.array(captureSchema).max(100), has_more: z.boolean(), next_cursor: cursorSchema.nullable(), original_bytes_reverified: z.literal(false), complete_coverage_verified: z.literal(false), observed_at: date,
}).strict();
export interface MigrationCapturePage extends z.infer<typeof pageSchema> {}
export function createMigrationCaptureApi(client: MigrationRpc, actor: string) {
  uuid.parse(actor);
  return {
    async list(binding: MigrationBinding, item: MigrationItem, cursor: MigrationCursor | null = null, limit = 20): Promise<MigrationCapturePage> {
      const owned = parseMigrationBinding(binding, actor, binding.scope_id);
      if (owned.child_context.resource !== "attachment") throw new Error("Attachment binding required");
      const identity = pageSchema.pick({ page: true, ordinal: true, snapshot_id: true, evidence_hash: true }).parse({ page: item.page, ordinal: item.ordinal, snapshot_id: item.snapshot_id, evidence_hash: item.evidence_hash });
      z.number().int().min(1).max(100).parse(limit); if (cursor) cursorSchema.parse(cursor);
      const { data, error } = await client.rpc("list_ezyvet_migration_capture_evidence", { p_binding_id: owned.id, p_page: identity.page, p_ordinal: identity.ordinal,
        p_snapshot_id: identity.snapshot_id, p_evidence_hash: identity.evidence_hash, p_before_at: cursor?.before_at ?? null, p_before_id: cursor?.before_id ?? null, p_limit: limit });
      if (error) throw error;
      const result = pageSchema.parse(data);
      if (result.actor_id !== actor || result.binding_id !== owned.id || result.scope_id !== owned.scope_id || result.child_run_id !== owned.child_run_id ||
        result.page !== identity.page || result.ordinal !== identity.ordinal || result.snapshot_id !== identity.snapshot_id || result.evidence_hash !== identity.evidence_hash)
        throw new Error("Capture evidence identity differs");
      if (result.captures.length > limit || (result.has_more && result.captures.length !== limit)) throw new Error("Capture evidence page size differs");
      let previous = cursor;
      const ids = new Set<string>();
      for (const row of result.captures) {
        if (ids.has(row.request_id) || (previous && !precedes(row.created_at, row.request_id, previous.before_at, previous.before_id))) throw new Error("Capture evidence cursor differs");
        if ((row.status === "ready") !== (row.capture !== null) || (row.approved_versions > 0) !== (row.latest_approval !== null) ||
          (!row.capture && (row.approved_versions > 0 || row.canceled_unconfirmed_decisions > 0)) || (row.latest_approval && row.latest_approval.version < row.approved_versions))
          throw new Error("Capture evidence state differs");
        previous = { before_at: row.created_at, before_id: row.request_id }; ids.add(row.request_id);
      }
      if ((result.has_more && (!result.next_cursor || result.next_cursor.before_at !== previous?.before_at || result.next_cursor.before_id !== previous?.before_id)) || (!result.has_more && result.next_cursor !== null)) throw new Error("Capture evidence continuation differs");
      return result;
    },
  };
}
