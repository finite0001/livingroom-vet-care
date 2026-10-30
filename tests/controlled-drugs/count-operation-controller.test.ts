import { ControlledOperationNotSentError } from "../../src/hub/features/controlled-drugs/operation-errors.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { createCountOperationController, countOperationStorageKey, type CountOperationLock, type CountPointerStorage } from "../../src/hub/features/controlled-drugs/count/count-operation-controller.ts";
import type { CountClient } from "../../src/hub/features/controlled-drugs/count/count-client.ts";
import type { CountOperationClosureReply } from "../../src/hub/features/controlled-drugs/count/count-operation-closure.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const identity = { actorId: id(1), sessionId: id(2), generation: 1 };
const scope = { product_id: id(3), site_id: id(4) };
const request = { schema_version: 1, actor_id: id(1), count_id: id(5), operation_id: id(6), cancellation_id: id(7), reason: "Synthetic cancellation" };
function memory(): CountPointerStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } };
}
function lock(): CountOperationLock {
  const held = new Set<string>();
  return { async exclusive(name, task) { if (held.has(name)) throw new Error("Locked"); held.add(name); try { return await task(); } finally { held.delete(name); } } };
}
test("a durable ID-only pointer precedes the only POST and remains after loss/reload", async () => {
  const storage = memory(), locks = lock(); let calls = 0;
  const client = { async mutate() {
    calls++; const text = [...storage.values.values()][0]; assert.ok(text); assert.ok(!text.includes("Synthetic cancellation"));
    assert.deepEqual(Object.keys(JSON.parse(text)).sort(), ["schema_version", "actor_id", "operation_id", "original_action", "scope_id", "product_id", "site_id"].sort());
    throw new Error("response lost");
  } } as unknown as CountClient;
  const first = createCountOperationController(client, storage, locks);
  await assert.rejects(() => first.mutate("cancel", request, scope, identity)); assert.equal(calls, 1);
  const reloaded = createCountOperationController(client, storage, locks);
  assert.equal(reloaded.pending(identity.actorId)?.operation_id, request.operation_id);
  await assert.rejects(() => reloaded.mutate("cancel", { ...request, operation_id: id(8) }, scope, identity)); assert.equal(calls, 1);
});
test("pending recovery keeps the pointer; explicit terminal close clears it under a new session without resending", async () => {
  const storage = memory(), locks = lock(); let posts = 0, state: "pending" | "abandoned" = "pending";
  const freshIdentity = { ...identity, sessionId: id(20), generation: 2 };
  const client = { async mutate() { posts++; throw new Error("lost"); }, async closure(mode, pointer, who) {
    assert.deepEqual(who, freshIdentity); assert.equal(pointer.operation_id, request.operation_id);
    if (mode === "close") state = "abandoned";
    return { ...pointer, action: "operation_closure", state, receipt: null, receipt_digest: "a".repeat(64) } as CountOperationClosureReply;
  } } as CountClient;
  const controller = createCountOperationController(client, storage, locks);
  await assert.rejects(() => controller.mutate("cancel", request, scope, identity));
  assert.equal((await controller.recover("read", freshIdentity)).state, "pending"); assert.ok(controller.pending(identity.actorId));
  assert.equal((await controller.recover("close", freshIdentity)).state, "abandoned"); assert.equal(controller.pending(identity.actorId), null); assert.equal(posts, 1);
});
test("an original save already in flight excludes another tab and a verified success releases the pointer", async () => {
  const storage = memory(), locks = lock(); let finish!: () => void, calls = 0;
  const wait = new Promise<void>(resolve => { finish = resolve; });
  const client = { async mutate() { calls++; await wait; return { schema_version: 1, state: "saved", data: { receipt: {} } }; } } as CountClient;
  const one = createCountOperationController(client, storage, locks), two = createCountOperationController(client, storage, locks);
  const sending = one.mutate("cancel", request, scope, identity);
  await assert.rejects(() => two.mutate("cancel", { ...request, operation_id: id(8) }, scope, identity));
  assert.equal(calls, 1); finish(); await sending; assert.equal(one.pending(identity.actorId), null);
});
test("corrupt persistence, blocked storage or an actor mismatch prevent the network call", async () => {
  let calls = 0;
  const client = { async mutate() { calls++; throw new Error("must not send"); } } as unknown as CountClient;
  const storage = memory(), controller = createCountOperationController(client, storage, lock());
  storage.values.set(countOperationStorageKey(identity.actorId), "{}");
  assert.throws(() => controller.pending(identity.actorId));
  await assert.rejects(() => controller.mutate("cancel", request, scope, identity));
  storage.values.clear();
  assert.throws(() => controller.mutate("cancel", request, scope, { ...identity, actorId: id(99) }));
  const unavailable = createCountOperationController(client, { ...storage, setItem() { throw new Error("storage blocked"); } }, lock());
  await assert.rejects(() => unavailable.mutate("cancel", request, scope, identity)); assert.equal(calls, 0);
});

test("only the coordinator's pre-client refusal is classified as not sent", async () => {
  const storage = memory(); let calls = 0;
  const client = { async mutate() { calls++; throw new ControlledOperationNotSentError(); } } as unknown as CountClient;
  const blocked = createCountOperationController(client, storage, { async exclusive() { throw new Error("Other tab owns lock"); } });
  await assert.rejects(blocked.mutate("cancel", request, scope, identity), ControlledOperationNotSentError); assert.equal(calls, 0); assert.equal(blocked.pending(identity.actorId), null);
  const sent = createCountOperationController(client, storage, lock());
  await assert.rejects(sent.mutate("cancel", request, scope, identity), error => !(error instanceof ControlledOperationNotSentError));
  assert.equal(calls, 1); assert.equal(sent.pending(identity.actorId)?.operation_id, request.operation_id);
});
