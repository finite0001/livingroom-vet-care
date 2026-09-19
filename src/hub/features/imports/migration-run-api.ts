import { z } from "zod";
import { migrationItemCursorSchema, parseMigrationItems } from "./migration-items-api.ts";
import type { MigrationItemCursor } from "./migration-items-api.ts";
import { precedes } from "./attachment-review-history.ts";

const uuid = z.string().uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const date = z.string().datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)) && !/\.\d{7}/.test(value));
const origin = z.enum(["https://api.trial.ezyvet.com", "https://api.ezyvet.com"]);
const site = z.string().min(1).max(4096).refine(value => value === value.trim());
const resource = z.enum(["contact", "animal", "healthstatus", "consult", "history", "vaccination", "prescription", "prescriptionitem", "attachment"]);
const scopeInput = z.object({
  id: uuid, mapping_id: uuid, resource, parent_type: z.enum(["contact", "animal", "consult", "prescription"]),
  parent_snapshot_id: uuid, parent_head_version: z.number().int().min(1).max(999999999),
  disposition: z.enum(["required", "excluded", "unsupported"]),
  reason: z.string().min(1).max(2000).refine(value => value === value.trim()),
}).strict();
const intentSchema = z.object({ version: z.literal(1), source_origin: origin, source_site_uid: site, scopes: z.array(scopeInput).min(1).max(100) }).strict();
const runSummary = z.object({ id: uuid, source_origin: origin, source_site_uid: site, intent_hash: hash, created_at: date }).strict();
const runSchema = runSummary.extend({ actor_id: uuid, intent: intentSchema }).strict();
const scopeSchema = scopeInput.extend({
  migration_run_id: uuid, mapping_snapshot_id: uuid, mapping_head_version: z.number().int().positive(),
  client_id: uuid, pet_id: uuid.nullable(), parent_external_id: z.string().min(1), parent_payload_hash: hash,
}).strict();
const manifestSchema = z.object({ run: runSchema, scopes: z.array(scopeSchema).min(1).max(100), scope_manifest_version: z.literal(1), scope_manifest_hash: hash }).strict();
const descriptor = z.object({
  version: z.literal(1), run_id: uuid, owner: uuid, source_origin: origin, source_site_uid: site, resource,
  parent_evidence: z.enum(["selected_identity_filter", "mapping_identity_only", "exact_parent_version"]),
  context: z.record(z.unknown()),
}).strict();
const bindingSchema = z.object({
  id: uuid, scope_id: uuid, child_run_id: uuid, actor_id: uuid, replaces_id: uuid.nullable(),
  reason: z.string().min(1).max(2000), child_context: descriptor, context_hash: hash, created_at: date,
}).strict();
const cursorSchema = z.object({ before_at: date, before_id: uuid }).strict();
const count = z.number().int().nonnegative().safe();
const progressSchema = z.object({
  version: z.literal(2), binding_id: uuid, scope_id: uuid, migration_run_id: uuid, child_run_id: uuid, resource, context_hash: hash,
  superseded: z.boolean(), parent_evidence: descriptor.shape.parent_evidence, parent_current: z.boolean(), household_current: z.boolean(),
  scan: z.object({ status: z.enum(["running", "review_ready", "page_limit_reached"]), next_page: z.number().int().min(1).max(1001), pages_observed: count.max(1000),
    traversal_ended: z.boolean(), page_limit_reached: z.boolean(), retry_after: date.nullable(), latest_error_code: z.string().regex(/^[A-Z_]{1,64}$/).nullable(),
    provider_total: z.null(), complete_coverage_verified: z.literal(false) }).strict(),
  observations: z.object({ occurrences: count, distinct_source_identities: count, distinct_snapshot_versions: count,
    occurrence_fidelity: z.enum(["page_ordinal", "deduplicated_page_snapshot"]), exact_current_occurrences: count.nullable(), currentness_available: z.boolean() }).strict(),
  clinical_review: z.object({ reconciled: z.literal(false), approved_local_outcomes: z.null() }).strict(),
  attempt_history_available: z.boolean(), attempt_history: z.object({ origin: z.enum(["run_created", "migration_baseline"]).nullable(), started_at: date.nullable(),
    complete_since_run_creation: z.boolean(), claims: count, failed_pages: count, staged_pages: count }).strict(), observed_at: date,
}).strict();
const attemptEventSchema = z.object({ id: uuid, sequence: z.number().int().positive(), kind: z.enum(["baseline", "claimed", "page_staged", "page_failed"]),
  attempt_hash: hash.nullable(), page: z.number().int().min(1).max(1001), run_status: z.enum(["running", "review_ready", "page_limit_reached"]),
  next_page: z.number().int().min(1).max(1001), retry_after: date.nullable(), error_code: z.string().regex(/^[A-Z_]{1,64}$/).nullable(),
  staged_item_count: count.max(50).nullable(), history_origin: z.enum(["run_created", "migration_baseline"]).nullable(), recorded_at: date }).strict();
export interface MigrationScopeInput extends z.infer<typeof scopeInput> {}
export interface MigrationManifest extends z.infer<typeof manifestSchema> {}
export interface MigrationBinding extends z.infer<typeof bindingSchema> {}
export interface MigrationCursor extends z.infer<typeof cursorSchema> {}
export interface MigrationProgress extends z.infer<typeof progressSchema> {}
export interface MigrationAttemptEvent extends z.infer<typeof attemptEventSchema> {}
export interface MigrationRequest { id: string; source_origin: string; source_site_uid: string; scopes: MigrationScopeInput[] }
export interface MigrationBindingRequest { id: string; scope_id: string; child_run_id: string; reason: string; replaces_id: string | null }
export interface MigrationRpc {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

function sameScope(left: MigrationScopeInput, right: MigrationScopeInput) {
  return Object.keys(scopeInput.shape).every(key => left[key as keyof MigrationScopeInput] === right[key as keyof MigrationScopeInput]);
}
export function parseMigrationManifest(value: unknown, actorId: string, id: string): MigrationManifest {
  const result = manifestSchema.parse(value);
  const { run, scopes } = result;
  if (run.id !== id || run.actor_id !== actorId || run.source_origin !== run.intent.source_origin || run.source_site_uid !== run.intent.source_site_uid || scopes.length !== run.intent.scopes.length)
    throw new Error("Migration manifest identity differs");
  const expected = new Map(run.intent.scopes.map(scope => [scope.id, scope]));
  if (expected.size !== scopes.length) throw new Error("Duplicate migration scope");
  const seen = new Set<string>();
  for (const scope of scopes) {
    const input = expected.get(scope.id);
    if (!input || seen.has(scope.id) || scope.migration_run_id !== id || !sameScope(input, scope)) throw new Error("Migration scope identity differs");
    seen.add(scope.id);
  }
  return result;
}
export function parseMigrationBinding(value: unknown, actorId: string, scopeId: string): MigrationBinding {
  const result = bindingSchema.parse(value);
  if (result.actor_id !== actorId || result.scope_id !== scopeId || result.child_context.owner !== actorId || result.child_context.run_id !== result.child_run_id)
    throw new Error("Migration binding identity differs");
  return result;
}
export function parseMigrationProgress(value: unknown, manifest: MigrationManifest, binding: MigrationBinding): MigrationProgress {
  const result = progressSchema.parse(value);
  const scope = manifest.scopes.find(row => row.id === binding.scope_id);
  const { scan, observations: observed } = result;
  if (!scope || result.binding_id !== binding.id || result.scope_id !== scope.id || result.migration_run_id !== manifest.run.id ||
    result.child_run_id !== binding.child_run_id || result.context_hash !== binding.context_hash || result.resource !== scope.resource || result.resource !== binding.child_context.resource ||
    binding.child_context.source_origin !== manifest.run.source_origin || binding.child_context.source_site_uid !== manifest.run.source_site_uid ||
    result.parent_evidence !== binding.child_context.parent_evidence || scan.traversal_ended !== (scan.status === "review_ready") ||
    scan.page_limit_reached !== (scan.status === "page_limit_reached") || observed.distinct_source_identities > observed.distinct_snapshot_versions ||
    observed.distinct_snapshot_versions > observed.occurrences || observed.exact_current_occurrences > observed.occurrences ||
    observed.currentness_available !== !["contact", "animal", "healthstatus"].includes(result.resource) ||
    observed.currentness_available !== (observed.exact_current_occurrences !== null) ||
    observed.occurrence_fidelity !== (result.resource === "attachment" ? "page_ordinal" : "deduplicated_page_snapshot") ||
    result.attempt_history_available !== Boolean(result.attempt_history.origin && result.attempt_history.started_at) ||
    result.attempt_history.complete_since_run_creation !== (result.attempt_history.origin === "run_created"))
    throw new Error("Migration progress scope or counts differ");
  return result;
}
function pageArguments(cursor: MigrationCursor | null, limit: number) {
  z.number().int().min(1).max(100).parse(limit);
  if (cursor) cursorSchema.parse(cursor);
  return { p_before_at: cursor?.before_at ?? null, p_before_id: cursor?.before_id ?? null, p_limit: limit };
}
interface HistoryIdentity { id?: string; created_at?: string }
function verifyPage<T extends HistoryIdentity>(rows: T[], more: boolean, cursor: MigrationCursor | null, limit: number) {
  if (rows.length > limit || (more && rows.length !== limit)) throw new Error("Migration history page size differs");
  const ids = new Set<string>();
  rows.forEach((row, index) => {
    uuid.parse(row.id); date.parse(row.created_at);
    const previous = rows[index - 1];
    if (ids.has(row.id) || (previous && !precedes(row.created_at, row.id, previous.created_at, previous.id)) ||
      (cursor && !precedes(row.created_at, row.id, cursor.before_at, cursor.before_id))) throw new Error("Migration history cursor differs");
    ids.add(row.id);
  });
  const last = rows[rows.length - 1];
  return more && last ? { before_at: last.created_at, before_id: last.id } : null;
}

export function createMigrationRunApi(client: MigrationRpc, actorId: string) {
  uuid.parse(actorId);
  async function rpc(name: string, args: Record<string, unknown>) {
    const { data, error } = await client.rpc(name, args);
    if (error) throw error;
    return data;
  }
  return {
    async prepare(request: MigrationRequest) {
      uuid.parse(request.id);
      const intent = intentSchema.parse({ version: 1, source_origin: request.source_origin, source_site_uid: request.source_site_uid, scopes: request.scopes });
      const result = parseMigrationManifest(await rpc("prepare_ezyvet_migration_run", { p_id: request.id, p_source_origin: intent.source_origin, p_source_site_uid: intent.source_site_uid, p_scopes: intent.scopes }), actorId, request.id);
      if (result.run.source_origin !== intent.source_origin || result.run.source_site_uid !== intent.source_site_uid || result.scopes.length !== intent.scopes.length ||
        intent.scopes.some(scope => !result.scopes.some(saved => saved.id === scope.id && sameScope(saved, scope)))) throw new Error("Saved migration intent differs");
      return result;
    },
    async read(id: string) {
      uuid.parse(id);
      const value = await rpc("read_ezyvet_migration_run", { p_id: id });
      return value === null ? null : parseMigrationManifest(value, actorId, id);
    },
    async list(cursor: MigrationCursor | null = null, limit = 20) {
      const page = z.object({ runs: z.array(runSummary).max(100), has_more: z.boolean() }).strict().parse(await rpc("list_ezyvet_migration_runs", pageArguments(cursor, limit)));
      return { ...page, next_cursor: verifyPage(page.runs, page.has_more, cursor, limit) };
    },
    async bind(request: MigrationBindingRequest) {
      const input = z.object({ id: uuid, scope_id: uuid, child_run_id: uuid, reason: z.string().min(1).max(2000), replaces_id: uuid.nullable() }).strict().parse(request);
      const result = parseMigrationBinding(await rpc("bind_ezyvet_migration_child", { p_id: input.id, p_scope_id: input.scope_id, p_child_run_id: input.child_run_id, p_reason: input.reason, p_replaces_id: input.replaces_id }), actorId, input.scope_id);
      if (result.id !== input.id || result.child_run_id !== input.child_run_id || result.reason !== input.reason || result.replaces_id !== input.replaces_id) throw new Error("Saved binding intent differs");
      return result;
    },
    async readBinding(id: string, scopeId: string) {
      uuid.parse(id); uuid.parse(scopeId);
      const value = await rpc("read_ezyvet_migration_binding", { p_id: id });
      if (value === null) return null;
      const result = parseMigrationBinding(value, actorId, scopeId);
      if (result.id !== id) throw new Error("Recovered binding identity differs");
      return result;
    },
    async listBindings(scopeId: string, cursor: MigrationCursor | null = null, limit = 20) {
      uuid.parse(scopeId);
      const page = z.object({ bindings: z.array(bindingSchema).max(100), has_more: z.boolean() }).strict().parse(await rpc("list_ezyvet_migration_bindings", { p_scope_id: scopeId, ...pageArguments(cursor, limit) }));
      const bindings = page.bindings.map(value => parseMigrationBinding(value, actorId, scopeId));
      return { ...page, bindings, next_cursor: verifyPage(bindings, page.has_more, cursor, limit) };
    },
    async progress(manifest: MigrationManifest, binding: MigrationBinding) {
      const saved = parseMigrationManifest(manifest, actorId, manifest.run.id);
      const membership = parseMigrationBinding(binding, actorId, binding.scope_id);
      if (!saved.scopes.some(scope => scope.id === membership.scope_id)) throw new Error("Binding belongs to another migration");
      const value = await rpc("read_ezyvet_migration_binding_progress", { p_id: membership.id });
      return value === null ? null : parseMigrationProgress(value, saved, membership);
    },
    async items(manifest: MigrationManifest, binding: MigrationBinding, cursor: MigrationItemCursor | null = null, limit = 20) {
      const saved = parseMigrationManifest(manifest, actorId, manifest.run.id);
      const membership = parseMigrationBinding(binding, actorId, binding.scope_id);
      if (!saved.scopes.some(scope => scope.id === membership.scope_id)) throw new Error("Binding belongs to another migration");
      z.number().int().min(1).max(100).parse(limit);
      if (cursor) migrationItemCursorSchema.parse(cursor);
      const value = await rpc("list_ezyvet_migration_items", { p_binding_id: membership.id, p_after_page: cursor?.page ?? null,
        p_after_ordinal: cursor?.ordinal ?? null, p_after_snapshot_id: cursor?.snapshot_id ?? null, p_limit: limit });
      return parseMigrationItems(value, saved, membership, cursor, limit);
    },
    async attempts(binding: MigrationBinding, beforeSequence: number | null = null, limit = 20) {
      const membership = parseMigrationBinding(binding, actorId, binding.scope_id);
      z.number().int().min(1).max(100).parse(limit);
      if (beforeSequence !== null) z.number().int().positive().parse(beforeSequence);
      const page = z.object({ version: z.literal(1), binding_id: uuid, scope_id: uuid, child_run_id: uuid, events: z.array(attemptEventSchema).max(100), has_more: z.boolean() }).strict()
        .parse(await rpc("list_ezyvet_migration_attempt_events", { p_binding_id: membership.id, p_before_sequence: beforeSequence, p_limit: limit }));
      if (page.binding_id !== membership.id || page.scope_id !== membership.scope_id || page.child_run_id !== membership.child_run_id ||
        page.events.length > limit || (page.has_more && page.events.length !== limit)) throw new Error("Attempt history scope or page differs");
      let previous = beforeSequence ?? Infinity;
      const ids = new Set<string>();
      for (const event of page.events) {
        if (event.sequence >= previous || ids.has(event.id) || (event.kind === "baseline") !== (event.history_origin !== null) ||
          (event.kind !== "baseline" && event.attempt_hash === null) || (event.kind === "page_staged") !== (event.staged_item_count !== null) ||
          (event.kind === "page_failed" && event.error_code === null)) throw new Error("Attempt history identity or transition differs");
        previous = event.sequence; ids.add(event.id);
      }
      return { ...page, next_sequence: page.has_more ? page.events[page.events.length - 1].sequence : null };
    },
  };
}
