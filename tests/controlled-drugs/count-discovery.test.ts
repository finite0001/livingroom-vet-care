import assert from "node:assert/strict";
import test from "node:test";
import { parseCountDiscoveryReply, parseCountDiscoveryRequest } from "../../src/hub/features/controlled-drugs/count/count-discovery.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const raw = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const request = { schema_version: 1, actor_id: id(1), product_id: id(2), site_id: id(3), cursor: null, page_size: 2 };
const entry = (n: number) => ({ count_id: id(n), captured_at: "2026-10-26T16:00:00.000000Z", history_state: "open", participants: [
  { slot: "A", id: id(1), name: "Synthetic A", submitted: true }, { slot: "B", id: id(4), name: "Synthetic B", submitted: false }] });
const base = () => ({ schema_version: 1, product_id: id(2), site_id: id(3), capabilities: { observe: true, manage: true, reconciliation_prepare: false,
  reconciliation_approve: false, reconciliation_execute: false, reconciliation_confirm: false, cause_resolve: false }, available_actions: ["start", "read", "discovery"],
  observers: [{ id: id(4), name: "Synthetic B" }], counts: [entry(9), entry(8)], next_cursor: { captured_at: entry(8).captured_at, count_id: id(8) }, has_more: true });
test("discovery binds a closed, paged, quantity-free list to the requested product and site", () => {
  const result = parseCountDiscoveryReply(raw(base()), request);
  assert.ok(Object.isFrozen(result.counts[0].participants[0])); assert.equal(result.counts.length, 2);
  assert.throws(() => parseCountDiscoveryRequest({ ...request, page_size: "2" }));
  assert.throws(() => parseCountDiscoveryReply(raw({ ...base(), product_id: id(99) }), request));
  assert.throws(() => parseCountDiscoveryReply(raw({ ...base(), quantities: [] }), request));
  const getter = { ...request }; Object.defineProperty(getter, "actor_id", { enumerable: true, get() { throw new Error("getter executed"); } });
  assert.throws(() => parseCountDiscoveryRequest(getter), error => error instanceof Error && !error.message.includes("getter executed"));
});
test("cursor boundaries, duplicates, ordering and terminal pagination refuse inconsistent replies", () => {
  const value = base();
  for (const change of [{ counts: [...value.counts].reverse() }, { counts: [entry(9), entry(9)] }, { next_cursor: null }, { has_more: false }, { next_cursor: { ...value.next_cursor, count_id: id(7) } }])
    assert.throws(() => parseCountDiscoveryReply(raw({ ...value, ...change }), request));
  assert.throws(() => parseCountDiscoveryReply(raw(value), { ...request, cursor: { captured_at: entry(9).captured_at, count_id: id(9) } }));
  assert.throws(() => parseCountDiscoveryReply(raw(value), { ...request, page_size: 1 }));
  assert.equal(parseCountDiscoveryReply(raw({ ...value, counts: [], next_cursor: null, has_more: false }), request).has_more, false);
});
test("discovery refuses duplicate identities, hidden quantities, malformed timestamps and ambiguous protocol numbers", () => {
  const value = base();
  for (const counts of [[{ ...entry(9), expected: "10.000" }], [{ ...entry(9), captured_at: "2026-02-30T16:00:00.000000Z" }], [{ ...entry(9), participants: [entry(9).participants[0], entry(9).participants[0]] }]])
    assert.throws(() => parseCountDiscoveryReply(raw({ ...value, counts }), request));
  assert.throws(() => parseCountDiscoveryReply(raw({ ...value, observers: [value.observers[0], value.observers[0]] }), request));
  assert.throws(() => parseCountDiscoveryReply(raw({ ...value, capabilities: { ...value.capabilities, observe: false } }), request));
  assert.throws(() => parseCountDiscoveryReply(new TextEncoder().encode(JSON.stringify(value).replace('"schema_version":1', '"schema_version":1e0')), request));
  const oversized = new Uint8Array(2 * 1024 * 1024 + 1); Object.defineProperty(oversized, "byteLength", { value: 1 });
  assert.throws(() => parseCountDiscoveryReply(oversized, request));
});
test("staff-name limits count Unicode code points as PostgreSQL does", () => {
  const value = base(); value.observers[0].name = "𐐀".repeat(200);
  assert.equal(parseCountDiscoveryReply(raw(value), request).observers[0].name, value.observers[0].name);
  value.observers[0].name += "𐐀";
  assert.throws(() => parseCountDiscoveryReply(raw(value), request));
});
