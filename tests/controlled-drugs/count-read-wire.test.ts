import assert from "node:assert/strict";
import test from "node:test";
import { parseCountReadReply, verifyCountReadReply } from "../../src/hub/features/controlled-drugs/count/count-read-wire.ts";
import { digestCountReceipt, digestCountRequest } from "../../src/hub/features/controlled-drugs/count/count-wire.ts";

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const A = id(1), B = id(2), MANAGER = id(3), COUNT = id(10), SNAPSHOT = id(11), CELL = id(20), CONTAINER = id(21), LOT = id(22), LOCATION = id(23);
const captured = "2026-10-26T10:00:00.000000Z", observed = "2026-10-26T10:01:00.000000Z", saved = "2026-10-26T10:02:00.000000Z";
const encoder = new TextEncoder();
const bytes = (value: unknown) => encoder.encode(JSON.stringify(value));
const read = (actor = MANAGER) => ({ schema_version: 1, actor_id: actor, count_id: COUNT });
function set(value: unknown, path: string[], replacement: unknown) {
  let at = value as Record<string, unknown>;
  for (const key of path.slice(0, -1)) at = at[key] as Record<string, unknown>;
  at[path.at(-1)!] = replacement;
}
function base() {
  return { schema_version: 1, state: "available", data: {
    count_id: COUNT, snapshot_id: SNAPSHOT, product: { id: id(30), name: "Synthetic stock", stock_unit: "mL" },
    site: { id: id(31), label: "Synthetic site" }, locations: [{ id: LOCATION, kind: "storage", label: "Synthetic cabinet" }],
    lots: [{ id: LOT, lot_number: "SYNTHETIC", expires_on: "infinity" }],
    units: [{ cell_id: CELL, container_id: CONTAINER, lot_id: LOT, channel: "available", dispense_id: null, allocation_id: null, intake_id: null,
      stock_unit: "mL", location_id: LOCATION, custodian_id: null, status: "onsite" }],
    containers: [{ container_id: CONTAINER, kind: "stock", label: "Synthetic bottle", stock_unit: "mL", location_id: LOCATION, custodian_id: null, status: "onsite" }],
    participants: [{ slot: "A", id: A, name: "Captured A", submitted: false }, { slot: "B", id: B, name: "Captured B", submitted: false }],
    captured_policy: { id: id(32), version: "9223372036854775807", meaning_version: "count-v1", meaning_text: "Synthetic engineering evidence" },
    captured_at: captured, history_state: "collecting", current_boundary_state: "unchanged", own_statement: null,
    statements: null, expected: null, comparison: null, terminal: null, read_at: "2026-10-26T11:00:00.000000Z",
  } };
}
function statement(slot: "A" | "B") {
  const actor = slot === "A" ? A : B;
  return { slot, actor: { id: actor, name: `Saved ${slot}` }, recorded_at: saved, request: {
    schema_version: 1 as const, operation_id: id(slot === "A" ? 40 : 41), actor_id: actor, count_id: COUNT, snapshot_id: SNAPSHOT,
    statement_id: id(slot === "A" ? 42 : 43), observed_at: observed, method: "manual_count" as const,
    quantities: [{ cell_id: CELL, quantity: "12.000" }], container_checks: [{ container_id: CONTAINER, presence: "present" as const }], findings: [],
  } };
}
async function own(slot: "A" | "B") {
  const s = statement(slot);
  const receipt = { schema_version: 1 as const, action: "statement" as const, operation_id: s.request.operation_id, count_id: COUNT, actor_id: s.actor.id,
    request_digest: await digestCountRequest("statement", s.request), result_ref: { kind: "statement" as const, id: s.request.statement_id, opaque_commitment: "c".repeat(64) }, receipt_digest: "0".repeat(64) };
  receipt.receipt_digest = await digestCountReceipt(receipt);
  return { ...s, receipt };
}
async function complete(viewer = MANAGER) {
  const value = base();
  set(value, ["data", "participants", "0", "submitted"], true); set(value, ["data", "participants", "1", "submitted"], true);
  set(value, ["data", "statements"], [statement("A"), statement("B")]);
  set(value, ["data", "expected"], [{ cell_id: CELL, quantity: "12.000", stock_unit: "mL" }]);
  set(value, ["data", "comparison"], { agreement: true, quantity_comparison: [{ cell_id: CELL, stock_unit: "mL", expected_quantity: "12.000",
    actor_a_quantity: "12.000", actor_b_quantity: "12.000", actor_a_matches_expected: true, actor_b_matches_expected: true, statements_match: true }],
    container_comparison: [{ container_id: CONTAINER, actor_a_presence: "present", actor_b_presence: "present" }], finding_counts: { a: 0, b: 0 } });
  if (viewer === A || viewer === B) set(value, ["data", "own_statement"], await own(viewer === A ? "A" : "B"));
  return value;
}
function terminal(value: unknown, state: "stale" | "cancelled" | "agreement" | "variance", reason: string | null = null) {
  set(value, ["data", "history_state"], state);
  set(value, ["data", "terminal"], { kind: state === "cancelled" ? "cancellation" : "outcome", id: id(70), history_state: state,
    recorded_at: "2026-10-26T10:03:00.000000Z", actor: { id: MANAGER, name: "Saved manager" }, reason });
}

test("closed empty observation view retains exact version/date strings and has no expected quantity", () => {
  const result = parseCountReadReply(bytes(base()), read());
  assert.equal(result.data.captured_policy.version, "9223372036854775807"); assert.equal(result.data.lots[0].expires_on, "infinity");
  assert.equal(result.data.expected, null); assert.equal(result.data.own_statement, null);
  assert.ok(Object.isFrozen(result.data.units[0]));
});

test("own original request/receipt works across sessions while the other observation remains hidden", async () => {
  for (const slot of ["A", "B"] as const) {
    const value = base(); set(value, ["data", "participants", slot === "A" ? "0" : "1", "submitted"], true);
    set(value, ["data", "own_statement"], await own(slot));
    const result = await verifyCountReadReply(bytes(value), read(slot === "A" ? A : B));
    assert.equal(result.data.own_statement?.actor.name, `Saved ${slot}`); assert.equal(result.data.expected, null); assert.equal(result.data.comparison, null);
    set(value, ["data", "own_statement"], null); assert.equal(parseCountReadReply(bytes(value), read()).data.own_statement, null);
  }
});

test("two complete observations reveal exact attributed values while remaining collecting", async () => {
  const result = await verifyCountReadReply(bytes(await complete(A)), read(A));
  assert.equal(result.data.history_state, "collecting"); assert.equal(result.data.terminal, null);
  assert.equal(result.data.statements?.[1].actor.name, "Saved B"); assert.equal(result.data.participants[1].name, "Captured B");
  assert.equal(result.data.expected?.[0].quantity, "12.000"); assert.equal(result.data.comparison?.agreement, true);
});

test("pre-two visibility rejects every hidden field even for a manager/stale/cancelled count", () => {
  for (const state of ["collecting", "stale", "cancelled"] as const) {
    for (const [field, leak] of [["expected", []], ["statements", []], ["comparison", {}]] as const) {
      const value = base(); if (state !== "collecting") terminal(value, state);
      set(value, ["data", field], leak); assert.throws(() => parseCountReadReply(bytes(value), read()));
    }
    if (state !== "collecting") { const value = base(); terminal(value, state, "Hidden reason"); assert.throws(() => parseCountReadReply(bytes(value), read())); }
  }
});

test("fully formed other observations/expected values remain forbidden with zero or one submission", async () => {
  const full = await complete();
  for (const one of [false, true]) for (const state of ["collecting", "stale", "cancelled"] as const) {
    for (const field of ["statements", "expected", "comparison"] as const) {
      const value = base(); set(value, ["data", "participants", "0", "submitted"], one);
      if (state !== "collecting") terminal(value, state);
      set(value, ["data", field], full.data[field]);
      assert.throws(() => parseCountReadReply(bytes(value), read()));
    }
  }
});

test("manager does not acquire someone else's request and submitted observer cannot lose own receipt", async () => {
  const value = base(); set(value, ["data", "participants", "0", "submitted"], true);
  set(value, ["data", "own_statement"], await own("A")); assert.throws(() => parseCountReadReply(bytes(value), read()));
  set(value, ["data", "own_statement"], null); assert.throws(() => parseCountReadReply(bytes(value), read(A)));
});

test("raw duplicate keys, BOM, invalid UTF8, alternate integer spellings and unknown/private fields refuse", () => {
  const json = JSON.stringify(base());
  for (const raw of [encoder.encode(json.replace('"schema_version":1', '"schema_version":1,"schema_version":1')),
    encoder.encode("\uFEFF" + json), new Uint8Array([0xff]), encoder.encode(json.replace('"schema_version":1', '"schema_version":1.0')),
    encoder.encode(json.replace('"schema_version":1', '"schema_version":1e0'))]) assert.throws(() => parseCountReadReply(raw, read()));
  for (const path of [["private_hash"], ["data", "units", "0", "expected_quantity"], ["data", "product", "price"]]) {
    const value = base(); set(value, path, "hidden"); assert.throws(() => parseCountReadReply(bytes(value), read()));
  }
});

test("policy versions and quantities never accept Number coercion or noncanonical spelling", async () => {
  for (const version of ["0", "01", "9223372036854775808", 1, "1.0"]) {
    const value = base(); set(value, ["data", "captured_policy", "version"], version); assert.throws(() => parseCountReadReply(bytes(value), read()));
  }
  for (const quantity of [12, "12", "12.00", "012.000", "1.2e1", "-1.000"]) {
    const value = await complete(); set(value, ["data", "expected", "0", "quantity"], quantity); assert.throws(() => parseCountReadReply(bytes(value), read()));
  }
});

test("full membership, order, scope, custody and exact comparison relations refuse changed values", async () => {
  const edits: [string[], unknown][] = [
    [["data", "count_id"], id(500)], [["data", "lots"], []], [["data", "locations"], []], [["data", "containers"], []],
    [["data", "units", "0", "container_id"], id(500)], [["data", "units", "0", "stock_unit"], "tablets"],
    [["data", "units", "0", "intake_id"], id(500)], [["data", "participants", "1", "id"], A],
    [["data", "statements", "1", "slot"], "A"], [["data", "statements", "1", "request", "snapshot_id"], id(500)],
    [["data", "statements", "1", "request", "quantities"], []], [["data", "comparison", "agreement"], false],
    [["data", "comparison", "quantity_comparison", "0", "actor_a_matches_expected"], false],
    [["data", "comparison", "quantity_comparison", "0", "expected_quantity"], "11.000"], [["data", "comparison", "finding_counts", "a"], 1],
  ];
  for (const [path, replacement] of edits) { const value = await complete(); set(value, path, replacement); assert.throws(() => parseCountReadReply(bytes(value), read())); }
  const duplicate = base(); set(duplicate, ["data", "units"], [duplicate.data.units[0], duplicate.data.units[0]]);
  assert.throws(() => parseCountReadReply(bytes(duplicate), read()));
});

test("a missing container/finding prevents agreement even when both quantities equal expected", async () => {
  const value = await complete();
  set(value, ["data", "statements", "0", "request", "container_checks", "0", "presence"], "missing");
  set(value, ["data", "comparison", "container_comparison", "0", "actor_a_presence"], "missing");
  assert.throws(() => parseCountReadReply(bytes(value), read()));
  set(value, ["data", "comparison", "agreement"], false); terminal(value, "variance");
  assert.equal(parseCountReadReply(bytes(value), read()).data.comparison?.agreement, false);
});

test("immutable terminal history remains separate from current boundary status", async () => {
  for (const boundary of ["unchanged", "changed"]) {
    const value = await complete(); terminal(value, "agreement"); set(value, ["data", "current_boundary_state"], boundary);
    assert.equal(parseCountReadReply(bytes(value), read()).data.history_state, "agreement");
  }
  const stale = base(); terminal(stale, "stale"); assert.equal(parseCountReadReply(bytes(stale), read()).data.history_state, "stale");
  const cancelled = await complete(); terminal(cancelled, "cancelled", "Synthetic cancellation reason");
  assert.equal(parseCountReadReply(bytes(cancelled), read()).data.terminal?.reason, "Synthetic cancellation reason");
  for (const reason of [null, "\u200b", "x".repeat(1025)]) {
    terminal(cancelled, "cancelled", reason); assert.throws(() => parseCountReadReply(bytes(cancelled), read()));
  }
});

test("timestamps require actual UTC6 dates and chronological saved evidence", async () => {
  for (const value of ["2026-02-29T10:00:00.000000Z", "2026-10-26T10:00:00Z", "2026-10-26T10:00:60.000000Z"]) {
    const fixture = base(); set(fixture, ["data", "read_at"], value); assert.throws(() => parseCountReadReply(bytes(fixture), read()));
  }
  const value = await complete(); terminal(value, "agreement"); set(value, ["data", "terminal", "recorded_at"], captured);
  assert.throws(() => parseCountReadReply(bytes(value), read()));
});

test("only own receipt is verified and inputs cannot change during an asynchronous digest", async () => {
  const value = await complete(A), raw = bytes(value), input = read(A), pending = verifyCountReadReply(raw, input);
  raw.fill(0); input.actor_id = MANAGER; set(value, ["data", "own_statement", "request", "quantities", "0", "quantity"], "99.000");
  const result = await pending; assert.equal(result.data.own_statement?.request.quantities[0].quantity, "12.000");
  assert.ok(Object.isFrozen(result.data.own_statement?.request.quantities));
  const wrong = await complete(A); set(wrong, ["data", "own_statement", "receipt", "request_digest"], "0".repeat(64));
  await assert.rejects(() => verifyCountReadReply(bytes(wrong), read(A)));
});

test("raw2MiB ceiling is inclusive and member limits fail before Zod traversal", () => {
  const json = JSON.stringify(base()), maximum = 2 * 1024 * 1024, raw = encoder.encode(json + " ".repeat(maximum - encoder.encode(json).length));
  assert.equal(parseCountReadReply(raw, read()).state, "available"); assert.throws(() => parseCountReadReply(new Uint8Array(maximum + 1), read()));
  const value = base(); set(value, ["data", "units"], Array(513).fill({})); assert.throws(() => parseCountReadReply(bytes(value), read()));
});

test("intrinsic byte size rejects a real over-limit view even when public properties lie", () => {
  const json = JSON.stringify(base()), maximum = 2 * 1024 * 1024;
  const oversized = encoder.encode(json + " ".repeat(maximum + 1 - encoder.encode(json).length));
  Object.defineProperty(oversized, "byteLength", { value: 1 });
  Object.defineProperty(oversized, "length", { value: 1 });
  assert.throws(() => parseCountReadReply(oversized, read()));
  const valid = bytes(base());
  for (const key of ["byteLength", "length", "buffer", "byteOffset", Symbol.iterator])
    Object.defineProperty(valid, key, { get() { throw new Error("Caller metadata must not be consulted"); } });
  assert.equal(parseCountReadReply(valid, read()).state, "available");
  const spoof = { byteLength: 1, [Symbol.toStringTag]: "Uint8Array" };
  assert.throws(() => parseCountReadReply(spoof as unknown as Uint8Array, read()));
  assert.throws(() => parseCountReadReply(new Proxy(bytes(base()), {}) as Uint8Array, read()));
});

test("a bounded subview copies only its actual bytes without invoking a subclass iterator/species", () => {
  class HostileBytes extends Uint8Array {
    static get [Symbol.species](): Uint8ArrayConstructor { throw new Error("Species must not be invoked"); }
    [Symbol.iterator](): ArrayIterator<number> { throw new Error("Iterator must not be invoked"); }
  }
  const raw = bytes(base()), buffer = new Uint8Array(raw.length + 8); buffer.set(raw, 4);
  const view = new HostileBytes(buffer.buffer, 4, raw.length);
  assert.equal(parseCountReadReply(view, read()).state, "available");
});
