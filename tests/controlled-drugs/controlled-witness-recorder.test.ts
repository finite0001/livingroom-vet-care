import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createEntryClient } from "../../src/hub/features/controlled-drugs/entry/client.ts";
import { createEntryService } from "../../src/hub/features/controlled-drugs/entry/service.ts";
import { parseEntryReply, parseEntryProbe } from "../../src/hub/features/controlled-drugs/entry/schema.ts";
import { entryObject } from "../../src/hub/features/controlled-drugs/entry/codec.ts";
import { sameReviewIdentity } from "../../src/hub/features/controlled-drugs/record-review/raw-rpc.ts";
import type { ReviewStaffSessionSource } from "../../src/hub/features/controlled-drugs/record-review/staff-session.ts";
import { witnessFixtureFromBytes } from "./controlled-witness-fixture.ts";
import { decode } from "./controlled-entry-fixture.ts";
const config = { projectRef: "a".repeat(20), url: `https://${"a".repeat(20)}.supabase.co`, publishableKey: "sb_publishable_synthetic" };
const fixture = () => witnessFixtureFromBytes(readFileSync(new URL("./record-review-stock-movement-reference.json", import.meta.url)));
function source(f: ReturnType<typeof fixture>): ReviewStaffSessionSource { return { getSnapshot: () => f.entry.identity, subscribe: () => () => {},
  isCurrent: value => sameReviewIdentity(value, f.entry.identity), async current() { return { ...f.entry.identity, accessToken: "synthetic.actual.token" }; } }; }
function recorderReply(f: ReturnType<typeof fixture>, state: "prepared" | "saved" | "not_found") {
  const original = f.entry.reply(state), p = original.data.preparation;
  return { ...original, data: { ...original.data, preparation: p ? { ...p, frozen: { ...p.frozen, permission: { ...entryObject(p.frozen.permission), witness: "c2_required" } } } : null } };
}
function status(f: ReturnType<typeof fixture>, witnessed: boolean) { return { schema_version: 1, state: witnessed ? "witnessed" : "required", data: {
  parent_action_id: f.entry.pointer.operation_id, product_id: f.entry.pointer.product_id, event_kind: f.entry.pointer.event_kind,
  witness: witnessed ? { operation_id: f.pointer.operation_id, actor_id: f.identity.actorId, name: "Synthetic independent witness", recorded_at: "2026-10-27T18:00:00.123456Z" } : null, blocked_reason: null } }; }
test("recorder C2 execute rereads owned preparation and separate status under one AbortSignal; no witness means no execute", async () => {
  for (const witnessed of [false, true]) {
    const f = fixture(), calls: string[] = [], signals: (AbortSignal | null | undefined)[] = [];
    const client = createEntryClient(config, source(f), async (url, init) => { const route = String(url).split("/").pop()!; calls.push(route); signals.push(init?.signal);
      const value = route === "read_managed_stock_witness_status_v1" ? status(f, witnessed) : recorderReply(f, route === "execute_managed_stock_intent_v1" ? "saved" : "prepared");
      return new Response(f.encode(value), { headers: { "Content-Type": "application/json" } }); });
    const displayed = parseEntryReply(decode(f.encode(recorderReply(f, "prepared"))), f.entry.pointer);
    const work = client.executeWitnessed(f.entry.pointer, displayed, f.entry.identity);
    if (witnessed) assert.equal((await work).state, "saved"); else await assert.rejects(work);
    assert.deepEqual(calls, ["read_managed_stock_intent_v1", "read_managed_stock_witness_status_v1", ...(witnessed ? ["execute_managed_stock_intent_v1"] : [])]);
    assert.ok(signals.every(signal => signal === signals[0]));
  }
});
test("actual recorder coordinator preserves C2 rule and delivers only after witnessed execution; no fake none fallback", async () => {
  const f = fixture(), auth = source(f), calls: string[] = []; let prepared = false, checked = false;
  const probe = { ...f.entry.probeRaw, options: { ...f.entry.probeRaw.options, permission: { ...entryObject(f.entry.probeRaw.options.permission), witness: "c2_required" } } };
  const client = createEntryClient(config, auth, async url => { const route = String(url).split("/").pop()!; calls.push(route);
    if (route === "prepare_managed_stock_intent_v1") prepared = true;
    const value = route === "probe_controlled_stock_intent_v1" ? probe : route === "read_managed_stock_witness_status_v1" ? status(f, true) : recorderReply(f, route === "execute_managed_stock_intent_v1" ? "saved" : prepared ? "prepared" : "not_found");
    return new Response(f.encode(value), { headers: { "Content-Type": "application/json" } }); });
  const values = new Map<string, string>(), service = createEntryService(client, auth, { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } },
    { async exclusive(_key, work) { return work(); } }, { async plan(value) { assert.equal(value.options!.permission.witness, "c2_required"); return f.entry.context; },
      async inspect(value, _identity, checkWitness) { assert.equal(value.data.preparation!.frozen.permission.witness, "c2_required"); assert.ok(checkWitness); assert.equal((await checkWitness()).state, "witnessed"); checked = true; return "execute"; } });
  const result = await service.invoke("adjust_inventory", JSON.parse(f.entry.snapshot.requestBody), f.entry.identity, raw => { assert.equal(checked, true); return raw; });
  assert.equal(entryObject(result).id, f.entry.pointer.operation_id); assert.equal(values.size, 0);
  assert.equal(calls.filter(route => route === "execute_managed_stock_intent_v1").length, 1);
});
test("a source C2 probe followed by a downgraded none preparation is retained and never executed", async () => {
  const f = fixture(), auth = source(f), values = new Map<string, string>(); let executed = false;
  const probe = parseEntryProbe(decode(f.encode({ ...f.entry.probeRaw, options: { ...f.entry.probeRaw.options, permission: { ...entryObject(f.entry.probeRaw.options.permission), witness: "c2_required" } } })), f.entry.identity.actorId, f.entry.snapshot);
  const client = { async probe() { return probe; }, async read() { return parseEntryReply(decode(f.encode(f.entry.reply("not_found"))), f.entry.pointer); }, async prepare() { return parseEntryReply(decode(f.encode(f.entry.reply("prepared"))), f.entry.pointer); }, async execute() { executed = true; throw new Error("must not execute"); } } as unknown as ReturnType<typeof createEntryClient>;
  const service = createEntryService(client, auth, { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } }, { async exclusive(_key, work) { return work(); } },
    { async plan() { return f.entry.context; }, async inspect() { throw new Error("downgrade must be refused before human review"); } });
  await assert.rejects(service.invoke("adjust_inventory", JSON.parse(f.entry.snapshot.requestBody), f.entry.identity, value => value));
  assert.equal(executed, false); assert.ok(service.pending(f.entry.identity.actorId));
});
