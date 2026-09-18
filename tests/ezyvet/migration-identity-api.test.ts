import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createMigrationIdentityApi } from "../../src/hub/features/imports/migration-identity-api.ts";
function fixture(resource = "animal") {
  const actor = randomUUID(), scope = randomUUID(), child = randomUUID(), at = "2026-09-16T04:00:00Z";
  const binding = { id: randomUUID(), scope_id: scope, child_run_id: child, actor_id: actor, replaces_id: null, reason: "Synthetic", created_at: at, context_hash: "a".repeat(64),
    child_context: { version: 1 as const, run_id: child, owner: actor, source_origin: "https://api.trial.ezyvet.com" as const, source_site_uid: "site", resource, parent_evidence: "selected_identity_filter" as const, context: {} } };
  const item = { page: 1, ordinal: 0, observed_head_version: null, snapshot_id: randomUUID(), evidence_hash: "b".repeat(64) };
  const result = { version: 1, binding_id: binding.id, scope_id: scope, child_run_id: child, actor_id: actor, resource, page: item.page, snapshot_id: item.snapshot_id, evidence_hash: item.evidence_hash,
    visibility: "approved_identity_mapping", observation_head_available: false, exact_source_version_verified: false, complete_coverage_verified: false, observed_at: at,
    approval: { id: randomUUID(), approved_at: at, action: "link", relationship: "same_snapshot_unknown_observed_head", source_current: true, local_record_unchanged: false, household_current: true } };
  return { actor, binding, item, result };
}
test("identity evidence preserves unknown observed version and local edits for both resources", async () => {
  for (const resource of ["contact", "animal"]) {
    const f = fixture(resource);
    const api = createMigrationIdentityApi({ async rpc(name, args) { assert.equal(name, "read_ezyvet_migration_identity_evidence"); assert.equal(args.p_evidence_hash, f.item.evidence_hash); return { data: f.result, error: null }; } }, f.actor);
    assert.deepEqual(await api.read(f.binding, f.item), f.result);
  }
});
test("identity evidence rejects foreign responses, private prose and unsupported exactness claims", async () => {
  const f = fixture();
  for (const result of [{ ...f.result, actor_id: randomUUID() }, { ...f.result, binding_id: randomUUID() }, { ...f.result, snapshot_id: randomUUID() }, { ...f.result, resource: "contact" },
    { ...f.result, exact_source_version_verified: true }, { ...f.result, observation_head_available: true }, { ...f.result, complete_coverage_verified: true },
    { ...f.result, approval: { ...f.result.approval, reason: "Private review reason" } }, { ...f.result, approval: { ...f.result.approval, relationship: "exact_source_version" } }]) {
    const api = createMigrationIdentityApi({ async rpc() { return { data: result, error: null }; } }, f.actor);
    await assert.rejects(() => api.read(f.binding, f.item));
  }
});
test("identity evidence rejects malformed requests before transport and propagates denial", async () => {
  const f = fixture(); let calls = 0; const error = { code: "42501" };
  const api = createMigrationIdentityApi({ async rpc() { calls++; return { data: null, error }; } }, f.actor);
  for (const item of [{ ...f.item, page: 0 }, { ...f.item, ordinal: 1 }, { ...f.item, observed_head_version: 1 }, { ...f.item, evidence_hash: "bad" }]) await assert.rejects(() => api.read(f.binding, item));
  assert.equal(calls, 0);
  await assert.rejects(() => api.read(f.binding, f.item), value => value === error);
});
