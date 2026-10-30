import assert from "node:assert/strict";
import test from "node:test";
import { createRegisterOperations, registerStorageKey } from "../../src/hub/features/controlled-drugs/register/operation-controller.ts";
import type { RegisterClient } from "../../src/hub/features/controlled-drugs/register/client.ts";
import type { RegisterReply } from "../../src/hub/features/controlled-drugs/register/schema.ts";

const project = "abcdefghijklmnopqrst", actor = "10000000-0000-4000-8000-000000000001", operation = "10000000-0000-4000-8000-000000000002";
const identity = { actorId: actor, sessionId: "10000000-0000-4000-8000-000000000003", generation: 1 };
const request = { schema_version: 1, actor_id: actor, operation_id: operation, product_id: "10000000-0000-4000-8000-000000000004",
  site_id: "10000000-0000-4000-8000-000000000005", from_at: "2026-10-20T00:00:00.000Z", to_at: "2026-10-21T00:00:00.000Z" };
function fixture() {
  const values = new Map<string, string>(); let calls = 0;
  let next: RegisterReply = { schema_version: 1, state: "not_found", kind: "report", operation_id: operation };
  const client: RegisterClient = {
    async list() { throw new Error("Unused synthetic list"); },
    async save() { calls++; throw new Error("Synthetic lost response"); },
    async recover() { calls++; return next; },
    async download() { throw new Error("Unused synthetic download"); },
  };
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const locks = { async exclusive<T>(_key: string, work: () => Promise<T>) { return work(); } };
  const operations = createRegisterOperations(project, client, storage, locks);
  return { values, client, storage, locks, operations, calls: () => calls, reply: (value: RegisterReply) => { next = value; } };
}
test("an unconfirmed save keeps only scope IDs; absence does not permit a replacement", async () => {
  const f = fixture(); await assert.rejects(f.operations.save("report", request, identity));
  const pending = f.operations.pending(actor)!;
  assert.deepEqual(Object.keys(pending), ["schema_version", "actor_id", "operation_id", "product_id", "site_id", "kind"]);
  assert.equal(pending.operation_id, operation);
  await f.operations.recover("read", identity); assert.deepEqual(f.operations.pending(actor), pending);
  await assert.rejects(f.operations.save("report", { ...request, operation_id: crypto.randomUUID() }, identity));
  assert.equal(f.calls(), 2);
  f.reply({ schema_version: 1, state: "abandoned", kind: "report", operation_id: operation });
  await f.operations.recover("close", identity); assert.equal(f.operations.pending(actor), null);
});
test("wrong actor and failed pointer persistence prevent the first HTTP call", async () => {
  const f = fixture();
  assert.throws(() => f.operations.save("report", request, { ...identity, actorId: request.product_id }));
  const broken = createRegisterOperations(project, f.client, { ...f.storage, setItem() { throw new Error("Synthetic full storage"); } }, f.locks);
  await assert.rejects(broken.save("report", request, identity)); assert.equal(f.calls(), 0);
});
test("wrong recovered operation cannot clear an uncertain save", async () => {
  const f = fixture(); await assert.rejects(f.operations.save("report", request, identity));
  f.reply({ schema_version: 1, state: "abandoned", kind: "report", operation_id: crypto.randomUUID() });
  await assert.rejects(f.operations.recover("close", identity)); assert.equal(f.operations.pending(actor)?.operation_id, operation);
});
test("project separation and corrupt or duplicate pointer data fail closed", () => {
  const f = fixture(), key = registerStorageKey(project, actor);
  assert.notEqual(key, registerStorageKey("bcdefghijklmnopqrstu", actor));
  f.values.set(key, `{"actor_id":"${actor}","actor_id":"${actor}"}`); assert.throws(() => f.operations.pending(actor));
});
