import test from "node:test";
import assert from "node:assert/strict";
import { createMigrationResumeApi, migrationResumeBody } from "../../src/hub/features/imports/migration-resume-api.ts";
import type { MigrationBinding, MigrationManifest } from "../../src/hub/features/imports/migration-run-api.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = id(1), at = "2026-09-14T12:00:00Z", origin = "https://api.trial.ezyvet.com", site = "Synthetic", hash = "a".repeat(64);
function fixture() {
  const input = { id: id(2), mapping_id: id(3), resource: "attachment", parent_type: "animal", parent_snapshot_id: id(4), parent_head_version: 1, disposition: "required", reason: "Explicit" };
  const scope = { ...input, migration_run_id: id(5), mapping_snapshot_id: id(4), mapping_head_version: 1, client_id: id(6), pet_id: id(7), parent_external_id: "77", parent_payload_hash: hash };
  const manifest = { run: { id: id(5), actor_id: actor, source_origin: origin, source_site_uid: site, intent_hash: hash, created_at: at, intent: { version: 1, source_origin: origin, source_site_uid: site, scopes: [input] } }, scopes: [scope], scope_manifest_version: 1, scope_manifest_hash: hash };
  const binding = { id: id(8), scope_id: scope.id, child_run_id: id(9), actor_id: actor, replaces_id: null, reason: "Owned", context_hash: hash, created_at: at, child_context: { version: 1, run_id: id(9), owner: actor, source_origin: origin, source_site_uid: site, resource: "attachment", parent_evidence: "exact_parent_version", context: {} } };
  const identity = { manifest_id: id(5), scope_id: id(2), binding_id: id(8) };
  const refs = { binding_id: id(8), scope_id: id(2), migration_run_id: id(5), child_run_id: id(9), context_hash: hash, resource: "attachment" };
  const progress = { version: 2, ...refs, superseded: false, parent_evidence: "exact_parent_version", parent_current: true, household_current: true, scan: { status: "running", next_page: 1, pages_observed: 0, traversal_ended: false, page_limit_reached: false, retry_after: null, latest_error_code: null, provider_total: null, complete_coverage_verified: false }, observations: { occurrences: 0, distinct_source_identities: 0, distinct_snapshot_versions: 0, occurrence_fidelity: "page_ordinal", exact_current_occurrences: 0, currentness_available: true }, clinical_review: { reconciled: false, approved_local_outcomes: null }, attempt_history_available: true, attempt_history: { origin: "run_created", started_at: at, complete_since_run_creation: true, claims: 1, failed_pages: 0, staged_pages: 0 }, observed_at: at };
  const items = { version: 1, ...refs, superseded: false, mapping_matches_manifest: true, mapping_source_current: true, parent_current: true, household_current: true, occurrence_fidelity: "page_ordinal", review_reconciled: false, complete_coverage_verified: false, observed_at: at, items: [], has_more: false, next_cursor: null };
  const run = { id: id(9), requested_by: actor, source_origin: origin, source_site_uid: site, resource: "attachment", status: "running", next_page: 1, retry_after: null as string | null, lease_active: false, parent_context: { animal_link_id: id(3), pet_id: id(7), client_id: id(6), parent_snapshot_id: id(4), parent_observed_head_version: 1, parent_payload_hash: hash } };
  const calls: Record<string, unknown>[] = [];
  let active = true;
  const api = createMigrationResumeApi({ async rpc(name) {
    const data = name === "read_ezyvet_migration_run" ? manifest : name === "read_ezyvet_migration_binding" ? binding : name === "read_ezyvet_migration_binding_progress" ? progress : name === "list_ezyvet_migration_items" ? items : name === "recover_ezyvet_attachment_run" ? run : undefined;
    assert.notEqual(data, undefined, `Unexpected RPC ${name}`); return { data, error: active ? null : { code: "42501" } };
  }, async readGenericRun() { throw new Error("Must use owned recovery"); }, async invoke(body) { calls.push(body); return { data: { run_id: id(9), status: "running", next_page: 2, review_only: true }, error: null }; } }, actor, () => Date.parse(at));
  return { api, identity, run, progress, items, calls, manifest, binding, revoke: () => { active = false; } };
}
test("resume rechecks identity and sends only the exact saved attachment request", async () => {
  const f = fixture(), ready = await f.api.recover(f.identity);
  assert.deepEqual(ready.blockers, []); await f.api.resume(ready);
  assert.deepEqual(f.calls, [{ run_id: id(9), resource: "attachment", animal_link_id: id(3) }]);
});
test("active lease, cooldown, source drift and superseded binding never invoke importer", async () => {
  for (const block of [(f: ReturnType<typeof fixture>) => { f.run.lease_active = true; }, (f: ReturnType<typeof fixture>) => { f.run.retry_after = "2026-09-14T12:01:00Z"; }, (f: ReturnType<typeof fixture>) => { f.items.mapping_source_current = false; }, (f: ReturnType<typeof fixture>) => { f.progress.superseded = true; }]) {
    const f = fixture(), reviewed = await f.api.recover(f.identity); block(f);
    assert.ok((await f.api.recover(f.identity)).blockers.length); await assert.rejects(() => f.api.resume(reviewed)); assert.equal(f.calls.length, 0);
  }
});
test("changed page, revoked actor and abandoned UI prevent invocation after preflight", async () => {
  const changed = fixture(), reviewed = await changed.api.recover(changed.identity); changed.run.next_page = 2;
  await assert.rejects(() => changed.api.resume(reviewed), /Run changed/); assert.equal(changed.calls.length, 0);
  const revoked = fixture(), ready = await revoked.api.recover(revoked.identity); revoked.revoke();
  await assert.rejects(() => revoked.api.resume(ready)); assert.equal(revoked.calls.length, 0);
  const abandoned = fixture(); await assert.rejects(() => abandoned.api.resume(reviewed, () => false), /no longer active/); assert.equal(abandoned.calls.length, 0);
});
test("all nine resource bodies preserve fixed child and scoped parent identities", () => {
  const f = fixture();
  for (const resource of ["contact", "animal", "healthstatus", "consult", "history", "vaccination", "prescription", "prescriptionitem", "attachment"] as const) {
    const manifest = { ...f.manifest, scopes: [{ ...f.manifest.scopes[0], resource }] } as MigrationManifest;
    const binding = { ...f.binding, child_context: { ...f.binding.child_context, resource } } as MigrationBinding;
    const body = migrationResumeBody(manifest, binding);
    assert.equal(body.run_id, id(9)); assert.equal(body.resource, resource);
    assert.equal("animal_link_id" in body, !["contact", "animal"].includes(resource));
    const parent = resource === "vaccination" ? "consult" : resource === "prescriptionitem" ? "prescription" : null;
    assert.equal(Object.keys(body).length, (["contact", "animal"].includes(resource) ? 2 : 3) + (parent ? 3 : 0));
    if (parent) { assert.equal(body[`${parent}_snapshot_id`], id(4)); assert.equal(body[`${parent}_observed_head_version`], 1); assert.equal(body[`${parent}_payload_hash`], hash); }
  }
});
test("concurrent resume calls share a single in-flight gate", async () => {
  const f = fixture(), reviewed = await f.api.recover(f.identity);
  const results = await Promise.allSettled([f.api.resume(reviewed), f.api.resume(reviewed)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(results.filter(r => r.status === "rejected").length, 1);
  assert.equal(f.calls.length, 1);
});
