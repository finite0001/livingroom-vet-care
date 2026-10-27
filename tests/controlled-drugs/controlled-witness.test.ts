import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createWitnessClient } from "../../src/hub/features/controlled-drugs/witness/client.ts";
import { createWitnessService } from "../../src/hub/features/controlled-drugs/witness/service.ts";
import { parseWitnessList, parseWitnessReply, witnessListRequestSchema, witnessPointerSchema, witnessReceiptSchema } from "../../src/hub/features/controlled-drugs/witness/schema.ts";
import { witnessReceiptBytes, witnessReceiptDigest } from "../../src/hub/features/controlled-drugs/witness/wire.ts";
import { sameReviewIdentity, type ReviewIdentity } from "../../src/hub/features/controlled-drugs/record-review/raw-rpc.ts";
import type { ReviewStaffSessionSource } from "../../src/hub/features/controlled-drugs/record-review/staff-session.ts";
import { decode } from "./controlled-entry-fixture.ts";
import { witnessFixtureFromBytes } from "./controlled-witness-fixture.ts";
const fixture = () => witnessFixtureFromBytes(readFileSync(new URL("./record-review-stock-movement-reference.json", import.meta.url)));
const config = { projectRef: "a".repeat(20), url: `https://${"a".repeat(20)}.supabase.co`, publishableKey: "sb_publishable_synthetic" };
function sessions(initial: ReviewIdentity) { let identity = initial; const source: ReviewStaffSessionSource = { getSnapshot: () => identity,
  subscribe: () => () => {}, isCurrent: value => sameReviewIdentity(value, identity), async current() { return { ...identity, accessToken: "synthetic.actual.token" }; } }; return { source, set(value: ReviewIdentity) { identity = value; } }; }
function memory() { const values = new Map<string, string>(); return { values, getItem: (key: string) => values.get(key) ?? null,
  setItem(key: string, value: string) { values.set(key, value); }, removeItem(key: string) { values.delete(key); } }; }
const lock = { async exclusive<T>(_key: string, work: () => Promise<T>) { return work(); } };
interface Vector { readonly pointer: unknown; readonly receipt: unknown; readonly receipt_frame_hex: string; readonly receipt_frame_bytes: number }
interface Vectors { readonly vectors: readonly Vector[] }
test("all22 independent source receipt vectors match exact UTF8 frame and SHA, including colon kinds", async () => {
  const values = JSON.parse(readFileSync(new URL("./witness-protocol-vectors.json", import.meta.url), "utf8")) as Vectors;
  assert.equal(values.vectors.length, 22);
  for (const vector of values.vectors) {
    witnessPointerSchema.parse(vector.pointer); const receipt = witnessReceiptSchema.parse(vector.receipt), bytes = witnessReceiptBytes(receipt);
    assert.equal(Buffer.from(bytes).toString("hex"), vector.receipt_frame_hex); assert.equal(bytes.length, vector.receipt_frame_bytes);
    assert.equal(await witnessReceiptDigest(receipt), receipt.receipt_digest);
    assert.throws(() => witnessReceiptSchema.parse({ ...receipt, extra: true }));
  }
});
test("actual client rereads displayed projection then attests explicitly under one identity and AbortSignal", async () => {
  const f = fixture(), auth = sessions(f.identity), calls: string[] = [], signals: (AbortSignal | null | undefined)[] = [], bodies: unknown[] = [];
  const client = createWitnessClient(config, auth.source, async (url, init) => {
    const route = String(url).split("/").pop()!; calls.push(route); signals.push(init?.signal); bodies.push(JSON.parse(String(init?.body)));
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer synthetic.actual.token");
    return new Response(f.encode(route === "attest_managed_stock_witness_v1" ? await f.receipt() : f.available()), { headers: { "Content-Type": "application/json" } });
  });
  const receipt = await client.attest(f.pointer, f.displayed, f.identity, true);
  assert.equal(receipt.parent_action_id, f.pointer.parent_action_id);
  assert.deepEqual(calls, ["read_managed_stock_witness_v1", "attest_managed_stock_witness_v1"]); assert.equal(signals[0], signals[1]);
  assert.deepEqual(bodies[0], { p_request: f.pointer }); assert.deepEqual(bodies[1], { p_request: { ...f.pointer, preparation_digest: f.preparationDigest, attest_witness: true } });
});
test("changed digest/basis, new session, or unknown read failure cannot send an attestation", async () => {
  for (const mutation of ["digest", "basis", "session", "error"]) {
    const f = fixture(), auth = sessions(f.identity), calls: string[] = [];
    const client = createWitnessClient(config, auth.source, async url => {
      calls.push(String(url).split("/").pop()!); const value = f.available();
      if (mutation === "session") auth.set({ ...f.identity, sessionId: "00000000-0000-4000-8000-000000000999", generation: 2 });
      if (mutation === "digest") value.data.preparation_digest = "b".repeat(64);
      if (mutation === "basis") value.data.preparation = { ...f.preparation, context: { ...f.preparation.context, basis: { ...f.preparation.context.basis, note: "Changed after display" } } };
      return new Response(f.encode(value), { status: mutation === "error" ? 500 : 200, headers: { "Content-Type": "application/json" } });
    });
    await assert.rejects(client.attest(f.pointer, f.displayed, f.identity, true)); assert.deepEqual(calls, ["read_managed_stock_witness_v1"]);
  }
});
test("durable pointer has seven IDs only; lost save resolves by owned READ under a new login without resend", async () => {
  const f = fixture(), auth = sessions(f.identity), store = memory(), calls: string[] = []; let saved = false;
  const client = createWitnessClient(config, auth.source, async url => {
    const name = String(url).split("/").pop()!; calls.push(name);
    if (name === "attest_managed_stock_witness_v1") { saved = true; throw new Error("lost response"); }
    const value = name === "read_managed_stock_witness_operation_v1" && saved ? { ...f.available(), state: "saved", data: { ...f.available().data, receipt: await f.receipt() } } : f.available();
    return new Response(f.encode(value), { headers: { "Content-Type": "application/json" } });
  });
  const service = createWitnessService(client, auth.source, store, lock, () => f.pointer.operation_id);
  const displayed = await service.open(f.task, f.identity); assert.equal(store.values.size, 1);
  const raw = [...store.values.values()][0]; assert.equal(Object.keys(JSON.parse(raw)).length, 7); assert.ok(!raw.includes("Synthetic") && !raw.includes("preparation_digest") && !raw.includes("quantity"));
  await assert.rejects(service.attest(displayed, f.identity, true)); assert.ok(service.pending(f.identity.actorId));
  const renewed = { ...f.identity, sessionId: "00000000-0000-4000-8000-000000000999", generation: 2 }; auth.set(renewed);
  assert.equal((await service.recover("read", renewed)).state, "saved"); assert.equal(service.pending(f.identity.actorId), null);
  assert.equal(calls.filter(name => name === "attest_managed_stock_witness_v1").length, 1);
});
test("not_found retains IDs, explicit close tombstones, and another parent's task cannot replace an uncertain operation", async () => {
  const f = fixture(), auth = sessions(f.identity), store = memory(), calls: string[] = [];
  const client = createWitnessClient(config, auth.source, async url => { const name = String(url).split("/").pop()!; calls.push(name); return new Response(f.encode(name === "read_managed_stock_witness_operation_v1" ? f.terminal("not_found") : name === "close_managed_stock_witness_operation_v1" ? f.terminal("abandoned") : f.available()), { headers: { "Content-Type": "application/json" } }); });
  const service = createWitnessService(client, auth.source, store, lock, () => f.pointer.operation_id); await service.open(f.task, f.identity);
  assert.equal((await service.recover("read", f.identity)).state, "not_found"); assert.ok(service.pending(f.identity.actorId));
  await assert.rejects(service.open({ ...f.task, parent_action_id: f.pointer.operation_id }, f.identity));
  assert.equal((await service.recover("close", f.identity)).state, "abandoned"); assert.equal(service.pending(f.identity.actorId), null);
  await assert.rejects(service.attest(f.displayed, f.identity, true)); assert.ok(!calls.includes("attest_managed_stock_witness_v1"));
});
test("own-recorder tasks, foreign pointer, wrong receipt and malformed projections refuse", async () => {
  const f = fixture(), request = witnessListRequestSchema.parse({ schema_version: 1, actor_id: f.identity.actorId, cursor: null, page_size: 1 });
  const list = { schema_version: 1, items: [f.task], next_cursor: null, has_more: false };
  assert.equal(parseWitnessList(decode(f.encode(list)), request).items.length, 1);
  for (const value of [{ ...list, items: [{ ...f.task, recorder: { ...f.recorder, id: f.identity.actorId } }] }, { ...list, has_more: true }, { ...list, items: [f.task, f.task] }]) assert.throws(() => parseWitnessList(decode(f.encode(value)), request));
  assert.throws(() => parseWitnessReply(decode(f.encode({ ...f.available(), data: { ...f.available().data, pointer: { ...f.pointer, operation_id: f.pointer.parent_action_id } } })), f.pointer));
  const client = createWitnessClient(config, sessions(f.identity).source, async () => new Response(f.encode({ ...f.available(), state: "saved", data: { ...f.available().data, receipt: { ...await f.receipt(), receipt_digest: "f".repeat(64) } } }), { headers: { "Content-Type": "application/json" } }));
  await assert.rejects(client.operation(f.pointer, f.identity));
  assert.throws(() => parseWitnessReply(decode(f.encode({ ...f.available(), data: { ...f.available().data, preparation: { ...f.preparation, actor_id: f.identity.actorId } } })), f.pointer));
});
test("the fresh-read and attestation share the original30s deadline; late READ cannot start a write", async context => {
  const f = fixture(), auth = sessions(f.identity); let clock = 0; const calls: string[] = [];
  context.mock.method(performance, "now", () => clock);
  const client = createWitnessClient(config, auth.source, async url => { calls.push(String(url).split("/").pop()!); clock = 30001;
    return new Response(f.encode(f.available()), { headers: { "Content-Type": "application/json" } }); });
  await assert.rejects(client.attest(f.pointer, f.displayed, f.identity, true));
  assert.deepEqual(calls, ["read_managed_stock_witness_v1"]);
});
