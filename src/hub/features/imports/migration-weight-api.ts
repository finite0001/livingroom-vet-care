import { z } from "zod";
import { parseMigrationBinding } from "./migration-run-api.ts";
import type { MigrationBinding, MigrationCursor, MigrationRpc } from "./migration-run-api.ts";
import type { MigrationItem } from "./migration-items-api.ts";
import { precedes } from "./attachment-review-history.ts";
const uuid = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
const date = z.string().datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)) && !/\.\d{7}/.test(value));
const cursorSchema = z.object({ before_at: date, before_id: uuid }).strict();
const sourceFields = { snapshot_id: uuid, head_version: z.number().int().positive(), relationship: z.enum(["exact_snapshot", "different_snapshot"]), source_current: z.boolean() };
const pageSchema = z.object({ version: z.literal(1), binding_id: uuid, scope_id: uuid, child_run_id: uuid, actor_id: uuid,
  page: z.number().int().min(1).max(1000), snapshot_id: uuid, evidence_hash: hash, visibility: z.literal("approved_patient_weight"),
  observation_head_version: z.null(), historical_head_fidelity: z.literal("unknown"),
  approval: z.object({ id: uuid, weight_id: uuid, action: z.enum(["create", "link"]), approved_at: date, ...sourceFields, local_weight_matches: z.boolean(), household_current: z.boolean() }).strict().nullable(),
  reviews: z.array(z.object({ id: uuid, reviewed_at: date, ...sourceFields }).strict()).max(100), has_more: z.boolean(), next_cursor: cursorSchema.nullable(),
  complete_coverage_verified: z.literal(false), observed_at: date,
}).strict();
export interface MigrationWeightPage extends z.infer<typeof pageSchema> {}
export function createMigrationWeightApi(client: MigrationRpc, actor: string) {
  uuid.parse(actor);
  return {
    async list(binding: MigrationBinding, item: MigrationItem, cursor: MigrationCursor | null = null, limit = 20): Promise<MigrationWeightPage> {
      const owned = parseMigrationBinding(binding, actor, binding.scope_id);
      if (owned.child_context.resource !== "healthstatus" || item.ordinal !== 0 || item.observed_head_version !== null) throw new Error("Legacy weight observation required");
      const identity = pageSchema.pick({ page: true, snapshot_id: true, evidence_hash: true }).parse({ page: item.page, snapshot_id: item.snapshot_id, evidence_hash: item.evidence_hash });
      z.number().int().min(1).max(100).parse(limit); if (cursor) cursorSchema.parse(cursor);
      const { data, error } = await client.rpc("list_ezyvet_migration_weight_evidence", { p_binding_id: owned.id, p_page: identity.page, p_snapshot_id: identity.snapshot_id,
        p_evidence_hash: identity.evidence_hash, p_before_at: cursor?.before_at ?? null, p_before_id: cursor?.before_id ?? null, p_limit: limit });
      if (error) throw error;
      const result = pageSchema.parse(data);
      if (result.actor_id !== actor || result.binding_id !== owned.id || result.scope_id !== owned.scope_id || result.child_run_id !== owned.child_run_id ||
        result.page !== identity.page || result.snapshot_id !== identity.snapshot_id || result.evidence_hash !== identity.evidence_hash) throw new Error("Weight evidence identity differs");
      if (result.reviews.length > limit || (result.has_more && result.reviews.length !== limit) || (!result.approval && result.reviews.length > 0)) throw new Error("Weight evidence page differs");
      for (const row of [...(result.approval ? [result.approval] : []), ...result.reviews]) {
        if ((row.relationship === "exact_snapshot") !== (row.snapshot_id === item.snapshot_id)) throw new Error("Weight evidence relationship differs");
      }
      let previous = cursor;
      const ids = new Set<string>();
      for (const row of result.reviews) {
        if (ids.has(row.id) || (previous && !precedes(row.reviewed_at, row.id, previous.before_at, previous.before_id))) throw new Error("Weight evidence cursor differs");
        previous = { before_at: row.reviewed_at, before_id: row.id }; ids.add(row.id);
      }
      if ((result.has_more && (!result.next_cursor || result.next_cursor.before_at !== previous?.before_at || result.next_cursor.before_id !== previous?.before_id)) || (!result.has_more && result.next_cursor !== null)) throw new Error("Weight evidence continuation differs");
      return result;
    },
  };
}
