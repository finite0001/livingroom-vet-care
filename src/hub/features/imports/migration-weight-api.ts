import { z } from "zod";
import { precedes } from "./attachment-review-history.ts";
import { parseMigrationBinding } from "./migration-run-api.ts";
import type { MigrationBinding, MigrationRpc } from "./migration-run-api.ts";
import type { MigrationItem } from "./migration-items-api.ts";
const uuid = z.string().uuid(), date = z.string().datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)) && !/\.\d{7}/.test(value));
const relationship = z.enum(["same_snapshot_unknown_observed_head", "different_snapshot"]);
const cursor = z.object({ created_at: date, request_id: uuid }).strict();
const schema = z.object({
  version: z.literal(1), binding_id: uuid, scope_id: uuid, child_run_id: uuid, actor_id: uuid,
  resource: z.literal("healthstatus"), page: z.number().int().min(1).max(1000), snapshot_id: uuid,
  evidence_hash: z.string().regex(/^[a-f0-9]{64}$/), observation_head_available: z.literal(false),
  exact_source_version_verified: z.literal(false), complete_coverage_verified: z.literal(false),
  approval: z.object({ id: uuid, approved_at: date, action: z.enum(["create", "link"]), weight_id: uuid,
    relationship, source_current: z.boolean(), patient_version_unchanged: z.boolean(),
    household_current: z.boolean(), local_weight_matches_review: z.boolean(),
  }).strict().nullable(),
  source_reviews: z.array(z.object({ id: uuid, created_at: date, snapshot_id: uuid,
    head_version: z.number().int().positive(), relationship, source_current: z.boolean(),
    promotes_local_weight: z.literal(false),
  }).strict()).max(20),
  has_more: z.boolean(), next_cursor: cursor.nullable(), observed_at: date,
}).strict();
export interface MigrationWeightCursor extends z.infer<typeof cursor> {}
export interface MigrationWeightEvidence extends z.infer<typeof schema> {}
export function createMigrationWeightApi(client: MigrationRpc, actor: string) {
  uuid.parse(actor);
  return {
    async read(binding: MigrationBinding, item: MigrationItem, before: MigrationWeightCursor | null = null): Promise<MigrationWeightEvidence> {
      const owned = parseMigrationBinding(binding, actor, binding.scope_id);
      if (owned.child_context.resource !== "healthstatus" || item.ordinal !== 0 || item.observed_head_version !== null) throw new Error("Legacy weight observation required");
      const identity = schema.pick({ page: true, snapshot_id: true, evidence_hash: true }).parse({ page: item.page, snapshot_id: item.snapshot_id, evidence_hash: item.evidence_hash });
      const c = before ? cursor.parse(before) : null;
      const { data, error } = await client.rpc("read_ezyvet_migration_weight_evidence", {
        p_binding_id: owned.id, p_page: identity.page, p_snapshot_id: identity.snapshot_id,
        p_evidence_hash: identity.evidence_hash, p_before_created_at: c?.created_at ?? null,
        p_before_request_id: c?.request_id ?? null, p_limit: 20,
      });
      if (error) throw error;
      const result = schema.parse(data);
      if (result.actor_id !== actor || result.binding_id !== owned.id || result.scope_id !== owned.scope_id || result.child_run_id !== owned.child_run_id ||
        result.page !== identity.page || result.snapshot_id !== identity.snapshot_id || result.evidence_hash !== identity.evidence_hash) throw new Error("Weight evidence scope differs");
      if ((!result.approval && result.source_reviews.length > 0) || result.has_more !== (result.next_cursor !== null)) throw new Error("Weight evidence history differs");
      if (result.has_more && result.source_reviews.length !== 20) throw new Error("Weight evidence page size differs");
      let previous = c;
      const ids = new Set<string>();
      for (const review of result.source_reviews) {
        if (ids.has(review.id) || (previous && !precedes(review.created_at, review.id, previous.created_at, previous.request_id))) throw new Error("Weight evidence order differs");
        if ((review.snapshot_id === identity.snapshot_id) !== (review.relationship === "same_snapshot_unknown_observed_head")) throw new Error("Weight evidence relationship differs");
        ids.add(review.id); previous = { created_at: review.created_at, request_id: review.id };
      }
      const last = result.source_reviews.at(-1);
      if (result.next_cursor && (!last || result.next_cursor.request_id !== last.id || result.next_cursor.created_at !== last.created_at)) throw new Error("Weight evidence cursor differs");
      return result;
    },
  };
}
