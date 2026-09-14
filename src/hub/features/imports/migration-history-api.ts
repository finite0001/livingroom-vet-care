import { z } from "zod";
import { parseMigrationBinding } from "./migration-run-api.ts";
import type { MigrationBinding, MigrationRpc } from "./migration-run-api.ts";
import type { MigrationItem } from "./migration-items-api.ts";
const uuid = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
const date = z.string().datetime({ offset: true });
const version = z.number().int().positive().max(2147483647);
const count = z.number().int().nonnegative().safe();
const pageSchema = z.object({ version: z.literal(1), binding_id: uuid, scope_id: uuid, child_run_id: uuid, actor_id: uuid,
  page: z.number().int().min(1).max(1000), snapshot_id: uuid, evidence_hash: hash, visibility: z.literal("approved_patient_history"),
  approvals: z.array(z.object({ id: uuid, version, version_hash: hash, approved_at: date,
    relationship: z.enum(["exact_source_version", "different_source_version"]), source_current: z.boolean(), superseded: z.boolean(),
    consult_status: z.enum(["verified", "not_referenced", "unresolved"]), extraction_receipts: count, locally_edited_receipts: count }).strict()).max(100),
  has_more: z.boolean(), next_before_version: version.nullable(), discrepancies_assessed: z.literal(false), complete_coverage_verified: z.literal(false), observed_at: date,
}).strict();
export interface MigrationHistoryPage extends z.infer<typeof pageSchema> {}
export function createMigrationHistoryApi(client: MigrationRpc, actor: string) {
  uuid.parse(actor);
  return {
    async list(binding: MigrationBinding, item: MigrationItem, before: number | null = null, limit = 20): Promise<MigrationHistoryPage> {
      const owned = parseMigrationBinding(binding, actor, binding.scope_id);
      if (owned.child_context.resource !== "history" || item.ordinal !== 0) throw new Error("History observation required");
      const identity = pageSchema.pick({ page: true, snapshot_id: true, evidence_hash: true }).parse({ page: item.page, snapshot_id: item.snapshot_id, evidence_hash: item.evidence_hash });
      if (before !== null) version.parse(before);
      z.number().int().min(1).max(100).parse(limit);
      const { data, error } = await client.rpc("list_ezyvet_migration_history_evidence", { p_binding_id: owned.id, p_page: identity.page,
        p_snapshot_id: identity.snapshot_id, p_evidence_hash: identity.evidence_hash, p_before_version: before, p_limit: limit });
      if (error) throw error;
      const result = pageSchema.parse(data);
      if (result.actor_id !== actor || result.binding_id !== owned.id || result.scope_id !== owned.scope_id || result.child_run_id !== owned.child_run_id ||
        result.page !== identity.page || result.snapshot_id !== identity.snapshot_id || result.evidence_hash !== identity.evidence_hash) throw new Error("History evidence identity differs");
      if (result.approvals.length > limit || (result.has_more && result.approvals.length !== limit)) throw new Error("History evidence page size differs");
      let previous = before;
      const ids = new Set<string>();
      for (const row of result.approvals) {
        if (ids.has(row.id) || (previous !== null && row.version >= previous)) throw new Error("History evidence order differs");
        if (row.locally_edited_receipts > row.extraction_receipts) throw new Error("History evidence counts differ");
        ids.add(row.id); previous = row.version;
      }
      if (result.next_before_version !== (result.has_more ? previous : null)) throw new Error("History evidence continuation differs");
      return result;
    },
  };
}
