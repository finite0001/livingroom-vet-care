import { test } from "node:test";
import assert from "node:assert/strict";
import { beginResolutionRecovery, beginResolutionSave, emptyResolutionState, resolutionConfirmed, resolutionRecoveryAbsent, resolutionRecoveryFailed, resolutionSaveFailed } from "../../src/hub/features/imports/migration-resolution-state.ts";
import type { MigrationResolutionRequest } from "../../src/hub/features/imports/migration-resolution-state.ts";

function request(): MigrationResolutionRequest {
  return { id: "decision-1", scope_id: "scope-1", target_kind: "scope", binding_id: null, page: null, ordinal: null, snapshot_id: null, evidence_hash: null, action: "exclude", reason: "Outside the selected migration", expected_context_hash: "reviewed-context", replaces_id: null };
}
const reply = { actor: "admin-1", targetKey: "scope-1", requestId: "decision-1" };
const initial = () => emptyResolutionState(reply.actor, reply.targetKey);

test("lost save response requires recovery and retry keeps exact original request", () => {
  const input = request();
  let state = beginResolutionSave(initial(), input);
  input.reason = "Changed after submission";
  assert.equal(state.request?.reason, "Outside the selected migration");
  assert.ok(Object.isFrozen(state.request));
  state = resolutionSaveFailed(state, reply, new Error("Connection lost"));
  assert.equal(state.phase, "uncertain");
  const changed = { ...request(), id: "decision-2", action: "reopen" as const, expected_context_hash: "new-source" };
  assert.equal(beginResolutionSave(state, changed), state);
  state = beginResolutionRecovery(state);
  assert.equal(beginResolutionSave(state, changed), state);
  state = resolutionRecoveryAbsent(state, reply);
  state = beginResolutionSave(state, changed);
  assert.equal(state.phase, "saving");
  assert.deepEqual(state.request, request());
  assert.equal(resolutionConfirmed(state, reply).phase, "editable");
});

test("unavailable recovery never unlocks the draft, even on an authorization error", () => {
  let state = resolutionSaveFailed(beginResolutionSave(initial(), request()), reply, { message: "Response invalid" });
  state = beginResolutionRecovery(state);
  state = resolutionRecoveryFailed(state, reply);
  assert.equal(state.phase, "uncertain");
  assert.deepEqual(state.request, request());
  assert.equal(resolutionRecoveryAbsent(state, reply), state);
});

test("confirmed database rejection permits a fresh reviewed request; other errors remain uncertain", () => {
  for (const code of ["23514", "40001", "42501"]) {
    const state = resolutionSaveFailed(beginResolutionSave(initial(), request()), reply, { code });
    assert.deepEqual(state, initial());
  }
  for (const error of [null, new Error("Invalid receipt"), { code: "504" }, { code: "23505" }]) {
    assert.equal(resolutionSaveFailed(beginResolutionSave(initial(), request()), reply, error).phase, "uncertain");
  }
});

test("late replies after actor or target change cannot release another draft", () => {
  const saving = beginResolutionSave(initial(), request());
  for (const stale of [{ ...reply, actor: "admin-2" }, { ...reply, targetKey: "other-scope" }, { ...reply, requestId: "old-decision" }]) {
    assert.equal(resolutionConfirmed(saving, stale), saving);
    assert.equal(resolutionSaveFailed(saving, stale, { code: "40001" }), saving);
    const recovering = beginResolutionRecovery(resolutionSaveFailed(saving, reply, null));
    assert.equal(resolutionRecoveryAbsent(recovering, stale), recovering);
    assert.equal(resolutionConfirmed(recovering, stale), recovering);
  }
  assert.deepEqual(resolutionConfirmed(initial(), reply), initial());
});

test("duplicate submission and repeated recovery clicks preserve one pending operation", () => {
  const saving = beginResolutionSave(initial(), request());
  assert.equal(beginResolutionSave(saving, { ...request(), id: "duplicate" }), saving);
  assert.equal(beginResolutionRecovery(saving), saving);
  const recovering = beginResolutionRecovery(resolutionSaveFailed(saving, reply, null));
  assert.equal(beginResolutionRecovery(recovering), recovering);
  assert.equal(resolutionConfirmed(recovering, reply).request, null);
});

test("retry rejection cannot discard an original write that may commit after an absent recovery", () => {
  for (const code of ["42501", "40001", "23514"]) {
    let state = resolutionSaveFailed(beginResolutionSave(initial(), request()), reply, new Error("Timeout"));
    state = resolutionRecoveryAbsent(beginResolutionRecovery(state), reply);
    state = beginResolutionSave(state, request());
    state = resolutionSaveFailed(state, reply, { code });
    assert.equal(state.phase, "uncertain");
    assert.deepEqual(state.request, request());
    assert.equal(resolutionConfirmed(beginResolutionRecovery(state), reply).phase, "editable");
  }
});
