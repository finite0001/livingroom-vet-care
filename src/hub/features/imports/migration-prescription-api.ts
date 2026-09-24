import { z } from "zod";
import { parseMigrationBinding } from "./migration-run-api.ts";
import type { MigrationBinding, MigrationRpc } from "./migration-run-api.ts";
import type { MigrationItem } from "./migration-items-api.ts";
const uuid = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
const date = z.string().datetime({ offset: true });
const version = z.number().int().positive().max(2147483647);
const pageSchema = z.object({ version: z.literal(1), binding_id: uuid, scope_id: uuid, child_run_id: uuid, actor_id: uuid,
  page: z.number().int().min(1).max(1000), snapshot_id: uuid, evidence_hash: hash, visibility: z.literal("approved_patient_prescription"),
  approvals: z.array(z.object({ id: uuid, version, version_hash: hash, approved_at: date,
    relationship: z.enum(["exact_source_version", "different_source_version"]), source_current: z.boolean(), superseded: z.boolean(),
    replaces_id: uuid.nullable(), outside_status: z.enum(["active", "inactive", "unknown"]), completeness: z.enum(["complete", "partial"]),
    prescription_date_status: z.enum(["date", "unknown", "uninterpreted"]), consult_status: z.enum(["resolved", "not_supplied"]),
    reference_status: z.enum(["matched", "unresolved"]), source_list_present: z.boolean(), scan_complete: z.boolean(),
    selected_items: z.number().int().nonnegative(),
    omitted_items: z.number().int().nonnegative(),
    expected_items: z.number().int().nonnegative(),
    observed_items: z.number().int().nonnegative(),
    missing_items: z.number().int().nonnegative(),
    unexpected_items: z.number().int().nonnegative(),
    duplicate_source_ids: z.number().int().nonnegative(),
    duplicate_observed_ids: z.number().int().nonnegative(),
    invalid_source_references: z.number().int().nonnegative(),
    invalid_observed_references: z.number().int().nonnegative() }).strict()).max(100),
  has_more: z.boolean(), next_before_version: version.nullable(), local_prescribing_verified: z.literal(false), item_coverage_verified: z.literal(false), complete_coverage_verified: z.literal(false), observed_at: date,
}).strict();
export interface MigrationPrescriptionPage extends z.infer<typeof pageSchema> {}
export function createMigrationPrescriptionApi(client: MigrationRpc, actor: string) {
  uuid.parse(actor);
  return {
    async list(binding: MigrationBinding, item: MigrationItem, before: number | null = null, limit = 20): Promise<MigrationPrescriptionPage> {
      const owned = parseMigrationBinding(binding, actor, binding.scope_id);
      if (owned.child_context.resource !== "prescription" || item.ordinal !== 0) throw new Error("Prescription observation required");
      const identity = pageSchema.pick({ page: true, snapshot_id: true, evidence_hash: true }).parse({ page: item.page, snapshot_id: item.snapshot_id, evidence_hash: item.evidence_hash });
      if (before !== null) version.parse(before);
      z.number().int().min(1).max(100).parse(limit);
      const { data, error } = await client.rpc("list_ezyvet_migration_prescription_evidence", { p_binding_id: owned.id, p_page: identity.page,
        p_snapshot_id: identity.snapshot_id, p_evidence_hash: identity.evidence_hash, p_before_version: before, p_limit: limit });
      if (error) throw error;
      const result = pageSchema.parse(data);
      if (result.actor_id !== actor || result.binding_id !== owned.id || result.scope_id !== owned.scope_id || result.child_run_id !== owned.child_run_id ||
        result.page !== identity.page || result.snapshot_id !== identity.snapshot_id || result.evidence_hash !== identity.evidence_hash) throw new Error("Prescription evidence identity differs");
      if (result.approvals.length > limit || (result.has_more && result.approvals.length !== limit)) throw new Error("Prescription evidence page size differs");
      let previous = before;
      const ids = new Set<string>();
      for (const row of result.approvals) {
        if (ids.has(row.id) || (previous !== null && row.version >= previous)) throw new Error("Prescription evidence order differs");
        if ((row.version === 1) !== (row.replaces_id === null) || row.replaces_id === row.id) throw new Error("Prescription predecessor differs");
        ids.add(row.id); previous = row.version;
      }
      if (result.next_before_version !== (result.has_more ? previous : null)) throw new Error("Prescription evidence continuation differs");
      return result;
    },
  };
}
