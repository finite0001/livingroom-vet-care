import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createMigrationHistoryApi } from "../../src/hub/features/imports/migration-history-api.ts";
function fixture() {
  const actor = randomUUID(), scope = randomUUID(), child = randomUUID();
  const binding = { id: randomUUID(), scope_id: scope, child_run_id: child, actor_id: actor, replaces_id: null, reason: "Synthetic", created_at: "2026-09-14T12:00:00Z", context_hash: "a".repeat(64),
    child_context: { version: 1 as const, run_id: child, owner: actor, source_origin: "https://api.trial.ezyvet.com" as const, source_site_uid: "site", resource: "history" as const, parent_evidence: "mapping_identity_only" as const, context: {} } };
  const item = { page: 1, ordinal: 0, snapshot_id: randomUUID(), evidence_hash: "b".repeat(64) };
  const receipt = { id: randomUUID(), version: 2, version_hash: "c".repeat(64), approved_at: "2026-09-14T12:00:00Z", relationship: "different_source_version", source_current: false, superseded: true, consult_status: "unresolved", extraction_receipts: 2, locally_edited_receipts: 1 };
  const page = { version: 1, binding_id: binding.id, scope_id: scope, child_run_id: child, actor_id: actor, page: item.page, snapshot_id: item.snapshot_id, evidence_hash: item.evidence_hash,
    visibility: "approved_patient_history", approvals: [receipt], has_more: false, next_before_version: null, discrepancies_assessed: false, complete_coverage_verified: false, observed_at: "2026-09-14T12:00:00Z" };
  return { actor, binding, item, receipt, page };
}
test("history receipts retain source drift, corrections and local edits as separate facts", async () => {
  const f = fixture(); let params;
  const api = createMigrationHistoryApi({ async rpc(name, args) { assert.equal(name, "list_ezyvet_migration_history_evidence"); params = args; return { data: f.page, error: null }; } }, f.actor);
  assert.deepEqual(await api.list(f.binding, f.item), f.page);
  assert.equal(params.p_evidence_hash, f.item.evidence_hash);
});
test("history receipts reject foreign identity, clinical payload leakage and impossible counts", async () => {
  const f = fixture();
  for (const page of [{ ...f.page, actor_id: randomUUID() }, { ...f.page, snapshot_id: randomUUID() }, { ...f.page, binding_id: randomUUID() }, { ...f.page, complete_coverage_verified: true },
    { ...f.page, approvals: [{ ...f.receipt, original: "Private prose" }] }, { ...f.page, approvals: [{ ...f.receipt, locally_edited_receipts: 3 }] }, { ...f.page, next_before_version: 2 }]) {
    const api = createMigrationHistoryApi({ async rpc() { return { data: page, error: null }; } }, f.actor);
    await assert.rejects(() => api.list(f.binding, f.item));
  }
});
test("history version pagination rejects repeats, duplicates and false continuation", async () => {
  const f = fixture(); let page = { ...f.page, has_more: true, next_before_version: 2 };
  const api = createMigrationHistoryApi({ async rpc() { return { data: page, error: null }; } }, f.actor);
  assert.equal((await api.list(f.binding, f.item, null, 1)).next_before_version, 2);
  await assert.rejects(() => api.list(f.binding, f.item, 2, 1), /order differs/);
  page = { ...page, approvals: [{ ...f.receipt, version: 1 }], has_more: false, next_before_version: null };
  assert.equal((await api.list(f.binding, f.item, 2, 1)).approvals[0].version, 1);
  page = { ...page, approvals: [f.receipt, { ...f.receipt, version: 1 }] };
  await assert.rejects(() => api.list(f.binding, f.item), /order differs/);
  page = { ...page, approvals: [], has_more: true };
  await assert.rejects(() => api.list(f.binding, f.item), /page size differs/);
});
test("history receipt reads reject invalid inputs before transport and propagate database denial", async () => {
  const f = fixture(); let calls = 0; const error = { code: "42501" };
  const api = createMigrationHistoryApi({ async rpc() { calls++; return { data: null, error }; } }, f.actor);
  await assert.rejects(() => api.list(f.binding, f.item, 0));
  await assert.rejects(() => api.list(f.binding, { ...f.item, ordinal: 1 }));
  await assert.rejects(() => api.list(f.binding, f.item, null, 101));
  assert.equal(calls, 0);
  await assert.rejects(() => api.list(f.binding, f.item), value => value === error);
});
