import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { parseMigrationItems } from "../../src/hub/features/imports/migration-items-api.ts";
import { createMigrationRunApi } from "../../src/hub/features/imports/migration-run-api.ts";

function fixture() {
  const actor = randomUUID(), run = randomUUID(), child = randomUUID(), scopeId = randomUUID(), snapshot = randomUUID();
  const scopeInput = { id: scopeId, mapping_id: randomUUID(), resource: "attachment" as const, parent_type: "animal" as const,
    parent_snapshot_id: randomUUID(), parent_head_version: 1, disposition: "required" as const, reason: "Synthetic coverage" };
  const scope = { ...scopeInput, migration_run_id: run, mapping_snapshot_id: scopeInput.parent_snapshot_id, mapping_head_version: 1,
    client_id: randomUUID(), pet_id: randomUUID(), parent_external_id: "77", parent_payload_hash: "a".repeat(64) };
  const manifest = { run: { id: run, actor_id: actor, source_origin: "https://api.trial.ezyvet.com" as const, source_site_uid: "synthetic-site",
    intent_hash: "a".repeat(64), created_at: "2026-09-14T12:00:00Z", intent: { version: 1 as const, source_origin: "https://api.trial.ezyvet.com" as const, source_site_uid: "synthetic-site", scopes: [scopeInput] } },
    scopes: [scope], scope_manifest_version: 1 as const, scope_manifest_hash: "a".repeat(64) };
  const binding = { id: randomUUID(), actor_id: actor, scope_id: scopeId, child_run_id: child, replaces_id: null, reason: "Synthetic attempt",
    context_hash: "b".repeat(64), created_at: "2026-09-14T12:00:00Z", child_context: { version: 1 as const, run_id: child, owner: actor,
      source_origin: manifest.run.source_origin, source_site_uid: manifest.run.source_site_uid, resource: "attachment" as const, parent_evidence: "exact_parent_version" as const, context: {} } };
  const item = { page: 1, ordinal: 1, snapshot_id: snapshot, observed_head_version: 1, external_id: "701", payload_hash: "a".repeat(64),
    file_id: "42", raw_record_sha256: "b".repeat(64), stable_metadata_sha256: "c".repeat(64), evidence_hash: "d".repeat(64),
    current_snapshot_id: snapshot, current_head_version: 1, payload_current: true, exact_source_current: true };
  const page = { version: 1, binding_id: binding.id, scope_id: scopeId, migration_run_id: run, child_run_id: child, resource: "attachment", context_hash: binding.context_hash,
    superseded: false, mapping_matches_manifest: true, mapping_source_current: true, parent_current: true, household_current: true,
    occurrence_fidelity: "page_ordinal", review_reconciled: false, complete_coverage_verified: false, observed_at: "2026-09-14T12:00:00Z",
    items: [item], has_more: true, next_cursor: { page: 1, ordinal: 1, snapshot_id: snapshot } };
  return { actor, manifest, binding, item, page };
}
test("item pagination retains duplicate snapshots at distinct ordinals", () => {
  const f = fixture();
  assert.deepEqual(parseMigrationItems(f.page, f.manifest, f.binding, null, 1), f.page);
  const second = { ...f.page, items: [{ ...f.item, ordinal: 2, evidence_hash: "e".repeat(64) }], has_more: false, next_cursor: null };
  assert.deepEqual(parseMigrationItems(second, f.manifest, f.binding, f.page.next_cursor, 1), second);
  assert.throws(() => parseMigrationItems(f.page, f.manifest, f.binding, f.page.next_cursor, 1), /cursor differs/);
  assert.throws(() => parseMigrationItems({ ...second, items: [f.item, f.item] }, f.manifest, f.binding, null, 2), /cursor differs/);
  assert.throws(() => parseMigrationItems({ ...f.page, next_cursor: { ...f.page.next_cursor, ordinal: 2 } }, f.manifest, f.binding, null, 1), /continuation differs/);
});
test("item parser rejects false currentness, source substitution and private payloads", () => {
  const f = fixture();
  const changed = { ...f.item, current_head_version: 3, exact_source_current: false };
  assert.doesNotThrow(() => parseMigrationItems({ ...f.page, items: [changed] }, f.manifest, f.binding, null, 1));
  for (const item of [{ ...changed, exact_source_current: true }, { ...f.item, current_head_version: null }, { ...f.item, observed_head_version: null },
    { ...f.item, payload: { private: true } }, { ...f.item, file_id: null }])
    assert.throws(() => parseMigrationItems({ ...f.page, items: [item] }, f.manifest, f.binding, null, 1));
  assert.throws(() => parseMigrationItems({ ...f.page, scope_id: randomUUID() }, f.manifest, f.binding, null, 1), /scope differs/);
  assert.throws(() => parseMigrationItems({ ...f.page, complete_coverage_verified: true }, f.manifest, f.binding, null, 1));
  assert.throws(() => parseMigrationItems({ ...f.page, review_reconciled: true }, f.manifest, f.binding, null, 1));
});
test("item API validates owner, limits and full cursor before issuing a request", async () => {
  const f = fixture(); let calls = 0;
  const error = { code: "42501", message: "Owned migration binding required" };
  const api = createMigrationRunApi({ async rpc() { calls++; return { data: null, error }; } }, f.actor);
  await assert.rejects(() => api.items(f.manifest, f.binding, null, 101));
  await assert.rejects(() => api.items(f.manifest, { ...f.binding, actor_id: randomUUID() }));
  await assert.rejects(() => api.items(f.manifest, f.binding, { page: 1, ordinal: 1 }));
  assert.equal(calls, 0);
  await assert.rejects(() => api.items(f.manifest, f.binding), value => value === error);
  assert.equal(calls, 1);
});

test("legacy item head evidence stays unknown and UUID breaks page cursor ties", () => {
  const f = fixture();
  const manifest = { ...f.manifest, scopes: f.manifest.scopes.map(scope => ({ ...scope, resource: "contact" as const })) };
  const binding = { ...f.binding, child_context: { ...f.binding.child_context, resource: "contact" as const } };
  const first = { ...f.item, ordinal: 0, snapshot_id: "00000000-0000-4000-8000-000000000001", current_snapshot_id: "00000000-0000-4000-8000-000000000001",
    observed_head_version: null, exact_source_current: null, file_id: null, raw_record_sha256: null, stable_metadata_sha256: null };
  const second = { ...first, snapshot_id: "00000000-0000-4000-8000-000000000002", current_snapshot_id: "00000000-0000-4000-8000-000000000002" };
  const page = { ...f.page, resource: "contact", occurrence_fidelity: "deduplicated_page_snapshot", items: [first, second], has_more: false, next_cursor: null };
  assert.doesNotThrow(() => parseMigrationItems(page, manifest, binding, null, 2));
  assert.throws(() => parseMigrationItems({ ...page, items: [second, first] }, manifest, binding, null, 2), /cursor differs/);
  assert.throws(() => parseMigrationItems({ ...page, items: [{ ...first, exact_source_current: true }] }, manifest, binding, null, 2), /evidence differs/);
});
