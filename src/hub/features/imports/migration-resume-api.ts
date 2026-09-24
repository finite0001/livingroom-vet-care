import { z } from "zod";
import { createMigrationRunApi } from "./migration-run-api.ts";
import type { MigrationBinding, MigrationManifest, MigrationRpc } from "./migration-run-api.ts";
const uuid = z.string().uuid(), date = z.string().datetime({ offset: true });
export interface MigrationResumeIdentity { manifest_id: string; scope_id: string; binding_id: string }
export interface MigrationResumeTransport extends MigrationRpc {
  readGenericRun: (id: string, actor: string) => Promise<unknown>;
  invoke: (body: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
}
export interface MigrationResumeState extends MigrationResumeIdentity {
  child_run_id: string; resource: string; next_page: number; status: "running" | "review_ready" | "page_limit_reached";
  retry_after: string | null; lease_active: boolean; blockers: string[]; source_site_uid: string; parent_external_id: string;
  checked_at: string;
}
export function migrationResumeBody(manifest: MigrationManifest, binding: MigrationBinding): Record<string, unknown> {
  const scope = manifest.scopes.find(s => s.id === binding.scope_id);
  if (!scope || scope.resource !== binding.child_context.resource || scope.disposition !== "required") throw new Error("Required bound resource missing");
  const body: Record<string, unknown> = { run_id: binding.child_run_id, resource: scope.resource };
  if (!["contact", "animal"].includes(scope.resource)) body.animal_link_id = scope.mapping_id;
  const parent = scope.resource === "vaccination" ? "consult" : scope.resource === "prescriptionitem" ? "prescription" : null;
  if (parent) {
    body[`${parent}_snapshot_id`] = scope.parent_snapshot_id;
    body[`${parent}_payload_hash`] = scope.parent_payload_hash;
    body[`${parent}_observed_head_version`] = scope.parent_head_version;
  }
  return body;
}
export function createMigrationResumeApi(transport: MigrationResumeTransport, actor: string, now: () => number = Date.now) {
  const api = createMigrationRunApi(transport, actor);
  let advancing = false;
  async function inspect(identity: MigrationResumeIdentity) {
    uuid.parse(identity.manifest_id); uuid.parse(identity.scope_id); uuid.parse(identity.binding_id);
    const manifest = await api.read(identity.manifest_id), binding = await api.readBinding(identity.binding_id, identity.scope_id);
    if (!manifest || !binding || !manifest.scopes.some(s => s.id === identity.scope_id)) throw new Error("Saved migration binding unavailable");
    const scope = manifest.scopes.find(s => s.id === identity.scope_id)!;
    const progress = await api.progress(manifest, binding);
    const items = await api.items(manifest, binding, null, 1);
    if (!progress) throw new Error("Run progress unavailable");
    const body = migrationResumeBody(manifest, binding);
    let raw: unknown;
    const generic = ["contact", "animal", "healthstatus"].includes(scope.resource);
    if (generic) raw = await transport.readGenericRun(binding.child_run_id, actor);
    else {
      const family = ["consult", "history"].includes(scope.resource) ? "clinical" : scope.resource;
      const args: Record<string, unknown> = { p_id: binding.child_run_id, p_animal_link_id: scope.mapping_id };
      if (["clinical", "prescription"].includes(family)) args.p_resource = scope.resource;
      for (const [key, value] of Object.entries(body)) if (key.startsWith("consult_") || key.startsWith("prescription_")) args[`p_${key}`] = value;
      const { data, error } = await transport.rpc(`recover_ezyvet_${family}_run`, args); if (error) throw error; raw = data;
    }
    const schema = z.object({ id: z.literal(binding.child_run_id), requested_by: z.literal(actor), source_origin: z.literal(manifest.run.source_origin), source_site_uid: z.literal(manifest.run.source_site_uid), resource: z.literal(scope.resource), status: z.enum(["running", "review_ready", "page_limit_reached"]), next_page: z.number().int().min(1).max(1001), retry_after: date.nullable() });
    const run = schema.parse(raw);
    const lease = generic ? z.object({ lease_until: date.nullable() }).parse(raw).lease_until : null;
    const leaseActive = generic ? !!lease && Date.parse(lease) > now() : z.object({ lease_active: z.boolean() }).parse(raw).lease_active;
    if (!generic) {
      if (scope.resource === "attachment") {
        z.object({ parent_context: z.object({ animal_link_id: z.literal(scope.mapping_id), pet_id: z.literal(scope.pet_id), client_id: z.literal(scope.client_id), parent_snapshot_id: z.literal(scope.parent_snapshot_id), parent_observed_head_version: z.literal(scope.parent_head_version), parent_payload_hash: z.literal(scope.parent_payload_hash) }) }).parse(raw);
      } else {
        z.object({ animal_link_id: z.literal(scope.mapping_id), pet_id: z.literal(scope.pet_id), client_id: z.literal(scope.client_id) }).parse(raw);
        const parent = scope.resource === "vaccination" ? "consult" : scope.resource === "prescriptionitem" ? "prescription" : null;
        if (parent) {
          const value = raw as Record<string, unknown>;
          for (const suffix of ["snapshot_id", "payload_hash", "observed_head_version"]) if (value[`${parent}_${suffix}`] !== body[`${parent}_${suffix}`]) throw new Error("Run parent differs from saved scope");
        }
      }
    }
    const blockers: string[] = [];
    if (progress.superseded || items.superseded) blockers.push("This binding has been replaced. Open the current binding.");
    if (!progress.parent_current || !progress.household_current || !items.parent_current || !items.household_current || !items.mapping_matches_manifest || !items.mapping_source_current) blockers.push("The saved source, mapping or household has changed. Review migration scope first.");
    if (run.status !== "running" || run.next_page > 1000) blockers.push(run.status === "review_ready" ? "Traversal has ended. Source coverage still requires review." : "The page limit has been reached. Review incomplete coverage.");
    if (leaseActive) blockers.push("A worker is already processing this run. Check again after it finishes.");
    if (run.retry_after && Date.parse(run.retry_after) > now()) blockers.push("This run is cooling down. Check again after its retry time.");
    return { manifest, binding, body, state: { ...identity, child_run_id: run.id, resource: scope.resource, next_page: run.next_page, status: run.status, retry_after: run.retry_after, lease_active: leaseActive, blockers, source_site_uid: manifest.run.source_site_uid, parent_external_id: scope.parent_external_id, checked_at: new Date(now()).toISOString() } as MigrationResumeState };
  }
  return {
    async recover(identity: MigrationResumeIdentity) { return (await inspect(identity)).state; },
    async resume(reviewed: MigrationResumeState, isCurrent: () => boolean = () => true) {
      if (advancing) throw new Error("This resume request is already in progress");
      advancing = true;
      try {
        const fresh = await inspect(reviewed);
        if (!isCurrent()) throw new Error("Migration selection is no longer active");
        if (fresh.state.child_run_id !== reviewed.child_run_id || fresh.state.next_page !== reviewed.next_page || fresh.state.status !== reviewed.status) throw new Error("Run changed; recover and review its current page");
        if (fresh.state.blockers.length) throw new Error(fresh.state.blockers.join(" "));
        const { data, error } = await transport.invoke(fresh.body); if (error) throw error;
        const response = z.object({ run_id: z.literal(fresh.state.child_run_id), status: z.enum(["running", "review_ready", "page_limit_reached"]), next_page: z.number().int().min(1).max(1001), review_only: z.literal(true) }).parse(data);
        if (response.next_page < fresh.state.next_page) throw new Error("Unconfirmed page response");
        return response;
      } finally { advancing = false; }
    },
  };
}
