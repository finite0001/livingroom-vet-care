import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createMigrationWeightApi } from "../../src/hub/features/imports/migration-weight-api.ts";
function fixture() {
  const actor = randomUUID(), scope = randomUUID(), child = randomUUID();
  const binding = { id: randomUUID(), scope_id: scope, child_run_id: child, actor_id: actor, replaces_id: null, reason: "Synthetic", created_at: "2026-09-14T12:00:00Z", context_hash: "a".repeat(64),
    child_context: { version: 1 as const, run_id: child, owner: actor, source_origin: "https://api.trial.ezyvet.com" as const, source_site_uid: "site", resource: "healthstatus" as const, parent_evidence: "mapping_identity_only" as const, context: {} } };
  const item = { page: 1, ordinal: 0, observed_head_version: null, snapshot_id: randomUUID(), evidence_hash: "b".repeat(64) };
  const approval = { id: randomUUID(), weight_id: randomUUID(), action: "create", approved_at: "2026-09-14T12:00:00Z", snapshot_id: item.snapshot_id, head_version: 1, relationship: "exact_snapshot", source_current: false, local_weight_matches: true, household_current: true };
  const review = { id: randomUUID(), reviewed_at: "2026-09-14T12:00:00.000123Z", snapshot_id: randomUUID(), head_version: 2, relationship: "different_snapshot", source_current: true };
  const page = { version: 1, binding_id: binding.id, scope_id: scope, child_run_id: child, actor_id: actor, page: item.page, snapshot_id: item.snapshot_id, evidence_hash: item.evidence_hash,
    visibility: "approved_patient_weight", observation_head_version: null, historical_head_fidelity: "unknown", approval, reviews: [review], has_more: false, next_cursor: null, complete_coverage_verified: false, observed_at: "2026-09-14T12:00:00Z" };
  return { actor, binding, item, approval, review, page };
}
test("weight evidence keeps snapshot match, unknown head fidelity and acknowledgment separate", async () => {
  const f = fixture(); let params;
  const api = createMigrationWeightApi({ async rpc(name, args) { assert.equal(name, "list_ezyvet_migration_weight_evidence"); params = args; return { data: f.page, error: null }; } }, f.actor);
  assert.deepEqual(await api.list(f.binding, f.item), f.page);
  assert.equal(params.p_evidence_hash, f.item.evidence_hash);
});
test("weight evidence rejects wrong identities, false fidelity and private data", async () => {
  const f = fixture();
  for (const page of [{ ...f.page, actor_id: randomUUID() }, { ...f.page, snapshot_id: randomUUID() }, { ...f.page, binding_id: randomUUID() },
    { ...f.page, observation_head_version: 1 }, { ...f.page, historical_head_fidelity: "exact" }, { ...f.page, complete_coverage_verified: true },
    { ...f.page, approval: { ...f.approval, reason: "Private" } }, { ...f.page, approval: { ...f.approval, relationship: "different_snapshot" } },
    { ...f.page, approval: null }, { ...f.page, reviews: [{ ...f.review, relationship: "exact_snapshot" }] }]) {
    await assert.rejects(() => createMigrationWeightApi({ async rpc() { return { data: page, error: null }; } }, f.actor).list(f.binding, f.item));
  }
});
test("acknowledgment pagination preserves approval and microseconds", async () => {
  const f = fixture(); const cursor = { before_at: f.review.reviewed_at, before_id: f.review.id };
  let page = { ...f.page, has_more: true, next_cursor: cursor };
  const api = createMigrationWeightApi({ async rpc() { return { data: page, error: null }; } }, f.actor);
  assert.deepEqual((await api.list(f.binding, f.item, null, 1)).next_cursor, cursor);
  await assert.rejects(() => api.list(f.binding, f.item, cursor, 1), /cursor differs/);
  page = { ...page, reviews: [{ ...f.review, reviewed_at: "2026-09-14T12:00:00.000122Z" }], has_more: false, next_cursor: null };
  assert.deepEqual((await api.list(f.binding, f.item, cursor, 1)).approval, f.approval);
  page = { ...page, reviews: [f.review, f.review] };
  await assert.rejects(() => api.list(f.binding, f.item), /cursor differs/);
  page = { ...page, reviews: [], has_more: true };
  await assert.rejects(() => api.list(f.binding, f.item), /page differs/);
  page = { ...f.page, next_cursor: cursor };
  await assert.rejects(() => api.list(f.binding, f.item), /continuation differs/);
});
test("weight evidence validates inputs before transport and propagates RPC denial", async () => {
  const f = fixture(); let calls = 0; const error = { code: "42501" };
  const api = createMigrationWeightApi({ async rpc() { calls++; return { data: null, error }; } }, f.actor);
  await assert.rejects(() => api.list(f.binding, { ...f.item, ordinal: 1 }));
  await assert.rejects(() => api.list(f.binding, { ...f.item, observed_head_version: 1 }));
  await assert.rejects(() => api.list(f.binding, f.item, null, 101));
  await assert.rejects(() => api.list(f.binding, f.item, { before_at: "bad", before_id: randomUUID() }));
  assert.equal(calls, 0);
  await assert.rejects(() => api.list(f.binding, f.item), value => value === error);
});
test("unapproved source evidence is explicitly empty", async () => {
  const f = fixture(); const page = { ...f.page, approval: null, reviews: [] };
  assert.deepEqual(await createMigrationWeightApi({ async rpc() { return { data: page, error: null }; } }, f.actor).list(f.binding, f.item), page);
});
