import { z } from "zod";
import { parseMigrationBinding } from "./migration-run-api.ts";
import type { MigrationBinding, MigrationRpc } from "./migration-run-api.ts";
import type { MigrationItem } from "./migration-items-api.ts";
const uuid = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
const date = z.string().datetime({ offset: true });
const schema = z.object({
  version: z.literal(1), binding_id: uuid, scope_id: uuid, child_run_id: uuid, actor_id: uuid,
  resource: z.enum(["contact", "animal"]), page: z.number().int().min(1).max(1000), snapshot_id: uuid, evidence_hash: hash,
  visibility: z.literal("approved_identity_mapping"), observation_head_available: z.literal(false),
  exact_source_version_verified: z.literal(false), complete_coverage_verified: z.literal(false),
  approval: z.object({ id: uuid, approved_at: date, action: z.enum(["create", "link"]),
    relationship: z.enum(["same_snapshot_unknown_observed_head", "different_snapshot"]),
    source_current: z.boolean(), local_record_unchanged: z.boolean(), household_current: z.boolean(),
  }).strict(), observed_at: date,
}).strict();
export interface MigrationIdentityEvidence extends z.infer<typeof schema> {}
export function createMigrationIdentityApi(client: MigrationRpc, actor: string) {
  uuid.parse(actor);
  return {
    async read(binding: MigrationBinding, item: MigrationItem): Promise<MigrationIdentityEvidence> {
      const owned = parseMigrationBinding(binding, actor, binding.scope_id);
      if (!["contact", "animal"].includes(owned.child_context.resource) || item.ordinal !== 0 || item.observed_head_version !== null) throw new Error("Legacy identity observation required");
      const identity = schema.pick({ page: true, snapshot_id: true, evidence_hash: true }).parse({ page: item.page, snapshot_id: item.snapshot_id, evidence_hash: item.evidence_hash });
      const { data, error } = await client.rpc("read_ezyvet_migration_identity_evidence", { p_binding_id: owned.id, p_page: identity.page, p_snapshot_id: identity.snapshot_id, p_evidence_hash: identity.evidence_hash });
      if (error) throw error;
      const result = schema.parse(data);
      if (result.actor_id !== actor || result.binding_id !== owned.id || result.scope_id !== owned.scope_id || result.child_run_id !== owned.child_run_id ||
        result.resource !== owned.child_context.resource || result.page !== identity.page || result.snapshot_id !== identity.snapshot_id || result.evidence_hash !== identity.evidence_hash) throw new Error("Identity evidence scope differs");
      return result;
    },
  };
}
