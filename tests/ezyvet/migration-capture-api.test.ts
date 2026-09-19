import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createMigrationCaptureApi } from "../../src/hub/features/imports/migration-capture-api.ts";
function fixture() {
  const actor = randomUUID(), scope = randomUUID(), child = randomUUID();
  const binding = { id: randomUUID(), scope_id: scope, child_run_id: child, actor_id: actor, replaces_id: null, reason: "Synthetic", created_at: "2026-09-14T12:00:00Z", context_hash: "a".repeat(64),
    child_context: { version: 1 as const, run_id: child, owner: actor, source_origin: "https://api.trial.ezyvet.com" as const, source_site_uid: "site", resource: "attachment" as const, parent_evidence: "exact_parent_version" as const, context: {} } };
  const item = { page: 1, ordinal: 1, snapshot_id: randomUUID(), evidence_hash: "b".repeat(64) };
  const receipt = { request_id: randomUUID(), created_at: "2026-09-14T12:00:00.000002Z", status: "ready", relationship: "exact_occurrence", source_current: true, retry_after: null, latest_error_code: null,
    capture: { id: randomUUID(), capture_hash: "c".repeat(64), content_sha256: "d".repeat(64), mime_type: "application/pdf", file_size: 12, captured_at: "2026-09-14T12:00:00Z" },
    approved_versions: 1, canceled_unconfirmed_decisions: 1, latest_approval: { id: randomUUID(), version: 1, record_hash: "e".repeat(64), created_at: "2026-09-14T12:00:00Z", superseded: false } };
  const page = { version: 1, binding_id: binding.id, scope_id: scope, child_run_id: child, actor_id: actor, ...item, ownership: "current_actor_only", captures: [receipt], has_more: false, next_cursor: null, original_bytes_reverified: false, complete_coverage_verified: false, observed_at: "2026-09-14T12:00:00Z" };
  return { actor, binding, item, receipt, page };
}
test("capture evidence keeps canceled decisions separate from approved versions", async () => {
  const f = fixture(); const api = createMigrationCaptureApi({ async rpc() { return { data: f.page, error: null }; } }, f.actor);
  assert.deepEqual(await api.list(f.binding, f.item), f.page);
});
test("capture evidence rejects substituted owner, observation, private fields and impossible states", async () => {
  const f = fixture();
  for (const page of [{ ...f.page, actor_id: randomUUID() }, { ...f.page, ordinal: 2 }, { ...f.page, original_bytes_reverified: true },
    { ...f.page, captures: [{ ...f.receipt, lease_id: randomUUID() }] }, { ...f.page, captures: [{ ...f.receipt, capture: null }] },
    { ...f.page, captures: [{ ...f.receipt, status: "prepared" }] }, { ...f.page, captures: [{ ...f.receipt, approved_versions: 0 }] }]) {
    const api = createMigrationCaptureApi({ async rpc() { return { data: page, error: null }; } }, f.actor);
    await assert.rejects(() => api.list(f.binding, f.item));
  }
});
test("capture evidence honors microsecond pagination and propagates errors", async () => {
  const f = fixture(); let page = { ...f.page, has_more: true, next_cursor: { before_at: f.receipt.created_at, before_id: f.receipt.request_id } };
  const api = createMigrationCaptureApi({ async rpc() { return { data: page, error: null }; } }, f.actor);
  const first = await api.list(f.binding, f.item, null, 1);
  await assert.rejects(() => api.list(f.binding, f.item, first.next_cursor, 1), /cursor differs/);
  const older = { ...f.receipt, request_id: randomUUID(), created_at: "2026-09-14T12:00:00.000001Z" };
  page = { ...page, captures: [older], has_more: false, next_cursor: null };
  assert.equal((await api.list(f.binding, f.item, first.next_cursor, 1)).captures[0].request_id, older.request_id);
  let calls = 0; const error = { code: "42501" };
  const failing = createMigrationCaptureApi({ async rpc() { calls++; return { data: null, error }; } }, f.actor);
  await assert.rejects(() => failing.list(f.binding, f.item, null, 101)); assert.equal(calls, 0);
  await assert.rejects(() => failing.list(f.binding, f.item), value => value === error);
});
