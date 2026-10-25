import { test } from "node:test";
import assert from "node:assert/strict";
import { ExactJsonNumber, type ExactJson } from "../../src/hub/features/controlled-drugs/record-review/exact-json.ts";
import { verifyProspectiveNativeMovement } from "../../src/hub/features/controlled-drugs/record-review/prospective-native-movement.ts";
import { hashReviewNativeRecord } from "../../src/hub/features/controlled-drugs/record-review/component-hashes.ts";
import { nativeEventKinds, nativeQuantity, nativeDocumentSchemas, snapshotNativeEvidence } from "../../src/hub/features/controlled-drugs/record-review/native-movement-structure.ts";
import type { PreparedReviewPacket } from "../../src/hub/features/controlled-drugs/record-review/prepared-packet.ts";
import { fixture, provenance, n, o, a, clone } from "./record-review-native-test-data.ts";
test("18 independent accepted synthetic native GET kinds pass local semantics without changing their bytes", async t => {
  assert.equal(provenance.fixtures.length, 18); assert.equal(new Set(provenance.fixtures.map(p => p.event_kind)).size, 18);
  for (let i = 0; i < 18; i++) await t.test(provenance.fixtures[i].event_kind, () => fixture(i).check());
});
test("semantic graph/arithmetic/receipt/cell mutations refuse after every component commitment is recomputed", async t => {
  const changes: Record<string, { index: number; mutate(f: ReturnType<typeof fixture>): void | Promise<void> }> = {
    allocation_quantity: { index: 0, mutate(f) { f.row("public.native_dispense_allocations").quantity = n("1.999"); } },
    missing_declared_allocation: { index: 0, mutate(f) { const sources = a(f.packet.source_rows), index = sources.findIndex(s => o(s).relation === "public.native_dispense_allocations"); sources.splice(index, 1); a(f.adapter.source_refs).splice(index, 1); } },
    extra_unselected_lot: { index: 0, mutate(f) { const sources = a(f.packet.source_rows), index = sources.findIndex(s => o(s).relation === "public.inventory_lots"), extra = o(clone(o(sources[index]) as ExactJson)), ref = o(clone(o(a(f.adapter.source_refs)[index]) as ExactJson)); o(extra.row).id = "ffffffff-ffff-ffff-ffff-ffffffffffff"; o(extra.key).id = o(extra.row).id; o(ref.key).id = o(extra.row).id; sources.splice(index + 1, 0, extra); a(f.adapter.source_refs).splice(index + 1, 0, ref); } },
    retained_alert_commitment: { index: 0, mutate(f) { o(o(o(f.native("dispense").document).reviewed_context).alerts).source_hash = "0".repeat(64); } },
    signed_patient_binding: { index: 0, mutate(f) { o(o(o(o(f.native("dispense").document).reviewed_context).signed_artifact).patient).id = f.event.product_id; } },

    invoice_quantity: { index: 0, mutate(f) { f.row("public.billing_invoice_items").quantity = n("1.999"); } },
    native_context_charge: { index: 0, mutate(f) { o(o(f.native("dispense").document).reviewed_context).charge = { ...o(o(o(f.native("dispense").document).reviewed_context).charge), amount_cents: "999" }; } },
    original_operation_actor: { index: 0, mutate(f) { f.row("public.native_fulfillment_operations").actor_id = f.event.product_id; } },
    event_actor_vs_native_actor: { index: 0, mutate(f) { f.event.actor_id = f.event.product_id; f.preparation.actor_id = f.event.product_id; f.row("public.controlled_stock_actions").actor_id = f.event.product_id; } },
    physical_split: { index: 0, mutate(f) { o(a(o(a(f.context.containers)[0]).lines)[0]).quantity_delta = "-1.999"; } },
    movement_kind: { index: 0, mutate(f) { f.row("public.inventory_movements").kind = "adjust"; } },
    native_hold_before_debit: { index: 0, mutate(f) { o(a(f.frozen.lots)[0]).native_hold = true; } },
    wrong_prepared_allocation: { index: 0, mutate(f) { f.rows("public.controlled_stock_cells").find(c => c.channel === "prepared")!.allocation_id = f.event.product_id; } },
    wrong_source_role: { index: 1, mutate(f) { o(a(f.adapter.source_refs)[0]).role = "retained_context"; } },
    intake_prefix_conservation: { index: 1, mutate(f) { const row = f.native("return"), c = o(row.reviewed_context); o(a(o(c.replay).allocations)[0]).remaining_returnable_quantity = "0.000"; } },
    return_quantity: { index: 2, mutate(f) { o(a(o(f.native("return").document).allocations)[0]).quantity = "0.999"; } },
    compensation_sign: { index: 5, mutate(f) { const c = f.rows("public.inventory_movements").find(m => m.kind === "native_return_compensation")!; c.quantity = n("1.000"); } },
    compensation_original_link: { index: 5, mutate(f) { f.row("public.native_return_compensation_links").original_movement_id = f.event.product_id; } },
    correction_wrong_case: { index: 4, mutate(f) { o(f.native("return").document).discrepancy_id = f.event.product_id; } },
    released_container_quantity: { index: 7, mutate(f) { const frame = o(a(f.frozen.containers)[0]); o(o(a(frame.cells)[0]).position).quantity = n("0.999"); } },
    pickup_does_not_release: { index: 7, mutate(f) { o(o(a(f.context.containers)[0]).after).status = "onsite"; o(o(a(f.context.containers)[0]).after).location_id = f.event.product_id; } },
    amendment_cannot_replace_original_pickup: { index: 10, mutate(f) { o(o(f.native("correction").document).pickup_amendment).original_pickup_id = f.event.product_id; } },
    assertion_site_fallback: { index: 8, mutate(f) { f.adapter.site_basis = "event_transitions"; } },
    lot_frozen_tuple: { index: 0, mutate(f) { o(o(a(f.frozen.lots)[0]).lot).location = "Changed retained location"; } },
    excess_native_available: { index: 11, mutate(f) { a(o(f.event.source_effects).available).push({ kind: "movement", id: f.event.id, lot_id: f.event.product_id, product_id: f.event.product_id, quantity_delta: "1.000", native_kind: "native_return" }); } },
    report_case_must_be_self: { index: 14, mutate(f) { f.native("discrepancy").case_id = f.event.product_id; o(f.native("discrepancy").document).case_id = f.event.product_id; } },
    report_allocation_cap: { index: 14, mutate(f) { const row = f.native("discrepancy"), doc = o(row.document), c = o(row.reviewed_context); o(a(doc.allocations)[0]).quantity = "3.000"; o(a(o(c.intent).allocations)[0]).quantity = "3.000"; o(a(o(o(f.row("public.native_return_discrepancy_operations", f.event.id).request).intent).allocations)[0]).quantity = "3.000"; } },
    discrepancy_snapshot_count: { index: 15, mutate(f) { o(o(f.native("discrepancy").reviewed_context).discrepancies).open_case_count = n("0"); } },
    discrepancy_snapshot_hold: { index: 15, mutate(f) { a(o(o(f.native("discrepancy").reviewed_context).discrepancies).held_lot_ids).push(f.event.product_id); } },
    discrepancy_snapshot_status: { index: 15, mutate(f) { o(a(o(o(f.native("discrepancy").reviewed_context).discrepancies).cases)[0]).status = "resolved_confirmed_original"; } },
    discrepancy_source_record: { index: 14, mutate(f) { o(o(f.native("discrepancy").document).source).record_hash = f.event.record_hash; } },
    note_must_name_report: { index: 15, mutate(f) { const row = f.native("discrepancy"); row.case_id = row.id; o(row.document).case_id = row.id; } },
    corrected_resolution_link: { index: 16, mutate(f) { f.row("public.native_return_discrepancy_correction_links").case_id = f.event.product_id; } },
    corrected_resolution_requires_correction: { index: 16, mutate(f) { o(f.native("discrepancy").document).correction_ids = []; } },
    corrected_resolution_authority: { index: 16, mutate(f) { o(o(f.native("discrepancy").document).actor).authority = "active_staff"; } },
    confirmation_attestation: { index: 17, mutate(f) { o(f.row("public.native_return_discrepancy_operations", f.event.id).request).attest_original_quantities_custody_and_stock_accurate = false; } },
    snapshot_recommitted_report_target: { index: 14, async mutate(f) { const c = o(a(o(o(f.native("discrepancy").reviewed_context).discrepancies).cases)[0]), report = o(c.report); o(report.target).pet_id = f.event.product_id; report.record_hash = await hashReviewNativeRecord("discrepancy", report); } },

  };
  for (const [name, change] of Object.entries(changes)) await t.test(name, async () => {
    const f = fixture(change.index); await change.mutate(f); await f.recommit(); await f.component(); await assert.rejects(f.check());
  });
});
test("stored numeric aliases, mixed-case pickup request IDs, and distinct C0 preparation session are allowed", async t => {
  await t.test("numeric quantity alias preserves each component's own PG hash preimage", async () => { const f = fixture(0); f.row("public.native_dispense_allocations").quantity = n("2.0000"); f.row("public.inventory_movements").quantity = n("-2e0"); await f.recommit(); await f.component(); await f.check(); });
  await t.test("actual historical pickup request has uppercase UUID spelling", async () => { const f = fixture(7); const request = o(f.preparation.canonical_arguments).request; assert.match(String(o(request).dispense_id), /[A-F]/); await f.check(); });
  await t.test("preparation session can differ from action/event execution session", async () => { const f = fixture(0); f.preparation.session_id = f.event.product_id; await f.recommit(); await f.component(); await f.check(); });
});
test("unsupported kinds/variants and hostile values fail closed without invoking accessors or leaking errors", async () => {
  assert.equal(Object.keys(nativeEventKinds).length, 18);
  let getters = 0; const value = Object.freeze(Object.defineProperty({}, "event", { enumerable: true, get() { getters++; throw new Error("private"); } }));
  await assert.rejects(verifyProspectiveNativeMovement(value as PreparedReviewPacket, Object.freeze({ event_id: "bad" })), e => e instanceof Error && !Object.hasOwn(e, "cause") && !e.message.includes("private")); assert.equal(getters, 0);
  const cycle: Record<string, unknown> = {}; cycle.self = cycle; Object.freeze(cycle); assert.throws(() => snapshotNativeEvidence(cycle));
  const oversized = Object.freeze(Object.fromEntries(Array.from({ length: 200 }, (_, i) => [String(i), "x".repeat(10000)]))); assert.throws(() => snapshotNativeEvidence(oversized));
  assert.throws(() => snapshotNativeEvidence({ mutable: true }));
  assert.equal(nativeQuantity("0.000", true), 0n); assert.throws(() => nativeQuantity("0.000")); assert.throws(() => nativeQuantity("100000000000.000"));
  assert.equal(nativeDocumentSchemas.return_v2.safeParse({ version: n("2"), arbitrary: true }).success, false);
});
test("retained zero balances before retraction are valid, while a return needs the original policy permission", async () => {
  const zero = fixture(4), context = o(zero.native("return").reviewed_context);
  assert.ok(a(o(context.replay).intakes).some(intake => a(o(intake).allocations).some(allocation => o(allocation).held_quantity === "0.000")));
  await zero.check();
  const denied = fixture(11); denied.row("public.controlled_stock_policy_versions").clinic_retained_return_permitted = false;
  await denied.recommit(); await denied.component(); await assert.rejects(denied.check());
});
test("literal dispatch and unimplemented refill variants refuse rather than falling back", async () => {
  const unknown = fixture(0); unknown.adapter.event_kind = "record_native_dispense:unreviewed"; await unknown.recommit(); await assert.rejects(unknown.check());
  const refill = fixture(0), document = o(refill.native("dispense").document);
  document.refill_id = refill.event.product_id; document.refill_event_id = refill.event.opening_id;
  await refill.recommit(); await refill.component(); await assert.rejects(refill.check());
});
