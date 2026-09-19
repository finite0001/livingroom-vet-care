import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createMigrationPrescriptionItemApi } from "../../src/hub/features/imports/migration-prescription-item-api.ts";
function fixture() {
  const actor = randomUUID(), scope = randomUUID(), child = randomUUID();
  const binding = { id: randomUUID(), scope_id: scope, child_run_id: child, actor_id: actor, replaces_id: null, reason: "Synthetic", created_at: "2026-09-14T12:00:00Z", context_hash: "a".repeat(64),
    child_context: { version: 1 as const, run_id: child, owner: actor, source_origin: "https://api.trial.ezyvet.com" as const, source_site_uid: "site", resource: "prescriptionitem" as const, parent_evidence: "exact_parent_version" as const, context: {} } };
  const item = { page: 1, ordinal: 0, snapshot_id: randomUUID(), evidence_hash: "b".repeat(64) };
  const receipt = { id: randomUUID(), version: 2, version_hash: "c".repeat(64), approved_at: "2026-09-14T12:00:00Z", parent_matches: true, exact_occurrence: true, identity_observations: 2, matching_source_observations: 2,
    disposition: "selected", start_date_status: "unknown", catalog_matched: false, source_current: false, superseded: true,
    replaces_id: randomUUID(), completeness: "partial" };
  const page = { version: 1, binding_id: binding.id, scope_id: scope, child_run_id: child, actor_id: actor, page: item.page, snapshot_id: item.snapshot_id, evidence_hash: item.evidence_hash,
    visibility: "approved_patient_prescription_item", approvals: [receipt], has_more: false, next_before_version: null, local_prescribing_verified: false, complete_coverage_verified: false, observed_at: "2026-09-14T12:00:00Z" };
  return { actor, binding, item, receipt, page };
}
test("prescription receipts retain source drift, corrections and unknown interpretation as separate facts", async () => {
  const f = fixture(); let params;
  const api = createMigrationPrescriptionItemApi({ async rpc(name, args) { assert.equal(name, "list_ezyvet_migration_prescription_item_evidence"); params = args; return { data: f.page, error: null }; } }, f.actor);
  assert.deepEqual(await api.list(f.binding, f.item), f.page);
  assert.equal(params.p_evidence_hash, f.item.evidence_hash);
});
test("prescription receipts reject foreign identity, clinical payload leakage and false administration claims", async () => {
  const f = fixture();
  for (const page of [{ ...f.page, actor_id: randomUUID() }, { ...f.page, snapshot_id: randomUUID() }, { ...f.page, binding_id: randomUUID() }, { ...f.page, complete_coverage_verified: true },
    { ...f.page, approvals: [{ ...f.receipt, original: "Private prose" }] }, { ...f.page, local_prescribing_verified: true }, { ...f.page, item_coverage_verified: true }, { ...f.page, approvals: [{ ...f.receipt, outside_status: "given_here" }] }, { ...f.page, approvals: [{ ...f.receipt, replaces_id: null }] }, { ...f.page, next_before_version: 2 }]) {
    const api = createMigrationPrescriptionItemApi({ async rpc() { return { data: page, error: null }; } }, f.actor);
    await assert.rejects(() => api.list(f.binding, f.item));
  }
});
test("prescription version pagination rejects repeats, duplicates and false continuation", async () => {
  const f = fixture(); let page = { ...f.page, has_more: true, next_before_version: 2 };
  const api = createMigrationPrescriptionItemApi({ async rpc() { return { data: page, error: null }; } }, f.actor);
  assert.equal((await api.list(f.binding, f.item, null, 1)).next_before_version, 2);
  await assert.rejects(() => api.list(f.binding, f.item, 2, 1), /order differs/);
  page = { ...page, approvals: [{ ...f.receipt, version: 1, replaces_id: null }], has_more: false, next_before_version: null };
  assert.equal((await api.list(f.binding, f.item, 2, 1)).approvals[0].version, 1);
  page = { ...page, approvals: [f.receipt, { ...f.receipt, version: 1, replaces_id: null }] };
  await assert.rejects(() => api.list(f.binding, f.item), /order differs/);
  page = { ...page, approvals: [], has_more: true };
  await assert.rejects(() => api.list(f.binding, f.item), /page size differs/);
});
test("prescription receipt reads reject invalid inputs before transport and propagate database denial", async () => {
  const f = fixture(); let calls = 0; const error = { code: "42501" };
  const api = createMigrationPrescriptionItemApi({ async rpc() { calls++; return { data: null, error }; } }, f.actor);
  await assert.rejects(() => api.list(f.binding, f.item, 0));
  await assert.rejects(() => api.list(f.binding, { ...f.item, ordinal: 1 }));
  await assert.rejects(() => api.list(f.binding, f.item, null, 101));
  assert.equal(calls, 0);
  await assert.rejects(() => api.list(f.binding, f.item), value => value === error);
});

test("item disposition rejects contradictions and preserves omission and source drift", async () => {
  const f = fixture();
  let row = f.receipt;
  const api = createMigrationPrescriptionItemApi({ async rpc() { return { data: { ...f.page, approvals: [row] }, error: null }; } }, f.actor);
  for (const change of [
    { matching_source_observations: 3 }, { matching_source_observations: 0 },
    { disposition: "not_observed" }, { start_date_status: null }, { catalog_matched: null },
    { disposition: "omitted", start_date_status: null },
    { disposition: "different_source_version", exact_occurrence: false, matching_source_observations: 0 },
  ]) {
    row = { ...f.receipt, ...change };
    await assert.rejects(() => api.list(f.binding, f.item), /disposition differs/);
  }
  for (const change of [
    { disposition: "omitted", start_date_status: null, catalog_matched: null },
    { disposition: "different_source_version", exact_occurrence: false, matching_source_observations: 0, start_date_status: null, catalog_matched: null },
    { disposition: "not_observed", exact_occurrence: false, identity_observations: 0, matching_source_observations: 0, start_date_status: null, catalog_matched: null },
  ]) {
    row = { ...f.receipt, ...change };
    assert.deepEqual((await api.list(f.binding, f.item)).approvals[0], row);
  }
});

test("item start date preserves an explicitly uninterpreted source date", async () => {
  const f = fixture();
  const api = createMigrationPrescriptionItemApi({ async rpc() { return { data: { ...f.page, approvals: [{ ...f.receipt, start_date_status: "uninterpreted" }] }, error: null }; } }, f.actor);
  assert.equal((await api.list(f.binding, f.item)).approvals[0].start_date_status, "uninterpreted");
});
