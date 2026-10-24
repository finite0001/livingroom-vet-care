import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyPreparedReview, reviewNumericTextBytes } from "../../src/hub/features/controlled-drugs/record-review/prepared-packet.ts";
import { createReviewLifecycle } from "../../src/hub/features/controlled-drugs/record-review/lifecycle.ts";
import type { ReviewRawRpc, ReviewRpc, ReviewIdentity } from "../../src/hub/features/controlled-drugs/record-review/raw-rpc.ts";
import { ExactJsonNumber, type ExactJson } from "../../src/hub/features/controlled-drugs/record-review/exact-json.ts";
import { actor, operation, other, policy, request, identity, fixture, syntheticEvidence, raw, deferred, memoryPointers } from "./record-review-lifecycle-fixture.ts";

test("prepared packet preserves bigint/decimal evidence and immutable exact request, without hashing packet", async () => {
  const f = await fixture();
  const p = await verifyPreparedReview(f.pointer, f.prepared(), syntheticEvidence, () => {}, request);
  assert.equal(String(p.data.packet.target.sequence), "9223372036854775807");
  assert.equal(String(p.data.packet.event.quantity), "0.123456789012345678901234567890");
  assert.ok(Object.isFrozen(p.data.packet.event) && Object.isFrozen(p.data.request));
  assert.equal(p.data.packet.clinical_snapshot.recorded_at, "2010-01-01T00:00:00Z");
  assert.throws(() => JSON.stringify(p));
});
test("packet byte admission counts PostgreSQL decimal expansion without floating point or huge allocation", async () => {
  for (const [token, bytes] of [["1e-10000", 10002n], ["1e10000", 10001n], ["-1.2300e2", 7n], ["0.000", 5n],
    ["-0e1000000000", 1n], ["-0.000e-2", 7n], ["0.00120e2", 5n], ["9007199254740993.00000", 22n]] as const)
    assert.equal(reviewNumericTextBytes(new ExactJsonNumber(token)), bytes, token);
  assert.ok(reviewNumericTextBytes(new ExactJsonNumber("1e" + "9".repeat(100))) > 1048576n);
  const f = await fixture();
  const oversized = f.encode().replace("0.123456789012345678901234567890", "1e-1048576");
  let sourceCalled = false;
  await assert.rejects(verifyPreparedReview(f.pointer, raw(oversized), { validate() { sourceCalled = true; } }, () => {}));
  assert.equal(sourceCalled, false);
});
test("prepared envelope rejects extra keys, target/config/actor/meaning drift and invalid TTL", async () => {
  const changes = [
    f => { f.value.extra = true; }, f => { f.value.data.extra = true; }, f => { f.value.data.packet.extra = true; },
    f => { f.value.data.packet.target.event_id = other; }, f => { f.value.data.packet.target.original_actor_id = actor; },
    f => { f.value.data.packet.adapter.target.record_hash = "0".repeat(64); },
    f => { f.value.data.packet.current_authorization.read.actor_id = other; },
    f => { f.value.data.packet.current_authorization.policy.id = other; },
    f => { f.value.data.packet.current_authorization.review.roles = ["TECH", "DVM"]; },
    f => { f.value.data.packet.meaning_text = "Physical witness"; },
    f => { f.value.data.expires_at = "2026-10-23T12:15:00.123457Z"; },
    f => { f.value.data.created_at = "2026-02-30T12:00:00.123456Z"; },
    f => { f.value.data.request.reason = "Different reason"; },
    f => { f.value.data.transport_digest = "0".repeat(64); },
  ];
  for (const change of changes) {
    const f = await fixture(); change(f);
    await assert.rejects(verifyPreparedReview(f.pointer, f.prepared(), syntheticEvidence, () => {}, request));
  }
  const f = await fixture();
  await assert.rejects(verifyPreparedReview(f.pointer, f.value, syntheticEvidence, () => {}, request)); // SDK-number path
  await assert.rejects(verifyPreparedReview(f.pointer, raw(f.encode().replaceAll("9223372036854775807", '"9223372036854775807"')), syntheticEvidence, () => {}));
});
test("full source admission is mandatory, rejects duplicate/unknown source rows and observes session changes after await", async () => {
  const f = await fixture();
  await assert.rejects(verifyPreparedReview(f.pointer, f.prepared(), undefined!, () => {}));
  f.value.data.packet.source_rows.push({ relation: "public.unexpected", key: { id: other }, row: {} });
  await assert.rejects(verifyPreparedReview(f.pointer, f.prepared(), syntheticEvidence, () => {}));
  const clean = await fixture(), entered = deferred<void>(), release = deferred<void>(); let current = true;
  const pending = verifyPreparedReview(clean.pointer, clean.prepared(), { async validate() { entered.resolve(); await release.promise; } },
    () => { if (!current) throw new Error("Obsolete session"); });
  await entered.promise; current = false; release.resolve();
  await assert.rejects(pending, /Obsolete session/);
});
function harness(rpc: ReviewRawRpc, backing = memoryPointers()) {
  const model = createReviewLifecycle({ pointers: backing.pointers, rpc, evidence: syntheticEvidence });
  model.setIdentity(identity);
  return { model, ...backing };
}
test("persist before prepare; packet review and a later explicit confirm are separate; execute contains only owned UUIDs", async () => {
  const f = await fixture(), backing = memoryPointers(), calls: ReviewRpc[] = [];
  const { model } = harness({ async call(method, req) {
    calls.push(method); assert.deepEqual(backing.pointers.read(actor), f.pointer);
    if (method === "prepare_controlled_record_review_v3") { assert.deepEqual(req, request); return f.prepared(); }
    assert.equal(method, "execute_controlled_record_review_v3");
    assert.deepEqual(req, { actor_id: actor, operation_id: operation }); return f.saved();
  } }, backing);
  await model.prepare(request);
  assert.equal(model.getSnapshot().phase, "review"); assert.equal(calls.length, 1);
  await assert.rejects(model.confirm(), /Review the prepared/);
  model.acknowledgeReview(model.getSnapshot().prepared!); assert.equal(calls.length, 1);
  await model.confirm(); assert.equal(model.getSnapshot().phase, "resolved");
  assert.equal(model.getSnapshot().outcome?.state, "saved"); assert.equal(backing.values.size, 0);
  await assert.rejects(model.confirm()); assert.equal(calls.length, 2);
  model.startAnother(); assert.equal(model.getSnapshot().phase, "idle");
});
test("unavailable storage or source validator cannot send a signing mutation", async () => {
  let calls = 0;
  const { model, options } = harness({ async call() { calls++; throw new Error("Must not send"); } }, memoryPointers({ failWrite: true }));
  await model.prepare(request); assert.equal(calls, 0); assert.equal(model.getSnapshot().phase, "attention");
  options.failWrite = false; model.reloadRecovery(); assert.equal(model.getSnapshot().phase, "idle");
  const f = await fixture(), second = createReviewLifecycle({ pointers: memoryPointers().pointers, rpc: { async call() { calls++; return f.prepared(); } }, evidence: undefined! });
  second.setIdentity(identity); await second.prepare(request);
  assert.equal(second.getSnapshot().phase, "unknown"); await assert.rejects(second.confirm()); assert.equal(calls, 1);
});
test("losing reservation recovers winner and never submits candidate", async () => {
  const f = await fixture(), backing = memoryPointers(); await backing.pointers.reserve(f.pointer);
  let calls = 0; const { model } = harness({ async call() { calls++; return f.saved(); } }, backing);
  // Simulate another tab reserving between initial idle snapshot and prepare.
  model.setIdentity(null); backing.values.clear(); model.setIdentity(identity); await backing.pointers.reserve(f.pointer);
  await model.prepare({ ...request, operation_id: other });
  assert.equal(calls, 0); assert.equal(model.getSnapshot().phase, "recoverable");
  assert.deepEqual(model.getSnapshot().pointer, f.pointer);
});
test("lost response and read not_found retain original UUID until explicit owned cancellation", async () => {
  const f = await fixture(), calls: ReviewRpc[] = [];
  const { model, values } = harness({ async call(method) {
    calls.push(method);
    if (method === "prepare_controlled_record_review_v3") throw new Error("Private synthetic error");
    return method === "read_controlled_record_review_v3" ? raw({ version: 3, state: "not_found", data: { operation_id: operation } }) : f.cancelled();
  } });
  await model.prepare(request); assert.equal(model.getSnapshot().phase, "unknown");
  assert.ok(!model.getSnapshot().message?.includes("Private"));
  await assert.rejects(model.prepare({ ...request, operation_id: other }));
  await model.recover(); assert.equal(model.getSnapshot().operationState, "not_found"); assert.equal(values.size, 1);
  assert.throws(() => model.reloadRecovery()); assert.throws(() => model.startAnother());
  await model.cancel(); assert.equal(model.getSnapshot().outcome?.state, "cancelled"); assert.equal(values.size, 0);
  assert.deepEqual(calls, ["prepare_controlled_record_review_v3", "read_controlled_record_review_v3", "cancel_controlled_record_review_v3"]);
});
test("saved wins cancellation; storage cleanup failure preserves receipt and retries cleanup only", async () => {
  const f = await fixture(), backing = memoryPointers({ failRemove: true }); let calls = 0;
  await backing.pointers.reserve(f.pointer);
  const { model } = harness({ async call(method) { calls++; assert.equal(method, "cancel_controlled_record_review_v3"); return f.saved(); } }, backing);
  await model.cancel(); assert.equal(model.getSnapshot().outcome?.state, "saved");
  assert.equal(model.getSnapshot().cleanupPending, true); assert.throws(() => model.startAnother());
  await assert.rejects(model.cancel()); await assert.rejects(model.confirm());
  backing.options.failRemove = false; await model.cleanup();
  assert.equal(model.getSnapshot().cleanupPending, false); assert.equal(calls, 1); assert.equal(backing.values.size, 0);
});
test("confirmed cleanup serializes local activation and tolerates another tab's completed removal", async () => {
  const f = await fixture(), backing = memoryPointers(), entered = deferred<void>(), release = deferred<void>();
  await backing.pointers.reserve(f.pointer); let removals = 0;
  const model = createReviewLifecycle({ evidence: syntheticEvidence, rpc: { async call() { return f.saved(); } },
    pointers: { ...backing.pointers, async resolve(pointer, outcome) {
      removals++; entered.resolve(); await release.promise; return backing.pointers.resolve(pointer, outcome);
    } } });
  model.setIdentity(identity); const recovering = model.recover(); await entered.promise;
  assert.equal(model.getSnapshot().phase, "resolved"); assert.equal(model.getSnapshot().outcome?.state, "saved");
  await assert.rejects(model.cleanup(), /Wait/); assert.throws(() => model.startAnother());
  // A competing tab has the same verified saved commitment and clears first.
  await backing.pointers.resolve(f.pointer, f.saved()); release.resolve(); await recovering;
  assert.equal(removals, 1); assert.equal(model.getSnapshot().cleanupPending, false);
});
test("actor/session invalidation across digest and reservation prevents mutation and preserves old actor pointer", async () => {
  const f = await fixture(), digest = deferred<string>(), backing = memoryPointers(); let calls = 0;
  const rpc = { async call() { calls++; return f.prepared(); } };
  const model = createReviewLifecycle({ pointers: backing.pointers, rpc, evidence: syntheticEvidence, digest: () => digest.promise });
  model.setIdentity(identity); const pending = model.prepare(request); model.setIdentity({ ...identity, actorId: other });
  digest.resolve(f.pointer.transport_digest); await pending;
  assert.equal(calls, 0); assert.equal(backing.values.size, 0); assert.equal(model.getSnapshot().phase, "idle");
  const reserved = deferred<void>(), release = deferred<void>();
  const pointers = { ...backing.pointers, async reserve(input) {
    const value = await backing.pointers.reserve(input); reserved.resolve(); await release.promise; return value;
  } };
  const second = createReviewLifecycle({ pointers, rpc, evidence: syntheticEvidence }); second.setIdentity(identity);
  const p = second.prepare(request); await reserved.promise; second.setIdentity({ ...identity, sessionId: other, generation: 2 });
  release.resolve(); await p; assert.equal(calls, 0); assert.equal(backing.values.size, 1);
  assert.equal(second.getSnapshot().phase, "recoverable"); assert.equal(second.getSnapshot().prepared, undefined);
});
test("new session may recover saved receipt without packet/current signing validator; old response is discarded", async () => {
  const f = await fixture(), response = deferred<ExactJson>(), started = deferred<void>(), backing = memoryPointers();
  const model = createReviewLifecycle({ pointers: backing.pointers, evidence: undefined!, rpc: { async call(method) {
    if (method === "prepare_controlled_record_review_v3") { started.resolve(); return response.promise; }
    assert.equal(method, "read_controlled_record_review_v3"); return f.saved();
  } } });
  model.setIdentity(identity); const pending = model.prepare(request); await started.promise;
  model.setIdentity({ ...identity, sessionId: other, generation: 2 }); response.resolve(f.prepared()); await pending;
  assert.equal(model.getSnapshot().phase, "recoverable"); assert.equal(model.getSnapshot().prepared, undefined);
  await model.recover(); assert.equal(model.getSnapshot().outcome?.state, "saved");
});
test("recovery never signs automatically and stale/blocked/superseded states cannot replace UUID", async () => {
  const f = await fixture(), backing = memoryPointers(); await backing.pointers.reserve(f.pointer); let calls = 0;
  const { model } = harness({ async call(method) { calls++; assert.equal(method, "read_controlled_record_review_v3"); return f.prepared(); } }, backing);
  await model.recover(); assert.equal(model.getSnapshot().phase, "review"); assert.equal(model.getSnapshot().reviewed, false);
  await assert.rejects(model.confirm()); assert.equal(calls, 1);
  for (const state of ["stale", "blocked", "superseded", "expired"] as const) {
    const data = { operation_id: operation, transport_digest: f.pointer.transport_digest,
      ...(state === "stale" ? { reason: "policy_changed" } : state === "blocked" ? { reason: "no_review_eligibility" } : state === "expired" ?
        { created_at: f.value.data.created_at, expires_at: f.value.data.expires_at } : {}) };
    const h = harness({ async call() { return raw({ version: 3, state, data }); } }, backing);
    await h.model.recover(); assert.equal(h.model.getSnapshot().phase, "attention");
    assert.deepEqual(h.model.getSnapshot().pointer, f.pointer); assert.throws(() => h.model.startAnother());
    await assert.rejects(h.model.prepare({ ...request, operation_id: other }));
  }
});
test("double activation does not duplicate mutation; original request is frozen before await", async () => {
  const f = await fixture(), wait = deferred<ExactJson>(), started = deferred<void>(); let calls = 0;
  const { model } = harness({ async call(_method, submitted) {
    calls++; assert.equal(submitted.reason, request.reason); assert.ok(Object.isFrozen(submitted)); started.resolve(); return wait.promise;
  } });
  const input = { ...request }, pending = model.prepare(input); input.reason = "Changed after activation";
  await started.promise; await assert.rejects(model.prepare(request)); await assert.rejects(model.cancel());
  wait.resolve(f.prepared()); await pending; assert.equal(calls, 1);
});
test("unrelated/malformed saved commitment cannot clear pointer or appear confirmed", async () => {
  const f = await fixture(), backing = memoryPointers(); await backing.pointers.reserve(f.pointer);
  const bad = raw({ version: 3, state: "saved", data: { operation_id: operation, receipt: { ...f.pointer, actor_id: other,
    decision: "approve", recorded_at: "2026-10-23T12:00:00.000000Z", receipt_hash: "a".repeat(64) } } });
  const { model } = harness({ async call() { return bad; } }, backing);
  await model.recover(); assert.equal(model.getSnapshot().phase, "unknown"); assert.equal(backing.values.size, 1);
});
