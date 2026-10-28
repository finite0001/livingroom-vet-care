/** Unit transport fixtures only; these tests do not establish Auth/backend acceptance. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createRecoveryClient, type RecoveryClient } from "../../src/hub/features/controlled-drugs/recovery/client.ts";
import { createRecoveryOperations, recoveryStorageKey } from "../../src/hub/features/controlled-drugs/recovery/operation-controller.ts";
import { recoveryRequest, type RecoveryReceipt } from "../../src/hub/features/controlled-drugs/recovery/schema.ts";
import { recoveryJsonbText, verifyRecoveryPointer, verifyRecoveryReceipt } from "../../src/hub/features/controlled-drugs/recovery/wire.ts";

const actor = "10000000-0000-4000-8000-000000000001", op = "10000000-0000-4000-8000-000000000002", head = "10000000-0000-4000-8000-000000000003";
const identity = { actorId: actor, sessionId: "10000000-0000-4000-8000-000000000004", generation: 1 };
const pointer = { schema_version: 1 as const, actor_id: actor, operation_id: op, action: "arm" as const };
const request = { ...pointer, expected_head_id: head, expected_head_hash: "a".repeat(64), data: { capture_hash: "b".repeat(64) } };
const hash = (domain: string, value: unknown) => createHash("sha256").update(recoveryJsonbText({ domain, value })).digest("hex");
function receipt(): RecoveryReceipt {
  const body = { ...pointer, state: "saved" as const, request_hash: hash("narcotics-recovery-request-v1", request),
    data: { head_id: op, head_hash: "c".repeat(64), mode: "armed" as const, arm_id: op, capture_hash: request.data.capture_hash } };
  return { ...body, receipt_hash: hash("narcotics-recovery-receipt-v1", body) };
}
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

test("recovery JSONB framing retains array, boolean and Unicode spelling and rejects source numbers", () => {
  assert.equal(recoveryJsonbText({ longer: "café\n", a: [true, false, null, "1.000", 1] }), '{"a": [true, false, null, "1.000", 1], "longer": "café\\n"}');
  for (const value of [1.001, -0, NaN, Infinity, "\ud800", "\0", new Date(), { "non-ascii-é": 1 }]) assert.throws(() => recoveryJsonbText(value));
});

test("saved recovery receipts bind the exact request, operation, action and mode transition", async () => {
  assert.deepEqual(await verifyRecoveryReceipt(receipt(), pointer, recoveryRequest.parse(request)), receipt());
  const changed = { ...request, data: { capture_hash: "d".repeat(64) } };
  await assert.rejects(verifyRecoveryReceipt(receipt(), pointer, recoveryRequest.parse(changed)));
  await assert.rejects(verifyRecoveryReceipt({ ...receipt(), data: { ...receipt().data, head_id: head } }, pointer));
  await assert.rejects(verifyRecoveryReceipt({ ...receipt(), actor_id: head }, pointer));
  await assert.rejects(verifyRecoveryReceipt({ ...receipt(), extra: true }, pointer));
});

test("ID-only recovery rejects duplicate keys, fractional protocol versions and ambiguous saved states", async () => {
  const pending = { ...pointer, state: "pending", receipt: null };
  assert.equal((await verifyRecoveryPointer(encode(pending), pointer)).state, "pending");
  for (const raw of [JSON.stringify(pending).replace('"schema_version":1', '"schema_version":1.0'),
    JSON.stringify(pending).replace('"schema_version":1', '"schema_version":1,"schema_version":1'),
    JSON.stringify({ ...pending, receipt: receipt() }), JSON.stringify({ ...pending, state: "saved" })]) {
    await assert.rejects(verifyRecoveryPointer(new TextEncoder().encode(raw), pointer));
  }
});

test("recovery retains only IDs before HTTP, blocks replacement after lost acknowledgement, and requires terminal closure", async () => {
  const values = new Map<string, string>(), key = recoveryStorageKey("a".repeat(20), actor);
  let sends = 0, terminal = false;
  const client: RecoveryClient = {
    async status() { throw Error("unused"); }, async preflight() { throw Error("unused"); }, async download() { throw Error("unused"); },
    async save() {
      sends++; assert.equal(values.get(key), JSON.stringify(pointer));
      assert.ok(!values.get(key)?.includes("capture_hash")); throw Error("simulated acknowledgement loss");
    },
    async recover() { return { ...pointer, state: terminal ? "abandoned" : "pending", receipt: null }; },
  };
  const operations = createRecoveryOperations("a".repeat(20), client, { getItem: k => values.get(k) ?? null, setItem: (k, v) => { values.set(k, v); }, removeItem: k => { values.delete(k); } },
    { async exclusive(name, task) { assert.equal(name, key); return task(); } });
  await assert.rejects(operations.save(request, identity));
  await assert.rejects(operations.save(request, identity)); assert.equal(sends, 1);
  assert.equal((await operations.recover("read", identity)).state, "pending"); assert.deepEqual(operations.pending(actor), pointer);
  terminal = true; await operations.recover("close", identity); assert.equal(operations.pending(actor), null);
});

test("malformed stored pointers cannot be overwritten or treated as permission to save", async () => {
  const client = {} as RecoveryClient;
  const operations = createRecoveryOperations("a".repeat(20), client,
    { getItem: () => JSON.stringify({ ...pointer, claim: "must not persist" }), setItem() { assert.fail("must not overwrite"); }, removeItem() { assert.fail("must not clear"); } },
    { async exclusive(_name, task) { return task(); } });
  assert.throws(() => operations.pending(actor));
  await assert.rejects(operations.save(request, identity));
});

test("staff-session change during response verification prevents confirmation without a retry", async () => {
  let current = true, calls = 0;
  const sessions = { async current() { return { ...identity, accessToken: "unit_transport_placeholder" }; }, isCurrent() { return current; } };
  const client = createRecoveryClient({ projectRef: "a".repeat(20), url: `https://${"a".repeat(20)}.supabase.co`, publishableKey: "sb_publishable_unit_fixture" }, sessions,
    async () => { calls++; current = false; return new Response(JSON.stringify(receipt()), { headers: { "content-type": "application/json" } }); });
  await assert.rejects(client.save(request, identity)); assert.equal(calls, 1);
});
