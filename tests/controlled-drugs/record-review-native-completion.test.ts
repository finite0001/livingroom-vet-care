import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { hashReviewNativeDocument, hashReviewNativeFulfillmentReceipt, hashReviewNativeRequest, hashReviewNativeRecord } from "../../src/hub/features/controlled-drugs/record-review/component-hashes.ts";
import { reviewQuantityThousandths } from "../../src/hub/features/controlled-drugs/record-review/exact-values.ts";
import { prospectiveSourceShapes } from "../../src/hub/features/controlled-drugs/record-review/prospective-source-shapes.ts";
import { nativeOpeningEntrySchema, nativeFulfillmentRefillEventSchema, nativeHeadSchema, nativeObject, nativeInteger, nativeInvalid } from "../../src/hub/features/controlled-drugs/record-review/native-movement-structure.ts";
import { sameReviewJsonb } from "../../src/hub/features/controlled-drugs/record-review/jsonb-equality.ts";
import { fixture, n, o, a, clone, type MutableObject, type MutableJson } from "./record-review-native-test-data.ts";

// SOURCE-DERIVED UNIT DATA ONLY. These transform a lossless synthetic corpus
// copy in RAM; none is an accepted genuine-Auth fixture or DB-membership proof.
const stored = (q: bigint) => q / 1000n + "." + (q % 1000n).toString().padStart(3, "0");
const ids = { refill: "aabbccdd-0000-4000-8000-000000000001", head: "11112222-0000-4000-8000-000000000002", dispenseEvent: "11112222-0000-4000-8000-000000000003", pickupEvent: "11112222-0000-4000-8000-000000000004", laterHead: "11112222-0000-4000-8000-000000000005" };
function refillUnit(pickup = false, close = true, later = false) {
  const f = fixture(pickup ? 7 : 0), d = f.rows("public.native_dispenses")[0], doc = o(d.document), op = f.row("public.native_fulfillment_operations", d.id), c = o(doc.reviewed_context), request = o(op.request);
  const before: MutableObject = { id: ids.refill, pet_id: d.pet_id, client_id: doc.client_id, version: n("2"), state: "open", medication_requested: "Synthetic unit refill", requester_note: null, channel: "phone", assigned_to: null,
    authorization_id: d.authorization_id, authorization_hash: doc.authorization_hash, created_by: d.actor_id, created_at: d.dispensed_at, updated_by: d.actor_id, updated_at: d.dispensed_at };
  request.refill = { id: ids.refill, expected_version: n("2") }; o(c.target).refill = clone(request.refill); c.refill = { refill: clone(before), head_id: ids.head };
  const after: MutableObject = { ...before, version: n("3"), updated_by: d.actor_id, updated_at: op.created_at };
  const event: MutableObject = { version: n("2"), id: ids.dispenseEvent, refill_id: ids.refill, revision: n("3"), action: "dispense", actor_id: d.actor_id, reason: request.reason, prior_event_id: ids.head,
    before: clone(before), after, link_context: null, created_at: op.created_at, fulfillment_reference: { kind: "dispense", id: d.id, dispense_id: d.id, authorization_id: d.authorization_id } };
  doc.refill_id = ids.refill; doc.refill_event_id = ids.dispenseEvent; o(op.result).refill_event = event;
  let pc: MutableObject | null = null, pr: MutableObject | null = null;
  if (pickup) {
    const p = f.native("pickup"), pd = o(p.document), po = f.row("public.native_fulfillment_operations", p.id); pc = o(pd.reviewed_context); pr = o(po.request);
    if (close) {
      const pb = clone(after) as MutableObject; if (later) { pb.version = n("4"); pb.assigned_to = p.actor_id; pb.updated_by = p.actor_id; }
      pc.refill = { refill: pb, head_id: later ? ids.laterHead : ids.dispenseEvent };
      pr.refill_close = { id: ids.refill, expected_version: pb.version, reason: "Synthetic unit close" }; pd.refill_id = ids.refill; pd.refill_event_id = ids.pickupEvent;
    }
  }
  return { f, before, after, event, d, doc, op, c, request, pc, pr };
}
function keyText(key: MutableObject): string {
  return "{" + Object.keys(key).sort((x, y) => x.length - y.length || (x < y ? -1 : x > y ? 1 : 0)).map(k => JSON.stringify(k) + ": " + JSON.stringify(key[k])).join(", ") + "}";
}
function addSource(f: ReturnType<typeof fixture>, relation: keyof typeof prospectiveSourceShapes, row: MutableObject, role: string) {
  const key = Object.fromEntries(prospectiveSourceShapes[relation].key.map(k => [k, row[k]]));
  f.sources.push({ relation, key, row }); a(f.adapter.source_refs).push({ relation, key: clone(key), role, row_hash: "0".repeat(64) });
}
function sortSources(f: ReturnType<typeof fixture>) {
  const pairs = f.sources.map((source, i) => ({ source, ref: a(f.adapter.source_refs)[i] }));
  pairs.sort((x, y) => { const a = String(x.source.relation) + "\n" + keyText(o(x.source.key)), b = String(y.source.relation) + "\n" + keyText(o(y.source.key)); return a < b ? -1 : a > b ? 1 : 0; });
  f.sources.splice(0, f.sources.length, ...pairs.map(p => p.source)); a(f.adapter.source_refs).splice(0, pairs.length, ...pairs.map(p => p.ref));
}
async function openingUnit(operational = false, split = false, zero = false) {
  const f = fixture(operational ? 9 : 8), correction = f.native("correction"), d = f.native("dispense", correction.dispense_id), doc = o(d.document), op = f.row("public.native_fulfillment_operations", d.id), opening = f.row("public.controlled_stock_openings");
  const oldPrepared = f.rows("public.controlled_stock_containers").find(c => c.kind === "prepared")!, oldCell = f.rows("public.controlled_stock_cells").find(c => c.channel === "prepared")!;
  const box = clone(oldPrepared) as MutableObject, cell = clone(oldCell) as MutableObject;
  Object.assign(box, { opening_id: opening.id, created_event_id: null, actor_id: opening.actor_id, session_id: opening.session_id });
  Object.assign(cell, { opening_id: opening.id, created_event_id: null, opening_quantity: f.row("public.native_dispense_allocations").quantity });
  const keepRelations = new Set(["public.controlled_stock_policy_versions", "public.controlled_stock_openings"]);
  for (let i = f.sources.length - 1; i >= 0; i--) {
    const source = f.sources[i], relation = String(source.relation), row = o(source.row);
    if (relation.startsWith("public.controlled_stock_") && !keepRelations.has(relation) && (row.id === d.id || row.event_id === d.id || ["public.controlled_stock_cells", "public.controlled_stock_containers", "public.controlled_stock_opening_movements"].includes(relation))) {
      f.sources.splice(i, 1); a(f.adapter.source_refs).splice(i, 1);
    }
  }
  for (const allocation of f.rows("public.native_dispense_allocations")) {
    const movement = f.row("public.inventory_movements", allocation.movement_id);
    addSource(f, "public.controlled_stock_opening_movements", { opening_id: opening.id, movement_id: movement.id, lot_id: movement.lot_id, quantity: movement.quantity, source_snapshot: clone(movement) }, "opening_basis");
  }
  opening.observed_at = d.dispensed_at; opening.recorded_at = op.created_at;
  opening.native_custody_boundary = [{ version: n("1"), dispense_id: d.id, dispense_document_hash: await hashReviewNativeDocument("dispense", doc), dispense_operation_hash: await hashReviewNativeFulfillmentReceipt({ version: n("1"), ...op }),
    return_head: { event_id: null, version: n("0"), record_hash: null }, correction_head: { event_id: null, version: n("0"), record_hash: null }, discrepancy_head: { event_id: null, version: n("0"), record_hash: null }, pickup: null,
    allocations: f.rows("public.native_dispense_allocations").map(a => ({ allocation_id: a.id, lot_id: a.lot_id, dispensed_quantity: stored(reviewQuantityThousandths(a.quantity as never)), prepared_quantity: stored(reviewQuantityThousandths(a.quantity as never)), held: [] })) }];
  const total = reviewQuantityThousandths(cell.opening_quantity as never); if (split) cell.opening_quantity = n(stored(total / 2n));
  addSource(f, "public.controlled_stock_containers", box, "opening_basis"); addSource(f, "public.controlled_stock_cells", cell, "opening_basis");
  if (split || zero) {
    const extraBox = { ...box, id: "eeee0000-0000-4000-8000-000000000001" }, extraCell = { ...cell, id: "eeee0000-0000-4000-8000-000000000002", container_id: extraBox.id, opening_quantity: n(split ? stored(total - total / 2n) : "0.000") };
    addSource(f, "public.controlled_stock_containers", extraBox, "opening_basis"); addSource(f, "public.controlled_stock_cells", extraCell, "opening_basis");
  }
  f.adapter.site_basis = "opening_custody_site"; sortSources(f);
  return { f, opening, entry: o(a(opening.native_custody_boundary)[0]), box, cell };
}

test("source-derived unit refill variants pass supplied local consistency; no genuine-Auth fixture claim", async t => {
  for (const [name, pickup, close, later] of [["dispense", false, false, false], ["pickup closure", true, true, false], ["optional no-close on linked D", true, false, false], ["pickup later revision", true, true, true]] as const) await t.test(name, async () => {
    const u = refillUnit(pickup, close, later); await u.f.recommit(); await u.f.component(); await u.f.check();
  });
});
test("recommitted refill identity/transition/reference mutants refuse", async t => {
  const changes: Record<string, (u: ReturnType<typeof refillUnit>) => void> = {
    before_patient(u) { o(o(u.c.refill).refill).pet_id = u.f.event.product_id; }, before_state(u) { o(o(u.c.refill).refill).state = "closed"; }, expected_version(u) { o(u.request.refill).expected_version = n("1"); o(u.c.target).refill = clone(u.request.refill); },
    event_id(u) { u.event.id = ids.head; }, event_actor(u) { u.event.actor_id = u.f.event.product_id; }, prior_head(u) { u.event.prior_event_id = ids.pickupEvent; }, reason(u) { u.event.reason = "Changed reason"; },
    revision(u) { u.event.revision = n("4"); }, after_state(u) { u.after.state = "closed"; }, after_other_field(u) { u.after.channel = "email"; }, after_actor(u) { u.after.updated_by = u.f.event.product_id; },
    reference_kind(u) { o(u.event.fulfillment_reference).kind = "pickup"; }, reference_operation(u) { o(u.event.fulfillment_reference).id = ids.head; }, document_refill(u) { u.doc.refill_id = ids.head; }, partial_null(u) { u.doc.refill_event_id = null; },
  };
  for (const [name, mutate] of Object.entries(changes)) await t.test(name, async () => { const u = refillUnit(); mutate(u); await u.f.recommit(); await u.f.component(); await assert.rejects(u.f.check()); });
  await t.test("pickup version regression", async () => { const u = refillUnit(true), before = o(o(u.pc!.refill).refill); before.version = n("2"); o(u.pr!.refill_close).expected_version = n("2"); await u.f.recommit(); await u.f.component(); await assert.rejects(u.f.check()); });
});
test("opening-custody source-derived unit branches and same-site split/zero cells pass", async t => {
  for (const [name, operational, split, zero] of [["clinical", false, false, false], ["operational", true, false, false], ["split allocation", false, true, false], ["same-site zero", false, false, true]] as const) await t.test(name, async () => { const u = await openingUnit(operational, split, zero); await u.f.recommit(); await u.f.component(); await u.f.check(); });
});
test("recommitted opening graph/site/quantity/hash mutants refuse", async t => {
  const changes: Record<string, (u: Awaited<ReturnType<typeof openingUnit>>) => void> = {
    wrong_document_hash(u) { u.entry.dispense_document_hash = "0".repeat(64); }, wrong_operation_hash(u) { u.entry.dispense_operation_hash = "0".repeat(64); },
    duplicate_entry(u) { a(u.opening.native_custody_boundary).push(clone(u.entry)); }, return_head(u) { u.entry.return_head = { event_id: u.f.event.id, version: n("1"), record_hash: u.f.event.record_hash }; },
    prior_selector(u) { u.entry.correction_head = { event_id: u.f.event.id, version: n("1"), record_hash: u.f.event.record_hash }; }, quantity(u) { o(a(u.entry.allocations)[0]).prepared_quantity = "1.999"; },
    held(u) { a(o(a(u.entry.allocations)[0]).held).push({ intake_id: u.f.event.id, quantity: "0.000" }); }, wrong_cell_lot(u) { u.cell.lot_id = u.f.event.product_id; }, cell_intake(u) { u.cell.intake_id = u.f.event.id; },
    negative_cell(u) { u.cell.opening_quantity = n("-1.000"); }, wrong_box_kind(u) { u.box.kind = "stock"; }, wrong_box_unit(u) { u.box.stock_unit = "other"; }, wrong_box_opening(u) { u.box.opening_id = u.f.event.product_id; },
    missing_quantity(u) { u.cell.opening_quantity = n("0.000"); }, site_fallback(u) { u.f.adapter.site_basis = "event_transitions"; },
  };
  for (const [name, mutate] of Object.entries(changes)) await t.test(name, async () => { const u = await openingUnit(); mutate(u); await u.f.recommit(); await u.f.component(); await assert.rejects(u.f.check()); });
  for (const zero of [false, true]) await t.test(zero ? "zero-only distinct site" : "two positive sites", async () => { const u = await openingUnit(false, !zero, zero), boxes = u.f.rows("public.controlled_stock_containers"); boxes[1].controlling_site_id = u.f.event.product_id; await u.f.recommit(); await u.f.component(); await assert.rejects(u.f.check()); });
});
test("new schema/hash entry boundaries remain strict and bounded", async () => {
  const u = refillUnit(); await u.f.recommit();
  const original = fixture(0), operation = original.row("public.native_fulfillment_operations");
  assert.equal(await hashReviewNativeFulfillmentReceipt(original.event.canonical_result), await hashReviewNativeFulfillmentReceipt({ version: n("1"), ...operation }));
  await assert.rejects(hashReviewNativeFulfillmentReceipt(operation));
  await assert.rejects(hashReviewNativeFulfillmentReceipt({ version: n("1"), ...operation, extra: true }));
  assert.equal(nativeFulfillmentRefillEventSchema.safeParse({ ...u.event, arbitrary: true }).success, false);
  assert.equal(nativeOpeningEntrySchema.safeParse({ arbitrary: true }).success, false);
  let invoked = 0; const bad = Object.defineProperty({}, "version", { enumerable: true, get() { invoked++; throw new Error("private"); } });
  assert.throws(() => hashReviewNativeFulfillmentReceipt(bad)); assert.equal(invoked, 0);
  await assert.rejects(hashReviewNativeFulfillmentReceipt({ ...u.f.packet }));
});

test("unit mixed UUID refill requests preserve original request hash bytes", async () => {
  const u = refillUnit(true); o(u.request.refill).id = ids.refill.toUpperCase(); o(u.c.target).refill = clone(u.request.refill); o(u.pr!.refill_close).id = ids.refill.toUpperCase();
  // Canonical constructors copy these two raw JSON identity strings verbatim.
  u.doc.refill_id = o(u.request.refill).id; o(u.f.native("pickup").document).refill_id = o(u.pr!.refill_close).id;
  await u.f.recommit(); await u.f.component(); await u.f.check();
  const lower = { ...u.request, refill: { ...o(u.request.refill), id: ids.refill } };
  assert.notEqual(u.op.request_hash, await hashReviewNativeRequest("record_native_dispense", u.op.actor_id, lower));
});
test("unit pickup same-revision snapshot drift refuses without inventing an after row", async () => {
  const u = refillUnit(true); o(o(u.pc!.refill).refill).channel = "email";
  await u.f.recommit(); await u.f.component(); await assert.rejects(u.f.check());
});
test("unit supplied refill head and revision bind the same immutable event", async t => {
  for (const [name, later, head] of [
    ["same revision with another head", false, ids.laterHead],
    ["later revision aliases dispense head", true, ids.dispenseEvent],
  ] as const) await t.test(name, async () => {
    const u = refillUnit(true, true, later); o(u.pc!.refill).head_id = head;
    await u.f.recommit(); await u.f.component(); await assert.rejects(u.f.check());
  });
  for (const later of [false, true]) await t.test(later ? "later distinct head remains allowed" : "same head/revision remains allowed", async () => {
    const u = refillUnit(true, true, later); await u.f.recommit(); await u.f.component(); await u.f.check();
  });
});
test("unit later annotation sequence has no invented lifetime opening selector cap", async () => {
  const u = await openingUnit(), native = u.f.native("correction"), document = o(native.document), context = o(native.reviewed_context);
  const head = { event_id: ids.laterHead, version: n("1001"), record_hash: "a".repeat(64) };
  native.sequence = n("1002"); native.prior_event_id = ids.laterHead; document.sequence = n("1002"); document.prior_event_id = ids.laterHead; document.prior_record_hash = head.record_hash; context.head = head;
  o(u.f.row("public.native_dispense_correction_operations", native.id).request).expected_head = head;
  await u.f.recommit(); await u.f.component(); await u.f.check();
});

test("unit new refill event cannot reuse an existing same-table event identity", async t => {
  await t.test("dispense event versus prior head", async () => { const u = refillUnit(); u.event.id = ids.head; u.doc.refill_event_id = ids.head; await u.f.recommit(); await u.f.component(); await assert.rejects(u.f.check()); });
  await t.test("pickup event versus earlier dispense refill event", async () => { const u = refillUnit(true, true, true); o(u.f.native("pickup").document).refill_event_id = ids.dispenseEvent; await u.f.recommit(); await u.f.component(); await assert.rejects(u.f.check()); });
});

function boundaryTarget(u: Awaited<ReturnType<typeof openingUnit>>, adjacent = true) {
  const row = u.f.native("correction"), document = o(row.document), context = o(row.reviewed_context);
  const head = { event_id: ids.laterHead, version: n(adjacent ? "1" : "2"), record_hash: "1".repeat(64) };
  row.sequence = n(adjacent ? "2" : "3"); row.prior_event_id = head.event_id; document.sequence = row.sequence; document.prior_event_id = head.event_id; document.prior_record_hash = head.record_hash;
  context.head = head; o(u.f.row("public.native_dispense_correction_operations", row.id).request).expected_head = clone(head);
  u.entry.correction_head = adjacent ? clone(head) : { event_id: ids.head, version: n("1"), record_hash: "2".repeat(64) };
  return { row, document, context, head };
}
async function suppliedBoundaryUnit() {
  const u = await openingUnit(), target = boundaryTarget(u, false), before = clone(target.row) as MutableObject, doc = o(before.document), context = o(before.reviewed_context);
  before.id = ids.head; before.sequence = n("1"); before.prior_event_id = null;
  doc.id = before.id; doc.sequence = before.sequence; doc.prior_event_id = null; doc.prior_record_hash = null; doc.amends_event_id = null;
  const empty = { event_id: null, version: n("0"), record_hash: null }; context.head = empty;
  const operation = clone(u.f.row("public.native_dispense_correction_operations", target.row.id)) as MutableObject;
  operation.id = before.id; operation.result = doc; o(operation.request).expected_head = empty; o(operation.request).amends_event_id = null;
  target.document.amends_event_id = before.id; o(u.f.row("public.native_dispense_correction_operations", target.row.id).request).amends_event_id = before.id;
  addSource(u.f, "public.native_dispense_correction_events", before, "amendment_predecessor"); addSource(u.f, "public.native_dispense_correction_operations", operation, "amendment_predecessor"); sortSources(u.f);
  await u.f.recommit(); u.entry.correction_head = { event_id: before.id, version: before.sequence, record_hash: before.record_hash };
  return { ...u, before, target };
}
test("same supplied opening/current boundary head must agree, with zero and nonadjacent positives", async t => {
  await t.test("exact immediate head", async () => { const u = await openingUnit(); boundaryTarget(u); await u.f.recommit(); await u.f.component(); await u.f.check(); });
  await t.test("nonadjacent omitted boundary PK", async () => { const u = await openingUnit(); boundaryTarget(u, false); await u.f.recommit(); await u.f.component(); await u.f.check(); });
  await t.test("zero opening selector with later target remains nonadjacent", async () => { const u = await openingUnit(); boundaryTarget(u); u.entry.correction_head = { event_id: null, version: n("0"), record_hash: null }; await u.f.recommit(); await u.f.component(); await u.f.check(); });
  for (const field of ["event_id", "record_hash"] as const) await t.test("immediate contradiction " + field, async () => {
    const u = await openingUnit(); boundaryTarget(u); o(u.entry.correction_head)[field] = field === "event_id" ? ids.head : "2".repeat(64);
    await u.f.recommit(); await u.f.component(); await assert.rejects(u.f.check());
  });
});
test("already supplied correction at the opening boundary binds exact id/version/hash", async t => {
  await t.test("matching boundary row", async () => { const u = await suppliedBoundaryUnit(); await u.f.recommit(); await u.f.component(); await u.f.check(); });
  for (const field of ["event_id", "record_hash", "version"] as const) await t.test("supplied row contradiction " + field, async () => {
    const u = await suppliedBoundaryUnit(); o(u.entry.correction_head)[field] = field === "version" ? n("2") : field === "event_id" ? ids.dispenseEvent : "3".repeat(64);
    await u.f.recommit(); await u.f.component(); await assert.rejects(u.f.check());
  });
});

test("supplied boundary row keeps historical target and chronology checks without current reauthorization", async t => {
  await t.test("wrong original authorization", async () => { const u = await suppliedBoundaryUnit(); u.before.authorization_id = u.f.event.product_id; o(o(u.before.document).target).authorization_id = u.f.event.product_id; await u.f.recommit(); await u.f.component(); await assert.rejects(u.f.check()); });
  await t.test("earlier sequence cannot be later in time", async () => { const u = await suppliedBoundaryUnit(); const later = "2099-01-01T00:00:00Z"; u.before.created_at = later; o(u.before.document).created_at = later; u.f.row("public.native_dispense_correction_operations", u.before.id).created_at = later; await u.f.recommit(); await u.f.component(); await assert.rejects(u.f.check()); });
});

test("immutable correction UUID cannot alias different supplied head versions/hashes", async t => {
  for (const change of ["version", "hash", "both"] as const) await t.test("same UUID changed " + change, async () => {
    const u = await openingUnit(), target = boundaryTarget(u, false);
    u.entry.correction_head = { event_id: target.head.event_id, version: n(change === "hash" ? "2" : "1"), record_hash: change === "version" ? target.head.record_hash : "2".repeat(64) };
    await u.f.recommit(); await u.f.component(); await assert.rejects(u.f.check());
  });
  await t.test("different UUID and different version is an allowed omitted gap", async () => { const u = await openingUnit(); boundaryTarget(u, false); await u.f.recommit(); await u.f.component(); await u.f.check(); });
});

test("recommitted supplied-head matrix counterexamples refuse through the main checker", async t => {
  for (const mode of ["sameID_differentVersion", "sameVersion_differentID", "sameID_lowerVersion", "latestBeyondHead"]) await t.test("correction latest " + mode, async () => {
    const f = fixture(9), row = f.native("correction"), c = o(row.reviewed_context), head = o(c.head), amendment = o(o(fixture(10).native("correction").document).pickup_amendment);
    if (mode === "sameID_lowerVersion") { row.sequence = n("3"); o(row.document).sequence = n("3"); head.version = n("2"); o(f.row("public.native_dispense_correction_operations", row.id).request).expected_head = clone(head); }
    c.latest_pickup_amendment = { event_id: mode.startsWith("sameID") ? head.event_id : ids.laterHead,
      version: mode === "sameID_differentVersion" || mode === "latestBeyondHead" ? n("2") : mode === "sameID_lowerVersion" ? n("1") : head.version, value: clone(amendment) };
    await f.recommit(); await f.component(); await assert.rejects(f.check());
  });
  for (const mode of ["sameID_differentVersion", "sameVersion_differentID"]) await t.test("cross-return correction heads " + mode, async () => {
    const f = fixture(3), rows = f.rows("public.native_return_events"); assert.equal(rows.length, 2);
    for (let i = 0; i < rows.length; i++) o(rows[i].reviewed_context).correction_head = {
      event_id: i === 0 || mode === "sameID_differentVersion" ? ids.head : ids.laterHead,
      version: n(i === 0 || mode === "sameVersion_differentID" ? "1" : "2"), record_hash: (i === 0 ? "1" : "2").repeat(64) };
    await f.recommit(); await f.component(); await assert.rejects(f.check());
  });
  for (const mode of ["old-head-alias", "new-id-alias"]) await t.test("refill earlier predecessor " + mode, async () => {
    const u = refillUnit(true, true, true);
    if (mode === "old-head-alias") o(u.pc!.refill).head_id = ids.head; else o(u.f.native("pickup").document).refill_event_id = ids.head;
    await u.f.recommit(); await u.f.component(); await assert.rejects(u.f.check());
  });
  await t.test("authorization zero-root identity", async () => {
    const f = fixture(7), c = o(o(f.native("pickup").document).reviewed_context); o(c.authorization).head_id = ids.head; o(c.authorization).head_version = n("0");
    await f.recommit(); await f.component(); await assert.rejects(f.check());
  });
  await t.test("fulfillment append aliases its own prior usage head", async () => {
    const f = fixture(0), d = f.native("dispense"), usage = o(o(o(d.document).reviewed_context).usage);
    usage.fulfillment_head = { event_id: d.id, version: n("1") };
    await f.recommit(); await f.component(); await assert.rejects(f.check());
  });
  for (const mode of ["return-head-alias", "snapshot-hash-drift", "snapshot-version-alias"]) await t.test("discrepancy " + mode, async () => {
    const f = fixture(mode === "return-head-alias" ? 17 : 16);
    if (mode === "return-head-alias") {
      const row = f.native("discrepancy"), c = o(row.reviewed_context), doc = o(row.document), request = o(f.row("public.native_return_discrepancy_operations", row.id).request);
      const h = { ...o(c.return_head), event_id: ids.laterHead, record_hash: "3".repeat(64) }; c.return_head = h; doc.return_head = h; request.expected_return_head = h;
    } else {
      const row = f.rows("public.native_return_events").find(r => r.action === "retract_intake")!, c = o(row.reviewed_context), snapshot = o(c.discrepancies), report = o(a(snapshot.cases)[0]), note = o(a(report.decisions)[0]);
      if (mode === "snapshot-hash-drift") note.observation = "Independent supplied snapshot drift"; else note.id = ids.pickupEvent;
      note.record_hash = await hashReviewNativeRecord("discrepancy", note as never);
      const h = { event_id: note.id, version: note.sequence, record_hash: note.record_hash }; snapshot.head = h; c.discrepancy_head = h; o(f.row("public.native_return_operations", row.id).request).expected_discrepancy_head = h;
    }
    await f.recommit(); await f.component(); await assert.rejects(f.check());
  });
});
test("overlapping mutable authorization state is not mistaken for an immutable event payload", async () => {
  const f = fixture(7), c = o(o(f.native("pickup").document).reviewed_context); o(c.authorization).state = "expired";
  await f.recommit(); await f.component(); await f.check();
});

// The reviewed six-stream matrix enumerates literal origin schemas, not an
// inferred whole-history membership theorem. This loads the ACTUAL PRIVATE
// ledger declaration in RAM only, with actual ordinary helper dependencies.
// Separate tests above invoke the actual complete checker after recommitting P.
const headOrigins = {
  return: ["return.row+document", "return.context.head", "discrepancy.context.return_head+document.return_head", "opening.entry.return_head"],
  correction: ["correction.row+document", "correction.context.head", "correction.context.latest_pickup_amendment", "return.context.correction_head", "opening.entry.correction_head"],
  discrepancy: ["discrepancy.row+document", "return.context.discrepancy_head", "discrepancy.context.discrepancy_head", "return.context.discrepancies.head", "discrepancy.context.discrepancies.head", "snapshot.cases[*].report", "snapshot.cases[*].decisions[*]", "opening.entry.discrepancy_head"],
  refill: ["dispense.context.refill.head_id+refill.version", "dispense.result.refill_event.id+revision+before+after", "pickup.context.refill.head_id+refill.version", "dispense.refill_event.prior_event_id+before.version", "pickup.document.refill_event_id (fresh identity only)"],
  authorization: ["dispense.context.authorization.head_id+head_version", "pickup.context.authorization.head_id+head_version"],
  fulfillment: ["dispense.context.usage.fulfillment_head", "dispense.document.id (fresh identity only; no supplied version)"],
} as const;
interface Ledger { record(origin: string, owner: string, id: string | null, version: bigint | undefined, details?: Record<string, unknown>): void; head(origin: string, owner: string, value: unknown): void }
interface LedgerModule { Ledger: new () => Ledger; streams: Record<string, string>; file: ts.SourceFile }
function privateLedger(): LedgerModule {
  const text = readFileSync(new URL("../../src/hub/features/controlled-drugs/record-review/prospective-native-movement.ts", import.meta.url), "utf8"), file = ts.createSourceFile("native.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const names = new Set(["str", "canonicalId", "NativeVisibleHeads"]);
  const selected = file.statements.filter(s => ((ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s)) && s.name && names.has(s.name.text)) || ts.isVariableStatement(s) && s.declarationList.declarations.some(d => ts.isIdentifier(d.name) && d.name.text === "visibleHeadStreams"));
  assert.equal(selected.length, 4);
  const output = ts.transpileModule(selected.map(s => s.getText(file)).join("\n") + "\n({ Ledger: NativeVisibleHeads, streams: visibleHeadStreams });", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const value = runInNewContext(output, { same: sameReviewJsonb, invalid: nativeInvalid, obj: nativeObject, integer: nativeInteger, nativeHeadSchema }, { timeout: 1000 }) as Omit<LedgerModule, "file">;
  return { ...value, file };
}
test("private literal head registry matches every reviewed extraction origin", () => {
  const { streams, file } = privateLedger(), expected = Object.fromEntries(Object.entries(headOrigins).flatMap(([stream, origins]) => origins.map(origin => [origin, stream])));
  assert.deepEqual(JSON.parse(JSON.stringify(streams)), expected);
  const calls = new Set<string>();
  function walk(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ["record", "head"].includes(node.expression.name.text) && node.expression.expression.getText(file) === "this.visible" && ts.isStringLiteral(node.arguments[0])) calls.add(node.arguments[0].text);
    ts.forEachChild(node, walk);
  }
  walk(file); assert.deepEqual([...calls].sort(), Object.keys(expected).sort());
  const graph = file.statements.find(s => ts.isClassDeclaration(s) && s.name?.text === "NativeGraph") as ts.ClassDeclaration;
  const validate = graph.members.find(m => ts.isMethodDeclaration(m) && m.name.getText(file) === "validate")!.getText(file);
  assert.ok(validate.indexOf("await this.document") < validate.indexOf("this.visibleFacts()"));
});
test("all 82 reviewed literal schema-pair categories accept equal supplied facts", async t => {
  const { Ledger } = privateLedger(); let categories = 0;
  for (const [stream, origins] of Object.entries(headOrigins)) for (let i = 0; i < origins.length; i++) for (let j = i; j < origins.length; j++) {
    categories++;
    await t.test(stream + ": " + origins[i] + " / " + origins[j], () => {
      const ledger = new Ledger();
      for (const origin of [origins[i], origins[j]]) ledger.record(origin, ids.refill, ids.head, origin.includes("fresh identity only") ? undefined : 1n);
    });
  }
  assert.equal(categories, 82);
});
test("private supplied-fact rules reject only exposed immutable contradictions", async t => {
  const { Ledger } = privateLedger(), origin = "correction.row+document";
  await t.test("table-global ID owner", () => { const l = new Ledger(); l.record(origin, ids.refill, ids.head, 1n); assert.throws(() => l.record(origin, ids.laterHead, ids.head, 1n)); });
  await t.test("table-global ID revision", () => { const l = new Ledger(); l.record(origin, ids.refill, ids.head, 1n); assert.throws(() => l.record(origin, ids.refill, ids.head, 2n)); });
  await t.test("owner/revision UUID", () => { const l = new Ledger(); l.record(origin, ids.refill, ids.head, 1n); assert.throws(() => l.record(origin, ids.refill, ids.laterHead, 1n)); });
  for (const field of ["hash", "payload", "kind", "amendment", "refill"]) await t.test("overlapping " + field, () => {
    const l = new Ledger(), first = field === "hash" ? "1".repeat(64) : field === "kind" ? "pickup_amendment" : { value: "first" }, second = field === "hash" ? "2".repeat(64) : field === "kind" ? "clinical_annotation" : { value: "second" };
    l.record(origin, ids.refill, ids.head, 1n, { [field]: first }); assert.throws(() => l.record(origin, ids.refill, ids.head, 1n, { [field]: second }));
  });
  await t.test("zero roots coexist with later snapshots", () => { const l = new Ledger(); l.head("correction.context.head", ids.refill, { event_id: null, version: n("0"), record_hash: null }); l.record(origin, ids.refill, ids.head, 1n); });
  await t.test("positive version cannot have null ID", () => assert.throws(() => new Ledger().record(origin, ids.refill, null, 1n)));
  await t.test("zero version cannot have positive ID", () => assert.throws(() => new Ledger().record(origin, ids.refill, ids.head, 0n)));
  await t.test("different table may reuse UUID", () => { const l = new Ledger(); l.record(origin, ids.refill, ids.head, 1n); l.record("return.row+document", ids.laterHead, ids.head, 2n); });
  await t.test("different IDs and revisions allow omitted gaps", () => { const l = new Ledger(); l.record(origin, ids.refill, ids.head, 1n); l.record(origin, ids.refill, ids.laterHead, 99n); });
  await t.test("fresh D ID may appear in a later legitimate usage head", () => { const l = new Ledger(); l.record("dispense.document.id (fresh identity only; no supplied version)", ids.refill, ids.head, undefined); l.record("dispense.context.usage.fulfillment_head", ids.refill, ids.head, 3n); });
});

// Source-derived identity interoperability controls only. No genuine linked-refill
// DB/GoTrue corpus is created by these in-memory frames.
test("raw copied refill document identities preserve spelling while typed cross-row identities agree", async t => {
  const spellings = [ids.refill, ids.refill.toUpperCase(), "aAbBcCdD-0000-4000-8000-000000000001"];
  for (const dRaw of spellings) for (const pRaw of spellings) await t.test(dRaw + " / " + pRaw, async () => {
    const u = refillUnit(true);
    o(u.request.refill).id = dRaw; o(o(u.c.target).refill).id = dRaw; u.doc.refill_id = dRaw;
    u.pr!.refill_close = { ...o(u.pr!.refill_close), id: pRaw }; o(u.f.native("pickup").document).refill_id = pRaw;
    await u.f.recommit(); await u.f.component(); await u.f.check();
    assert.equal(u.doc.refill_id, dRaw); assert.equal(o(u.f.native("pickup").document).refill_id, pRaw);
  });
});
test("recommitted refill document-only case drift and different valid UUIDs refuse", async t => {
  for (const pickup of [false, true]) for (const mode of ["case_only", "different_id"] as const) await t.test(String(pickup) + mode, async () => {
    const u = refillUnit(pickup);
    const document = pickup ? o(u.f.native("pickup").document) : u.doc;
    document.refill_id = mode === "case_only" ? ids.refill.toUpperCase() : ids.head;
    await u.f.recommit(); await u.f.component(); await assert.rejects(u.f.check);
  });
});
test("raw document refill identity schemas reject malformed or non-string values before hash processing", async t => {
  for (const pickup of [false, true]) for (const value of ["", ids.refill.replaceAll("-", ""), "{" + ids.refill + "}", " " + ids.refill, ids.refill + "\n", "ggbbccdd-0000-4000-8000-000000000001", true, n("1"), {}, []] as MutableJson[]) await t.test(String(pickup) + String(value), async () => {
    const u = refillUnit(pickup), document = pickup ? o(u.f.native("pickup").document) : u.doc; document.refill_id = value;
    await assert.rejects(() => hashReviewNativeDocument(pickup ? "pickup" : "dispense", document));
  });
});
