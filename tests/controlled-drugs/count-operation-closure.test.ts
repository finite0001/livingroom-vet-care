import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { digestCountOperationClosureReply, parseCountOperationClosureRequest, verifyCountOperationClosureReply, type CountOperationClosureReply, type CountOperationClosureRequest } from "../../src/hub/features/controlled-drugs/count/count-operation-closure.ts";

const encoder = new TextEncoder(), raw = (input: unknown) => encoder.encode(JSON.stringify(input));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const countReceipts = JSON.parse(readFileSync(new URL("./count-wire-fixtures/v2-independent-vectors.json", import.meta.url), "utf8")).public_receipts;
const managementReceipts = JSON.parse(readFileSync(new URL("./count-management-wire-fixtures/independent-vectors.json", import.meta.url), "utf8")).public_receipts;
const base: CountOperationClosureRequest = { schema_version: 1, actor_id: id(7), operation_id: id(5), original_action: "statement", scope_id: id(6), product_id: id(9), site_id: id(10) };
async function reply(request = base, state: CountOperationClosureReply["state"] = "pending", receipt: CountOperationClosureReply["receipt"] = null): Promise<CountOperationClosureReply> {
  const result: CountOperationClosureReply = { ...request, action: "operation_closure", state, receipt, receipt_digest: "0".repeat(64) };
  return { ...result, receipt_digest: await digestCountOperationClosureReply(result) };
}
test("recovery pointers contain exactly the seven ID/action fields and no observations", () => {
  const parsed = parseCountOperationClosureRequest(base); assert.ok(Object.isFrozen(parsed));
  assert.throws(() => parseCountOperationClosureRequest({ ...base, quantities: [] }));
  assert.throws(() => parseCountOperationClosureRequest({ ...base, original_action: "read" }));
  assert.throws(() => parseCountOperationClosureRequest({ ...base, actor_id: "00000000-0000-0000-0000-000000000000" }));
  const getter = { ...base }; Object.defineProperty(getter, "actor_id", { get() { throw new Error("must not invoke"); }, enumerable: true });
  assert.throws(() => parseCountOperationClosureRequest(getter), error => error instanceof Error && !error.message.includes("must not invoke"));
});
test("pending and abandoned stay distinct terminal states with no invented saved receipt", async () => {
  for (const state of ["pending", "abandoned"] as const) {
    const result = await verifyCountOperationClosureReply(raw(await reply(base, state)), base);
    assert.equal(result.state, state); assert.equal(result.receipt, null); assert.ok(Object.isFrozen(result));
  }
  await assert.rejects(() => reply(base, "saved"));
  await assert.rejects(() => reply(base, "abandoned", countReceipts[1]));
});
test("a saved closure retains the original independently vectored count receipt", async () => {
  const receipt = countReceipts.find((value: { action: string }) => value.action === "statement");
  const result = await verifyCountOperationClosureReply(raw(await reply(base, "saved", receipt)), base);
  assert.deepEqual(result.receipt, receipt); assert.ok(Object.isFrozen(result.receipt?.result_ref));
});
test("saved management receipts are bound to actor, operation, product, site and action", async () => {
  const receipt = managementReceipts[0].receipt ?? managementReceipts[0];
  const request: CountOperationClosureRequest = { ...base, actor_id: receipt.actor_id, operation_id: receipt.operation_id, product_id: receipt.product_id, site_id: receipt.site_id, original_action: receipt.action };
  const result = await verifyCountOperationClosureReply(raw(await reply(request, "saved", receipt)), request);
  assert.deepEqual(result.receipt, receipt);
  await assert.rejects(() => reply({ ...request, product_id: id(99) }, "saved", receipt));
});
test("outer identity/digest changes and a bad nested receipt cannot acquire a saved result", async () => {
  const original = await reply(base, "saved", countReceipts[1]);
  for (const key of ["actor_id", "operation_id", "scope_id", "product_id", "site_id"] as const)
    await assert.rejects(() => verifyCountOperationClosureReply(raw({ ...original, [key]: id(99) }), base));
  await assert.rejects(() => verifyCountOperationClosureReply(raw({ ...original, receipt_digest: "f".repeat(64) }), base));
  const badInner = { ...countReceipts[1], receipt_digest: "f".repeat(64) };
  const rehashedOuter = await reply(base, "saved", badInner);
  await assert.rejects(() => verifyCountOperationClosureReply(raw(rehashedOuter), base));
});
test("raw duplicate keys, invalid Unicode and noncanonical protocol integers refuse", async () => {
  const text = JSON.stringify(await reply());
  for (const invalid of [text.replace('"schema_version":1', '"schema_version":1,"schema_version":1'), text.replace('"schema_version":1', '"schema_version":1e0'), '\uFEFF' + text])
    await assert.rejects(() => verifyCountOperationClosureReply(encoder.encode(invalid), base));
  await assert.rejects(() => verifyCountOperationClosureReply(new Uint8Array([0xff]), base));
});
test("actual typed-array bounds cannot be hidden by caller byteLength", async () => {
  const oversized = new Uint8Array(8193); Object.defineProperty(oversized, "byteLength", { value: 1 });
  await assert.rejects(() => verifyCountOperationClosureReply(oversized, base));
  const valid = raw(await reply());
  Object.defineProperty(valid, "length", { get() { throw new Error("untrusted length"); } });
  assert.equal((await verifyCountOperationClosureReply(valid, base)).state, "pending");
});
test("request and response snapshots survive mutation while the digest is awaited", async () => {
  const request = { ...base }, bytes = raw(await reply());
  const pending = verifyCountOperationClosureReply(bytes, request);
  request.actor_id = id(99); bytes.fill(0);
  const result = await pending; assert.equal(result.actor_id, base.actor_id); assert.equal(result.state, "pending");
});
