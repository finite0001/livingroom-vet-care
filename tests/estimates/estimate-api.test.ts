import test from "node:test";
import assert from "node:assert/strict";
import {
  createEstimateDraftApi, estimateLineCents, estimateTotalCents, estimateFieldsSchema,
  dollarsToEstimateCents, parseQuantity,
  type EstimateLine, type EstimateOperation, type EstimateReceipt, type EstimateDraft,
} from "../../src/hub/features/estimates/estimate-api.ts";

const id = (n: number) => `fa510000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = id(1), household = id(2), time = "2026-09-16T12:00:00Z", hash = "a".repeat(64);
function line(): EstimateLine {
  return { id: id(4), product_id: id(5), product_version: 1, description: "Synthetic service", kind: "service",
    unit: "unit", quantity: "1.5", pricing: { kind: "unit", unit_price_cents: "125" }, pricing_reason: null };
}
function operation(): EstimateOperation {
  return { id: id(7), kind: "save_estimate_draft", payload: { estimate_id: id(8), client_id: household, pet_id: id(3), expected_version: null,
    fields: { title: "Draft care estimate", notes: "", terms: "Synthetic terms", accept_by: "2026-10-31", lines: [line()] } } };
}
function receipt(op = operation()): EstimateReceipt {
  return { version: 1, id: op.id, actor_id: actor, request: structuredClone(op.payload), request_hash: hash,
    result: { id: op.payload.estimate_id, client_id: household, pet_id: id(3), version: (op.payload.expected_version ?? 0) + 1,
      fields: structuredClone(op.payload.fields), total_cents: estimateTotalCents(op.payload.fields.lines),
      created_by: actor, created_at: time, updated_by: actor, updated_at: time }, created_at: time };
}
function api(raw: unknown, error: unknown = null) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  return { calls, client: createEstimateDraftApi({ rpc: async (name, args) => { calls.push({ name, args }); return { data: raw, error }; } }, actor, household) };
}
test("exact quantity and half-up pricing retain integer cents and reject noncanonical input", () => {
  assert.equal(parseQuantity("99999999999.999"), 99999999999999n);
  assert.equal(estimateLineCents(line()), "188");
  assert.equal(estimateLineCents({ ...line(), quantity: "0.5", pricing: { kind: "unit", unit_price_cents: "1" } }), "1");
  for (const q of ["0", "1.0", "01", "1.2345", "NaN", "1e2", "100000000000", "-1", " 1"])
    assert.throws(() => parseQuantity(q));
  assert.equal(dollarsToEstimateCents("90071992547409.93"), "9007199254740993");
  for (const q of ["1.234", "1e2", "-1", ".50", " 1"]) assert.throws(() => dollarsToEstimateCents(q));
});
test("allocated prices are full line amounts, require reasons and cannot overflow totals", () => {
  const allocated: EstimateLine = { ...line(), pricing: { kind: "allocated", amount_cents: "99" }, pricing_reason: "Package allocation" };
  assert.equal(estimateLineCents(allocated), "99");
  assert.equal(estimateTotalCents([line(), allocated]), "287");
  assert.throws(() => estimateLineCents({ ...allocated, pricing_reason: null }));
  assert.throws(() => estimateLineCents({ ...line(), quantity: "0.001", pricing: { kind: "unit", unit_price_cents: "1" } }));
  assert.equal(estimateLineCents({ ...allocated, pricing: { kind: "allocated", amount_cents: "0" } }), "0");
  assert.throws(() => estimateTotalCents([{ ...allocated, pricing: { kind: "allocated", amount_cents: "9223372036854775807" } }, allocated]));
  assert.throws(() => estimateLineCents({ ...line(), quantity: "99999999999.999", pricing: { kind: "unit", unit_price_cents: "9223372036854775807" } }));
});
test("fields reject invalid calendar dates, controls, duplicate line identities and expanded shapes", () => {
  const f = operation().payload.fields;
  for (const accept_by of ["2026-02-29", "2026-04-31", "2026-1-01", "0000-01-01"])
    assert.equal(estimateFieldsSchema.safeParse({ ...f, accept_by }).success, false);
  assert.equal(estimateFieldsSchema.safeParse({ ...f, accept_by: "2028-02-29" }).success, true);
  assert.equal(estimateFieldsSchema.safeParse({ ...f, title: "Bad\u0001title" }).success, false);
  assert.equal(estimateFieldsSchema.safeParse({ ...f, lines: [line(), line()] }).success, false);
  assert.equal(estimateFieldsSchema.safeParse({ ...f, lines: [line(), { ...line(), id: id(9) }] }).success, true);
  assert.equal(estimateFieldsSchema.safeParse({ ...f, approved: true }).success, false);
  for (const value of ["NaN", "1e3", "", "-1", "9223372036854775808"])
    assert.equal(estimateFieldsSchema.safeParse({ ...f, lines: [{ ...line(), pricing: { kind: "unit", unit_price_cents: value } }] }).success, false);
});
test("save and recovery bind exact actor, household, request, version and calculated amount", async () => {
  const op = operation(), r = receipt(op), a = api(r);
  assert.deepEqual(await a.client.save(op), r);
  assert.deepEqual(a.calls[0], { name: "save_native_estimate_draft", args: { p_id: op.id, p_request: op.payload } });
  assert.deepEqual(await a.client.recover(op), r);
  for (const mutate of [
    (v: EstimateReceipt) => { v.actor_id = id(10); },
    (v: EstimateReceipt) => { v.result.client_id = id(10); },
    (v: EstimateReceipt) => { v.result.pet_id = id(10); },
    (v: EstimateReceipt) => { v.result.total_cents = "187"; },
    (v: EstimateReceipt) => { v.result.version = 2; },
    (v: EstimateReceipt) => { v.result.updated_by = id(10); },
    (v: EstimateReceipt) => { v.request.fields.title = "Different request"; },
    (v: EstimateReceipt) => { v.result.fields.title = "Different result"; },
    (v: EstimateReceipt) => { v.created_at = "2026-09-16T12:00:00.000001Z"; },
  ]) { const changed = structuredClone(r); mutate(changed); await assert.rejects(api(changed).client.save(op)); }
});
test("invalid local requests never reach transport and RPC failures remain failures", async () => {
  const a = api(receipt()), wrong = operation(); wrong.payload.client_id = id(10);
  await assert.rejects(a.client.save(wrong)); assert.equal(a.calls.length, 0);
  const stale = { code: "40001", message: "Changed catalog" };
  await assert.rejects(api(null, stale).client.save(operation()), e => e === stale);
  assert.equal(await api(null).client.recover(operation()), null);
  await assert.rejects(api(null).client.save(operation()));
});
test("resolution validates both recorded and terminal closed outcomes against exact pending operation", async () => {
  const op = operation(), r = receipt(op), closed = { version: 1, status: "closed_unrecorded", closure: {
    version: 1, id: op.id, actor_id: actor, request: op.payload, request_hash: hash, closed_at: time, record_hash: hash } };
  const a = api(closed); assert.deepEqual(await a.client.close(op), closed);
  assert.deepEqual(a.calls[0], { name: "close_native_estimate_draft", args: { p_id: op.id, p_request: op.payload } });
  assert.deepEqual(await api({ version: 1, status: "recorded", receipt: r }).client.close(op), { version: 1, status: "recorded", receipt: r });
  for (const closure of [{ ...closed.closure, actor_id: id(10) }, { ...closed.closure, id: id(10) },
    { ...closed.closure, request: { ...op.payload, pet_id: id(10) } }, { ...closed.closure, record_hash: "bad" }, { ...closed.closure, extra: true }])
    await assert.rejects(api({ ...closed, closure }).client.close(op));
  await assert.rejects(api(null).client.close(op));
});
test("read and list reject another household or target and verify page completeness", async () => {
  const d = receipt().result;
  assert.deepEqual(await api({ version: 1, actor_id: actor, draft: d }).client.read(d.id), d);
  await assert.rejects(api({ version: 1, actor_id: actor, draft: { ...d, id: id(10) } }).client.read(d.id));
  const page = { version: 1, actor_id: actor, client_id: household, drafts: [d], has_more: true, next_cursor: { before_at: d.created_at, before_id: d.id } };
  assert.deepEqual(await api(page).client.list(null, 1), page);
  await assert.rejects(api(page).client.list(null, 2));
  await assert.rejects(api({ ...page, next_cursor: null }).client.list(null, 1));
  await assert.rejects(api({ ...page, drafts: [d, d] }).client.list(null, 2));
  await assert.rejects(api({ ...page, has_more: false, next_cursor: null }).client.list(page.next_cursor, 1));
});
test("history requires contiguous versions, preserved identity and an honest final page", async () => {
  const d = receipt().result, v2: EstimateDraft = { ...d, version: 2, updated_at: "2026-09-17T12:00:00Z" };
  const page = { version: 1, actor_id: actor, client_id: household, estimate_id: d.id, revisions: [v2, d], has_more: false, next_before_version: null };
  assert.deepEqual(await api(page).client.history(d.id), page);
  assert.deepEqual(await api(page).client.history(d.id, 100), page);
  await assert.rejects(api({ ...page, revisions: [v2] }).client.history(d.id));
  await assert.rejects(api({ ...page, revisions: [{ ...v2, version: 3 }, d] }).client.history(d.id));
  await assert.rejects(api({ ...page, revisions: [v2, { ...d, pet_id: id(10) }] }).client.history(d.id));
  const paged = { ...page, revisions: [v2], has_more: true, next_before_version: 2 };
  assert.deepEqual(await api(paged).client.history(d.id, null, 1), paged);
  await assert.rejects(api({ ...paged, next_before_version: 3 }).client.history(d.id, null, 1));
});
