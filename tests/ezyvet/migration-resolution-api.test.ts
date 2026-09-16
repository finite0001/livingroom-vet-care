import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createMigrationResolutionApi } from "../../src/hub/features/imports/migration-resolution-api.ts";
import { parseMigrationManifest } from "../../src/hub/features/imports/migration-run-api.ts";
import type { MigrationResolutionRequest } from "../../src/hub/features/imports/migration-resolution-state.ts";

function fixture() {
  const actor = randomUUID(), run = randomUUID(), stamp = "2026-09-16T04:00:00.000002+00:00";
  const input = { id: randomUUID(), mapping_id: randomUUID(), resource: "animal", parent_type: "animal", parent_snapshot_id: randomUUID(), parent_head_version: 2, disposition: "required", reason: "Selected patient" };
  const origin = "https://api.trial.ezyvet.com", site = "synthetic";
  const scope = { ...input, migration_run_id: run, mapping_snapshot_id: randomUUID(), mapping_head_version: 1, client_id: randomUUID(), pet_id: randomUUID(), parent_external_id: "77", parent_payload_hash: "a".repeat(64) };
  const manifest = parseMigrationManifest({ scope_manifest_version: 1, scope_manifest_hash: "b".repeat(64), run: { id: run, actor_id: actor, source_origin: origin, source_site_uid: site, intent_hash: "c".repeat(64), created_at: stamp, intent: { version: 1, source_origin: origin, source_site_uid: site, scopes: [input] } }, scopes: [scope] }, actor, run);
  const target = { kind: "scope" as const, binding_id: null, page: null, ordinal: null, snapshot_id: null, evidence_hash: null };
  const request: MigrationResolutionRequest = { id: randomUUID(), scope_id: scope.id, target_kind: "scope", binding_id: null, page: null, ordinal: null, snapshot_id: null, evidence_hash: null, action: "exclude", reason: "Patient outside selected transfer", expected_context_hash: "d".repeat(64), replaces_id: null };
  const context = { version: 1, manifest_hash: manifest.scope_manifest_hash, source_origin: origin, source_site_uid: site,
    scope: { id: scope.id, migration_run_id: run, resource: scope.resource, disposition: scope.disposition, mapping_id: scope.mapping_id, mapping_snapshot_id: scope.mapping_snapshot_id, mapping_head_version: 1, client_id: scope.client_id, pet_id: scope.pet_id, parent_type: scope.parent_type, parent_snapshot_id: scope.parent_snapshot_id, parent_head_version: 2 },
    binding: { selected_id: null, selected_context_hash: null, current_id: null, current_context_hash: null, child_run_id: null, superseded: false },
    mapping: { current_snapshot_id: scope.mapping_snapshot_id, current_head_version: 1 }, parent: { current_snapshot_id: scope.parent_snapshot_id, current_head_version: 2 },
    local: { client_exists: true, client_version: 2, pet_exists: true, pet_version: 3, household_current: true }, scan: null, observation: null };
  const receipt = { receipt_version: 1, id: request.id, actor_id: actor, migration_run_id: run, scope_id: scope.id, target_kind: request.target_kind, binding_id: null, page: null, ordinal: null, snapshot_id: null, evidence_hash: null, target_key: "e".repeat(64), action: request.action, reason: request.reason, request_hash: "f".repeat(64), reviewed_context: context, reviewed_context_hash: request.expected_context_hash, replaces_id: null, version: 1, record_hash: "a".repeat(64), created_at: stamp };
  const envelope = { version: 1, actor_id: actor, scope_id: scope.id, target, target_key: receipt.target_key, context, context_hash: request.expected_context_hash, latest: null, clinical_approval_performed: false, complete_coverage_verified: false, observed_at: stamp };
  const history = { version: 1, actor_id: actor, scope_id: scope.id, target, target_key: receipt.target_key, resolutions: [{ receipt, superseded: false, context_current: false }], has_more: false, next_cursor: null, clinical_approval_performed: false, complete_coverage_verified: false, observed_at: stamp };
  return { actor, scope, manifest, request, target, context, receipt, envelope, history };
}

test("required scope without a binding can be reviewed and saved without claiming completeness", async () => {
  const f = fixture();
  const api = createMigrationResolutionApi({ async rpc(name, args) {
    if (name === "read_ezyvet_migration_resolution_context") return { data: f.envelope, error: null };
    assert.equal(name, "save_ezyvet_migration_resolution");
    assert.deepEqual(args.p_target, f.target); assert.equal(args.p_expected_context_hash, f.request.expected_context_hash);
    return { data: f.receipt, error: null };
  } }, f.actor, f.manifest);
  assert.deepEqual(await api.context(f.scope.id, f.target), f.envelope);
  assert.deepEqual(await api.save(f.request), f.receipt);
});

test("context rejects another owner, source, patient, extent or unsupported completion claim", async () => {
  const f = fixture();
  const substitutions = [
    { ...f.envelope, actor_id: randomUUID() }, { ...f.envelope, complete_coverage_verified: true },
    { ...f.envelope, context: { ...f.context, source_site_uid: "different" } },
    { ...f.envelope, context: { ...f.context, scope: { ...f.context.scope, pet_id: randomUUID() } } },
    { ...f.envelope, context: { ...f.context, binding: { ...f.context.binding, current_id: randomUUID() } } },
    { ...f.envelope, private_payload: "unexpected" },
  ];
  for (const data of substitutions) {
    await assert.rejects(() => createMigrationResolutionApi({ async rpc() { return { data, error: null }; } }, f.actor, f.manifest).context(f.scope.id, f.target));
  }
});

test("recovery validates the exact original payload and remains available for historical context", async () => {
  const f = fixture();
  const receipt = { ...f.receipt, reviewed_context: { ...f.context, mapping: { current_snapshot_id: randomUUID(), current_head_version: 4 }, local: { ...f.context.local, household_current: false } } };
  const api = createMigrationResolutionApi({ async rpc(name) { assert.equal(name, "read_ezyvet_migration_resolution"); return { data: receipt, error: null }; } }, f.actor, f.manifest);
  assert.deepEqual(await api.recover(f.request), receipt);
  for (const patch of [{ id: randomUUID() }, { reason: "Other reason" }, { action: "reopen" as const }, { expected_context_hash: "a".repeat(64) }, { replaces_id: randomUUID() }]) await assert.rejects(() => api.recover({ ...f.request, ...patch }));
});

test("history preserves microsecond pagination and rejects duplicate or substituted receipts", async () => {
  const f = fixture();
  const second = { ...f.receipt, id: randomUUID(), created_at: "2026-09-16T04:00:00.000001+00:00" };
  const cursor = { before_at: second.created_at, before_id: second.id };
  let data: unknown = { ...f.history, resolutions: [...f.history.resolutions, { receipt: second, superseded: true, context_current: false }], has_more: true, next_cursor: cursor };
  const api = createMigrationResolutionApi({ async rpc() { return { data, error: null }; } }, f.actor, f.manifest);
  assert.deepEqual((await api.history(f.scope.id, f.target, null, 2)).next_cursor, cursor);
  await assert.rejects(() => api.history(f.scope.id, f.target, cursor, 2));
  for (const receipt of [f.receipt, { ...second, scope_id: randomUUID() }, { ...second, target_key: "f".repeat(64) }]) {
    data = { ...f.history, resolutions: [...f.history.resolutions, { receipt, superseded: false, context_current: true }] };
    await assert.rejects(() => api.history(f.scope.id, f.target));
  }
});

test("invalid requests fail before transport and database rejection retains its code", async () => {
  const f = fixture(); let calls = 0; const error = { code: "40001", message: "Evidence changed" };
  const api = createMigrationResolutionApi({ async rpc() { calls++; return { data: null, error }; } }, f.actor, f.manifest);
  await assert.rejects(() => api.save({ ...f.request, page: 1 }));
  await assert.rejects(() => api.save({ ...f.request, action: "reopen" }));
  await assert.rejects(() => api.history(f.scope.id, null, null, 101));
  assert.equal(calls, 0);
  await assert.rejects(() => api.save(f.request), e => e === error);
});

test("observation decision pins its exact occurrence while preserving unknown legacy head", async () => {
  const f = fixture(), bindingId = randomUUID(), snapshotId = randomUUID();
  const target = { kind: "observation" as const, binding_id: bindingId, page: 2, ordinal: 0, snapshot_id: snapshotId, evidence_hash: "a".repeat(64) };
  const context = { ...f.context,
    binding: { selected_id: bindingId, selected_context_hash: "b".repeat(64), current_id: bindingId, current_context_hash: "b".repeat(64), child_run_id: randomUUID(), superseded: false },
    scan: { status: "running", next_page: 3, retry_after: null, error_code: null, attempt_sequence: 3 },
    observation: { page: 2, ordinal: 0, snapshot_id: snapshotId, external_id: "77", payload_hash: "c".repeat(64), observed_head_version: null, file_id: null, raw_record_sha256: null, stable_metadata_sha256: null, evidence_hash: target.evidence_hash, current_snapshot_id: snapshotId, current_head_version: 4 },
  };
  let data: unknown = { ...f.envelope, target, context };
  const api = createMigrationResolutionApi({ async rpc() { return { data, error: null }; } }, f.actor, f.manifest);
  assert.equal((await api.context(f.scope.id, target)).context.observation?.observed_head_version, null);
  for (const patch of [{ page: 3 }, { snapshot_id: randomUUID() }, { evidence_hash: "d".repeat(64) }, { observed_head_version: 4 }, { ordinal: 1 }]) {
    data = { ...f.envelope, target, context: { ...context, observation: { ...context.observation, ...patch } } };
    await assert.rejects(() => api.context(f.scope.id, target));
  }
});
