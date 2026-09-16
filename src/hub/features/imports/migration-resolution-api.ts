import { z } from "zod";
import { precedes } from "./attachment-review-history.ts";
import type { MigrationCursor, MigrationManifest, MigrationRpc } from "./migration-run-api.ts";
import type { MigrationResolutionRequest } from "./migration-resolution-state.ts";

const uuid = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
const date = z.string().datetime({ offset: true }).refine(v => Number.isFinite(Date.parse(v)) && !/\.\d{7}/.test(v));
const version = z.number().int().positive().safe(), count = z.number().int().nonnegative().safe();
const resource = z.enum(["contact", "animal", "healthstatus", "consult", "history", "vaccination", "prescription", "prescriptionitem", "attachment"]);
const targetShape = z.object({ kind: z.enum(["scope", "observation"]), binding_id: uuid.nullable(), page: z.number().int().min(1).max(1000).nullable(), ordinal: z.number().int().min(0).max(10).nullable(), snapshot_id: uuid.nullable(), evidence_hash: hash.nullable() }).strict();
const targetSchema = targetShape.refine(t => [t.binding_id, t.page, t.ordinal, t.snapshot_id, t.evidence_hash].every(v => t.kind === "scope" ? v === null : v !== null), "Exact target required");
const head = z.object({ current_snapshot_id: uuid.nullable(), current_head_version: version.nullable() }).strict().refine(h => (h.current_snapshot_id === null) === (h.current_head_version === null));
const contextSchema = z.object({
  version: z.literal(1), manifest_hash: hash, source_origin: z.enum(["https://api.trial.ezyvet.com", "https://api.ezyvet.com"]), source_site_uid: z.string().min(1),
  scope: z.object({ id: uuid, migration_run_id: uuid, resource, disposition: z.enum(["required", "excluded", "unsupported"]), mapping_id: uuid, mapping_snapshot_id: uuid, mapping_head_version: version, client_id: uuid, pet_id: uuid.nullable(), parent_type: z.enum(["contact", "animal", "consult", "prescription"]), parent_snapshot_id: uuid, parent_head_version: version }).strict(),
  binding: z.object({ selected_id: uuid.nullable(), selected_context_hash: hash.nullable(), current_id: uuid.nullable(), current_context_hash: hash.nullable(), child_run_id: uuid.nullable(), superseded: z.boolean() }).strict(),
  mapping: head, parent: head,
  local: z.object({ client_exists: z.boolean(), client_version: version.nullable(), pet_exists: z.boolean().nullable(), pet_version: version.nullable(), household_current: z.boolean() }).strict(),
  scan: z.object({ status: z.enum(["running", "review_ready", "page_limit_reached"]), next_page: z.number().int().min(1).max(1001), retry_after: date.nullable(), error_code: z.string().regex(/^[A-Z_]{1,64}$/).nullable(), attempt_sequence: count }).strict().nullable(),
  observation: z.object({ page: z.number().int().min(1).max(1000), ordinal: z.number().int().min(0).max(10), snapshot_id: uuid, external_id: z.string().min(1), payload_hash: hash, observed_head_version: version.nullable(), file_id: z.string().nullable(), raw_record_sha256: hash.nullable(), stable_metadata_sha256: hash.nullable(), evidence_hash: hash, current_snapshot_id: uuid.nullable(), current_head_version: version.nullable() }).strict().nullable(),
}).strict();
const receiptSchema = z.object({
  receipt_version: z.literal(1), id: uuid, actor_id: uuid, migration_run_id: uuid, scope_id: uuid,
  target_kind: targetShape.shape.kind, binding_id: targetShape.shape.binding_id, page: targetShape.shape.page, ordinal: targetShape.shape.ordinal, snapshot_id: targetShape.shape.snapshot_id, evidence_hash: targetShape.shape.evidence_hash,
  target_key: hash, action: z.enum(["exclude", "reopen"]), reason: z.string().min(1).max(2000).refine(v => v === v.trim()), request_hash: hash,
  reviewed_context: contextSchema, reviewed_context_hash: hash, replaces_id: uuid.nullable(), version, record_hash: hash, created_at: date,
}).strict();
const flags = { clinical_approval_performed: z.literal(false), complete_coverage_verified: z.literal(false) };
const envelope = z.object({ version: z.literal(1), actor_id: uuid, scope_id: uuid, target: targetSchema, target_key: hash, context: contextSchema, context_hash: hash, latest: receiptSchema.nullable(), ...flags, observed_at: date }).strict();
const cursorSchema = z.object({ before_at: date, before_id: uuid }).strict();
const historySchema = z.object({ version: z.literal(1), actor_id: uuid, scope_id: uuid, target: targetSchema.nullable(), target_key: hash.nullable(), resolutions: z.array(z.object({ receipt: receiptSchema, superseded: z.boolean(), context_current: z.boolean() }).strict()).max(100), has_more: z.boolean(), next_cursor: cursorSchema.nullable(), ...flags, observed_at: date }).strict();

export interface MigrationResolutionTarget extends z.infer<typeof targetShape> {}
export interface MigrationResolutionContext extends z.infer<typeof envelope> {}
export interface MigrationResolutionReceipt extends z.infer<typeof receiptSchema> {}
export interface MigrationResolutionHistoryPage extends z.infer<typeof historySchema> {}

export function resolutionTarget(request: MigrationResolutionRequest | MigrationResolutionReceipt): MigrationResolutionTarget {
  return targetSchema.parse({ kind: request.target_kind, binding_id: request.binding_id, page: request.page, ordinal: request.ordinal, snapshot_id: request.snapshot_id, evidence_hash: request.evidence_hash });
}
function sameTarget(left: MigrationResolutionTarget, right: MigrationResolutionTarget) {
  return Object.keys(targetShape.shape).every(k => left[k as keyof MigrationResolutionTarget] === right[k as keyof MigrationResolutionTarget]);
}

export function createMigrationResolutionApi(client: MigrationRpc, actor: string, manifest: MigrationManifest) {
  uuid.parse(actor);
  if (manifest.run.actor_id !== actor) throw new Error("Migration owner differs");
  const scopeFor = (scopeId: string) => {
    uuid.parse(scopeId);
    const scope = manifest.scopes.find(s => s.id === scopeId);
    if (!scope) throw new Error("Migration scope differs");
    return scope;
  };
  function verifyContext(ctx: z.infer<typeof contextSchema>, scopeId: string, target: MigrationResolutionTarget) {
    const scope = scopeFor(scopeId);
    if (ctx.manifest_hash !== manifest.scope_manifest_hash || ctx.source_origin !== manifest.run.source_origin || ctx.source_site_uid !== manifest.run.source_site_uid ||
      Object.keys(ctx.scope).some(k => ctx.scope[k as keyof typeof ctx.scope] !== scope[k as keyof typeof scope])) throw new Error("Resolution context scope differs");
    const b = ctx.binding, local = ctx.local, o = ctx.observation;
    if ((b.selected_id === null) !== (b.selected_context_hash === null) || (b.selected_id === null) !== (b.child_run_id === null) ||
      (b.current_id === null) !== (b.current_context_hash === null) || (b.selected_id === null) !== (ctx.scan === null) ||
      b.superseded !== (b.selected_id !== null && b.selected_id !== b.current_id) || local.client_exists !== (local.client_version !== null) ||
      (scope.pet_id === null ? local.pet_exists !== null || local.pet_version !== null : local.pet_exists !== (local.pet_version !== null))) throw new Error("Resolution context state differs");
    if (target.kind === "scope") {
      if (o !== null || b.selected_id !== b.current_id) throw new Error("Scope resolution extent differs");
    } else if (!o || b.selected_id !== target.binding_id || o.page !== target.page || o.ordinal !== target.ordinal || o.snapshot_id !== target.snapshot_id || o.evidence_hash !== target.evidence_hash) {
      throw new Error("Resolution occurrence differs");
    }
    if (o && ((o.current_snapshot_id === null) !== (o.current_head_version === null) ||
      (["contact", "animal", "healthstatus"].includes(scope.resource) && o.observed_head_version !== null) ||
      (scope.resource !== "attachment" && (o.ordinal !== 0 || o.file_id !== null || o.raw_record_sha256 !== null || o.stable_metadata_sha256 !== null)))) throw new Error("Resolution observation fidelity differs");
  }
  function verifyReceipt(value: unknown, scopeId: string, expectedTarget?: MigrationResolutionTarget) {
    const r = receiptSchema.parse(value), t = resolutionTarget(r);
    if (r.actor_id !== actor || r.migration_run_id !== manifest.run.id || r.scope_id !== scopeId || (expectedTarget && !sameTarget(t, expectedTarget)) ||
      (r.version === 1) !== (r.replaces_id === null) || r.replaces_id === r.id || (r.action === "reopen" && r.replaces_id === null)) throw new Error("Resolution receipt identity differs");
    verifyContext(r.reviewed_context, scopeId, t);
    return r;
  }
  function verifyRequest(request: MigrationResolutionRequest) {
    uuid.parse(request.id); scopeFor(request.scope_id); hash.parse(request.expected_context_hash);
    if (request.replaces_id !== null) uuid.parse(request.replaces_id);
    z.enum(["exclude", "reopen"]).parse(request.action);
    receiptSchema.shape.reason.parse(request.reason);
    if (request.replaces_id === request.id || (request.action === "reopen" && request.replaces_id === null)) throw new Error("Invalid resolution predecessor");
    return resolutionTarget(request);
  }
  function exactReceipt(value: unknown, request: MigrationResolutionRequest) {
    const r = verifyReceipt(value, request.scope_id, resolutionTarget(request));
    if (r.id !== request.id || r.action !== request.action || r.reason !== request.reason || r.replaces_id !== request.replaces_id || r.reviewed_context_hash !== request.expected_context_hash) throw new Error("Saved resolution request differs");
    return r;
  }
  async function rpc(name: string, args: Record<string, unknown>) {
    const { data, error } = await client.rpc(name, args);
    if (error) throw error;
    return data;
  }
  return {
    async context(scopeId: string, target: MigrationResolutionTarget): Promise<MigrationResolutionContext> {
      scopeFor(scopeId); targetSchema.parse(target);
      const result = envelope.parse(await rpc("read_ezyvet_migration_resolution_context", { p_scope_id: scopeId, p_target: target }));
      if (result.actor_id !== actor || result.scope_id !== scopeId || !sameTarget(result.target, target)) throw new Error("Resolution context identity differs");
      verifyContext(result.context, scopeId, target);
      if (result.latest) {
        verifyReceipt(result.latest, scopeId, target);
        if (result.latest.target_key !== result.target_key) throw new Error("Resolution target chain differs");
      }
      return result;
    },
    async save(request: MigrationResolutionRequest): Promise<MigrationResolutionReceipt> {
      const target = verifyRequest(request);
      return exactReceipt(await rpc("save_ezyvet_migration_resolution", { p_id: request.id, p_scope_id: request.scope_id, p_target: target, p_action: request.action, p_reason: request.reason, p_expected_context_hash: request.expected_context_hash, p_replaces_id: request.replaces_id }), request);
    },
    async recover(request: MigrationResolutionRequest): Promise<MigrationResolutionReceipt | null> {
      verifyRequest(request);
      const result = await rpc("read_ezyvet_migration_resolution", { p_id: request.id });
      return result === null ? null : exactReceipt(result, request);
    },
    async history(scopeId: string, target: MigrationResolutionTarget | null = null, cursor: MigrationCursor | null = null, limit = 20): Promise<MigrationResolutionHistoryPage> {
      scopeFor(scopeId); if (target) targetSchema.parse(target); if (cursor) cursorSchema.parse(cursor); z.number().int().min(1).max(100).parse(limit);
      const result = historySchema.parse(await rpc("list_ezyvet_migration_resolutions", { p_scope_id: scopeId, p_target: target, p_before_at: cursor?.before_at ?? null, p_before_id: cursor?.before_id ?? null, p_limit: limit }));
      if (result.actor_id !== actor || result.scope_id !== scopeId || (target === null ? result.target !== null || result.target_key !== null : !result.target || !sameTarget(target, result.target) || result.target_key === null)) throw new Error("Resolution history scope differs");
      let previous = cursor;
      const ids = new Set<string>();
      for (const row of result.resolutions) {
        const r = verifyReceipt(row.receipt, scopeId, target ?? undefined);
        if (ids.has(r.id) || (result.target_key !== null && r.target_key !== result.target_key) || (previous && !precedes(r.created_at, r.id, previous.before_at, previous.before_id))) throw new Error("Resolution history order differs");
        ids.add(r.id); previous = { before_at: r.created_at, before_id: r.id };
      }
      if (result.resolutions.length > limit || result.has_more !== !!result.next_cursor || (result.has_more && (result.resolutions.length !== limit || result.next_cursor?.before_at !== previous?.before_at || result.next_cursor?.before_id !== previous?.before_id))) throw new Error("Resolution history cursor differs");
      return result;
    },
  };
}
