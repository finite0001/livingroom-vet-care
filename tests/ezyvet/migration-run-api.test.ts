import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createMigrationRunApi, parseMigrationManifest, parseMigrationBinding, parseMigrationProgress } from "../../src/hub/features/imports/migration-run-api.ts";
import type { MigrationRequest } from "../../src/hub/features/imports/migration-run-api.ts";

function fixture() {
  const actor = randomUUID(), id = randomUUID();
  const request: MigrationRequest = { id, source_origin: "https://api.trial.ezyvet.com", source_site_uid: "synthetic-site", scopes: [{
    id: randomUUID(), mapping_id: randomUUID(), resource: "attachment", parent_type: "animal", parent_snapshot_id: randomUUID(), parent_head_version: 2, disposition: "required", reason: "Explicit selection",
  }] };
  const summary = { id, source_origin: request.source_origin, source_site_uid: request.source_site_uid, intent_hash: "a".repeat(64), created_at: "2026-09-14T12:00:00.000002+00:00" };
  const manifest = { scope_manifest_version: 1, scope_manifest_hash: "c".repeat(64), run: { ...summary, actor_id: actor, intent: { version: 1, source_origin: request.source_origin, source_site_uid: request.source_site_uid, scopes: request.scopes } },
    scopes: request.scopes.map(scope => ({ ...scope, migration_run_id: id, mapping_snapshot_id: randomUUID(), mapping_head_version: 1, client_id: randomUUID(), pet_id: randomUUID(), parent_external_id: "77", parent_payload_hash: "b".repeat(64) })) };
  return { actor, request, summary, manifest };
}

test("manifest recovery rejects substituted owner, scope version and missing scope", () => {
  const { actor, request, manifest } = fixture();
  assert.deepEqual(parseMigrationManifest(manifest, actor, request.id), manifest);
  assert.throws(() => parseMigrationManifest({ ...manifest, run: { ...manifest.run, actor_id: randomUUID() } }, actor, request.id));
  assert.throws(() => parseMigrationManifest({ ...manifest, scopes: [] }, actor, request.id));
  assert.throws(() => parseMigrationManifest({ ...manifest, scopes: manifest.scopes.map(scope => ({ ...scope, parent_head_version: 3 })) }, actor, request.id));
  assert.throws(() => parseMigrationManifest({ ...manifest, scopes: [manifest.scopes[0], manifest.scopes[0]] }, actor, request.id));
});

test("prepare rejects a coherent response for a different requested site", async () => {
  const { actor, request, manifest } = fixture();
  const substituted = { ...manifest, run: { ...manifest.run, source_site_uid: "other-site", intent: { ...manifest.run.intent, source_site_uid: "other-site" } } };
  const api = createMigrationRunApi({ async rpc() { return { data: substituted, error: null }; } }, actor);
  await assert.rejects(() => api.prepare(request), /intent differs/);
});

test("binding recovery rejects mismatched owner or child descriptor", () => {
  const actor = randomUUID(), child = randomUUID(), scope = randomUUID();
  const binding = { id: randomUUID(), actor_id: actor, scope_id: scope, child_run_id: child, replaces_id: null, reason: "Attempt", context_hash: "a".repeat(64), created_at: "2026-09-14T12:00:00Z",
    child_context: { version: 1, run_id: child, owner: actor, source_origin: "https://api.trial.ezyvet.com", source_site_uid: "site", resource: "attachment", parent_evidence: "exact_parent_version", context: {} } };
  assert.deepEqual(parseMigrationBinding(binding, actor, scope), binding);
  assert.throws(() => parseMigrationBinding({ ...binding, actor_id: randomUUID() }, actor, scope));
  assert.throws(() => parseMigrationBinding({ ...binding, child_run_id: randomUUID() }, actor, scope));
});

test("history retains PostgreSQL microseconds and rejects duplicate, reversed or repeated cursor rows", async () => {
  const { actor, summary } = fixture();
  const second = { ...summary, id: randomUUID(), created_at: "2026-09-14T12:00:00.000001+00:00" };
  let rows = [summary, second];
  const api = createMigrationRunApi({ async rpc() { return { data: { runs: rows, has_more: true }, error: null }; } }, actor);
  const result = await api.list(null, 2);
  assert.deepEqual(result.next_cursor, { before_at: second.created_at, before_id: second.id });
  rows = [summary, summary];
  await assert.rejects(() => api.list(null, 2), /cursor differs/);
  rows = [second, summary];
  await assert.rejects(() => api.list(null, 2), /cursor differs/);
  rows = [summary, second];
  await assert.rejects(() => api.list(result.next_cursor, 2), /cursor differs/);
});

test("invalid page bounds never issue an RPC and server errors are preserved", async () => {
  const { actor } = fixture(); let calls = 0;
  const error = { code: "42501", message: "Active administrator required" };
  const api = createMigrationRunApi({ async rpc() { calls++; return { data: null, error }; } }, actor);
  await assert.rejects(() => api.list(null, 101));
  assert.equal(calls, 0);
  await assert.rejects(() => api.list(), value => value === error);
  assert.equal(calls, 1);
});

test("progress rejects inflated distinct counts, false completion and substituted scope", () => {
  const f = fixture(), child = randomUUID();
  const manifest = parseMigrationManifest(f.manifest, f.actor, f.request.id);
  const binding = parseMigrationBinding({ id: randomUUID(), actor_id: f.actor, scope_id: manifest.scopes[0].id, child_run_id: child, replaces_id: null,
    reason: "Attempt", context_hash: "a".repeat(64), created_at: "2026-09-14T12:00:00Z", child_context: { version: 1, run_id: child, owner: f.actor,
      source_origin: manifest.run.source_origin, source_site_uid: manifest.run.source_site_uid, resource: "attachment", parent_evidence: "exact_parent_version", context: {} } }, f.actor, manifest.scopes[0].id);
  const value = { version: 1, binding_id: binding.id, scope_id: binding.scope_id, migration_run_id: manifest.run.id, child_run_id: child, resource: "attachment", context_hash: binding.context_hash,
    superseded: false, parent_evidence: "exact_parent_version", parent_current: true, household_current: true,
    scan: { status: "review_ready", next_page: 2, pages_observed: 1, traversal_ended: true, page_limit_reached: false, retry_after: null, latest_error_code: null, provider_total: null, complete_coverage_verified: false },
    observations: { occurrences: 2, distinct_source_identities: 1, distinct_snapshot_versions: 1, occurrence_fidelity: "page_ordinal", exact_current_occurrences: 2, currentness_available: true },
    clinical_review: { reconciled: false, approved_local_outcomes: null }, attempt_history_available: false, observed_at: "2026-09-14T12:00:00Z" };
  assert.deepEqual(parseMigrationProgress(value, manifest, binding), value);
  assert.throws(() => parseMigrationProgress({ ...value, observations: { ...value.observations, distinct_source_identities: 3 } }, manifest, binding));
  assert.throws(() => parseMigrationProgress({ ...value, scan: { ...value.scan, complete_coverage_verified: true } }, manifest, binding));
  assert.throws(() => parseMigrationProgress({ ...value, scan: { ...value.scan, status: "page_limit_reached" } }, manifest, binding));
  assert.throws(() => parseMigrationProgress({ ...value, scope_id: randomUUID() }, manifest, binding));
  assert.throws(() => parseMigrationProgress({ ...value, observations: { ...value.observations, exact_current_occurrences: null } }, manifest, binding));
});
