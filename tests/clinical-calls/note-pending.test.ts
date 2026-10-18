import assert from "node:assert/strict";
import test from "node:test";
import { pendingCallNoteSchema, verifyPendingCallNote, callNoteStorageKey, callNoteAttemptActive, inspectCallNoteRecovery } from "../../src/hub/features/clinical/call-drafts/note-pending.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { actor: id(1), pet: id(2), encounter: id(3), source: id(4) };
const reserve = { ...scope, kind: "reserve", id: id(5), request: { source_id: scope.source, expected_version: 2, template_id: id(6), template_version: 1, template_hash: "a".repeat(64), note_policy_version: 1, call_generation_policy_version: 1, attest_authorized: true } };
const verify = (value: unknown) => verifyPendingCallNote(value, scope.actor, scope.pet, scope.encounter, scope.source);
test("call note recovery retains only IDs, versions, approval flags and bounded retry codes", () => {
  assert.deepEqual(verify(reserve), reserve);
  const generate = { ...scope, kind: "generate", id: id(5), intent: { job_id: id(5), attempt_id: id(7), retry_of: null, reason: "", ack_cost: false } };
  assert.deepEqual(verify(generate), generate);
  const review = { ...scope, kind: "review", id: id(8), job: id(5) };
  assert.deepEqual(verify(review), review);
  for (const field of ["transcript", "source_text", "accepted_sections", "review_note", "payload"]) assert.throws(() => verify({ ...review, [field]: "Private clinical text" }));
  assert.throws(() => verify({ ...generate, intent: { ...generate.intent, reason: "Private clinical text" } }));
  assert.throws(() => verify({ ...reserve, request: { ...reserve.request, source_text: "Private clinical text" } }));
});
test("call recovery binds every destination and rejects cross-source reservation or cross-job intent", () => {
  for (const field of ["actor", "pet", "encounter", "source"]) assert.throws(() => verify({ ...reserve, [field]: id(9) }));
  assert.throws(() => verify({ ...reserve, request: { ...reserve.request, source_id: id(9) } }));
  assert.throws(() => verify({ ...scope, kind: "generate", id: id(5), intent: { job_id: id(9), attempt_id: id(7), retry_of: null, reason: "", ack_cost: false } }));
  assert.throws(() => pendingCallNoteSchema.parse({ ...scope, kind: "unknown", id: id(5) }));
});
test("call drafting storage scope and conservative active-lease handling", () => {
  assert.equal(callNoteStorageKey(scope.actor, scope.pet, scope.encounter), `lrv:call-note:${scope.actor}:${scope.pet}:${scope.encounter}`);
  assert.throws(() => callNoteStorageKey("wrong", scope.pet, scope.encounter));
  for (const state of ["claimed", "sending"]) {
    assert.equal(callNoteAttemptActive({ state, lease_until: null }), true);
    assert.equal(callNoteAttemptActive({ state, lease_until: "malformed" }), true);
    assert.equal(callNoteAttemptActive({ state, lease_until: "2999-01-01T00:00:00Z" }), true);
    assert.equal(callNoteAttemptActive({ state, lease_until: "2000-01-01T00:00:00Z" }), false);
  }
  for (const state of ["completed", "failed", "cancelled"]) assert.equal(callNoteAttemptActive({ state, lease_until: "2999-01-01T00:00:00Z" }), false);
});

test("encounter-wide recovery discovers its exact source before another source can open", () => {
 const seen: string[] = [];
 const storage = { getItem(key: string) { seen.push(key); return JSON.stringify(reserve); } };
 assert.deepEqual(inspectCallNoteRecovery(storage, scope.actor, scope.pet, scope.encounter), { value: reserve, invalid: false });
 assert.deepEqual(seen, [callNoteStorageKey(scope.actor, scope.pet, scope.encounter)]);
 assert.deepEqual(inspectCallNoteRecovery({ getItem: () => JSON.stringify({ ...reserve, actor: id(9) }) }, scope.actor, scope.pet, scope.encounter), { value: null, invalid: true });
 assert.deepEqual(inspectCallNoteRecovery({ getItem: () => "invalid" }, scope.actor, scope.pet, scope.encounter), { value: null, invalid: true });
 assert.deepEqual(inspectCallNoteRecovery({ getItem: () => null }, scope.actor, scope.pet, scope.encounter), { value: null, invalid: false });
});
