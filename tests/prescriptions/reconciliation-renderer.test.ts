import test from "node:test";
import assert from "node:assert/strict";
import { reconciliationFixture } from "./reconciliation-fixture.ts";
import { renderNativePrescriptionV4 } from "../../supabase/functions/_shared/native-return-reconciliation.ts";
import { replayNativeReturnQuantities } from "../../supabase/functions/_shared/native-return-quantity-replay.ts";
import type { ReconciliationEvent, ReturnDiscrepancyEvent } from "../../supabase/functions/_shared/native-return-reconciliation-contract.ts";
const id = (n: number) => `bb140000-0000-4000-8000-${String(n).padStart(12,"0")}`;
function corrected(action: "retract_intake" | "retract_disposal" | "retract_restock", withCase = false) {
  const v = reconciliationFixture(), d = v.dispense_returns!;
  const source = d.events[action === "retract_intake" ? 0 : action === "retract_disposal" ? 1 : 2];
  const prior = d.events.at(-1)!;
  const e: ReconciliationEvent = {
    ...structuredClone(source), version: 2, id: id(1), sequence: 5,
    prior_event_id: prior.id, prior_record_hash: prior.record_hash, action,
    intake_id: action === "retract_intake" ? source.id : source.intake_id,
    actor: { ...source.actor, authority: "active_dvm" }, policy: null,
    custody: null, package_condition: null, storage_history: null,
    correction_target: { event_id: source.id, record_hash: source.record_hash },
    discrepancy_id: withCase ? id(2) : null,
    physical_attestations: { reviewed_physical_facts: true, intake_claim_incorrect: action === "retract_intake", remains_physically_held: action !== "retract_intake", was_not_destroyed: action === "retract_disposal", removed_from_available_stock: action === "retract_restock" },
    allocations: source.allocations.map(a => ({ ...a, quantity: "1.000", movement_id: action === "retract_restock" ? id(3) : null })),
    created_at: "2026-09-16T12:06:00Z", record_hash: "5".repeat(64),
  };
  if (withCase) {
    const report: ReturnDiscrepancyEvent = {
      version: 1, id: id(2), target: source.target, sequence: 1,
      prior_event_id: null, prior_record_hash: null, actor: { ...source.actor, authority: "active_staff" },
      action: "report", case_id: id(2), source: e.correction_target!,
      allocations: source.allocations.map(({ movement_id: _movement, ...a }) => ({ ...a, quantity: "1.000" })),
      observation: "Synthetic review of physical facts", correction_ids: [], return_head: structuredClone(d.head),
      reviewed_context_hash: "a".repeat(64), created_at: "2026-09-16T12:05:00Z", record_hash: "b".repeat(64),
    };
    d.discrepancies = { version: 1, head: { version: 1, event_id: report.id, record_hash: report.record_hash }, open_case_count: 1, held_lot_ids: [source.allocations[0].lot_id], cases: [{ id: report.id, source: report.source, allocations: report.allocations, status: "open", report, decisions: [] }] };
    v.return_summary.discrepancy_event_count = 1; v.return_summary.open_case_count = 1;
  }
  d.events.push(e); d.head = { version: e.sequence, event_id: e.id, record_hash: e.record_hash };
  d.replay = replayNativeReturnQuantities(d.allocations.map(a => ({ allocation_id: a.allocation_id, lot_id: a.lot_id, quantity: a.dispensed_quantity })), d.events.map(e => ({ id: e.id, sequence: e.sequence, action: e.action, intake_id: e.intake_id, correction_target_id: e.version === 2 ? e.correction_target?.event_id ?? null : null, allocations: e.allocations.map(({ movement_id: _movement, ...a }) => a) })));
  d.allocations = d.replay.allocations.map(a => ({ ...d.allocations.find(x => x.allocation_id === a.allocation_id)!, ...a }));
  v.return_summary.event_count = 5;
  return v;
}
function resolved() {
  const v = corrected("retract_restock", true), d = v.dispense_returns!, c = d.discrepancies.cases[0];
  const decision: ReturnDiscrepancyEvent = { ...structuredClone(c.report), id: id(4), sequence: 2, prior_event_id: c.report.id, prior_record_hash: c.report.record_hash, actor: { ...c.report.actor, authority: "active_dvm" }, action: "resolve_corrected", correction_ids: [id(1)], return_head: structuredClone(d.head), created_at: "2026-09-16T12:07:00Z", record_hash: "c".repeat(64) };
  c.decisions.push(decision); c.status = "resolved_corrected";
  d.discrepancies.head = { version: 2, event_id: decision.id, record_hash: decision.record_hash };
  d.discrepancies.open_case_count = 0; d.discrepancies.held_lot_ids = [];
  v.return_summary.open_case_count = 0; v.return_summary.discrepancy_event_count = 2;
  return v;
}
test("current print preserves original return evidence, custody and explicit gross totals", () => {
  const v = reconciliationFixture(), before = structuredClone(v), html = renderNativePrescriptionV4(v);
  assert.deepEqual(v,before);
  for (const text of ["Physical returns and reconciliation", "Total recorded intake / retracted", "clinic_retained", "sealed_intact", "controlled", "6.000 / 0.000"]) assert.ok(html.includes(text),text);
});
for (const action of ["retract_intake", "retract_disposal", "retract_restock"] as const) test(`print accepts exact ${action} without changing original dispensing`, () => {
  const v = corrected(action), original = reconciliationFixture();
  assert.deepEqual(v.dispense,original.dispense); assert.deepEqual(v.prescription,original.prescription);
  assert.match(renderNativePrescriptionV4(v), /Corrected event/);
});
test("open discrepancy and exact corrected resolution show distinct inventory review states", () => {
  assert.match(renderNativePrescriptionV4(corrected("retract_restock", true)), /Unresolved discrepancies require inventory review/);
  assert.match(renderNativePrescriptionV4(resolved()), /resolved corrected/);
  assert.doesNotMatch(renderNativePrescriptionV4(resolved()), /Unresolved discrepancies require inventory review/);
});
test("order-only current copy does not silently select dispense notes", () => {
  const v = corrected("retract_intake",true); v.dispense = null; v.dispense_returns = null; v.dispense_corrections = null;
  const html = renderNativePrescriptionV4(v); assert.match(html,/1 unresolved case/); assert.doesNotMatch(html,/Synthetic review of physical facts/);
});
test("current case observations are escaped", () => {
  const v = corrected("retract_intake",true); v.dispense_returns!.discrepancies.cases[0].report.observation = '<script>alert("x")</script>';
  const html = renderNativePrescriptionV4(v); assert.match(html,/&lt;script&gt;/); assert.doesNotMatch(html,/<script/);
});
const mutations: Record<string, (v: ReturnType<typeof resolved>) => void> = {
  "false physical facts": v => { (v.dispense_returns!.events[4] as ReconciliationEvent).physical_attestations.removed_from_available_stock = false; },
  "wrong source hash": v => { (v.dispense_returns!.events[4] as ReconciliationEvent).correction_target!.record_hash = "f".repeat(64); },
  "missing compensation movement": v => { v.dispense_returns!.events[4].allocations[0].movement_id = null; },
  "duplicate stock movement": v => { v.dispense_returns!.events[4].allocations[0].movement_id = v.dispense_returns!.events[2].allocations[0].movement_id; },
  "staff correction": v => { v.dispense_returns!.events[4].actor.authority = "active_staff"; },
  "invented effective balance": v => { v.dispense_returns!.replay.allocations[0].restocked_quantity = "3.000"; },
  "invented historical balance": v => { v.dispense_returns!.replay.historical[0].retracted_restocked_quantity = "0.000"; },
  "wrong case": v => { (v.dispense_returns!.events[4] as ReconciliationEvent).discrepancy_id = id(99); },
  "underreported case": v => { const c = v.dispense_returns!.discrepancies.cases[0]; c.allocations[0].quantity = "0.500"; c.report.allocations[0].quantity = "0.500"; c.decisions[0].allocations[0].quantity = "0.500"; },
  "confirmed original after linked correction": v => { const c = v.dispense_returns!.discrepancies.cases[0]; c.status = "resolved_confirmed_original"; c.decisions[0].action = "resolve_confirmed_original"; c.decisions[0].correction_ids = []; },
  "correction after resolution": v => { v.dispense_returns!.discrepancies.cases[0].decisions[0].return_head = structuredClone(v.dispense_returns!.discrepancies.cases[0].report.return_head); },
  "report before cited source": v => { v.dispense_returns!.discrepancies.cases[0].report.return_head = { version: 0, event_id: null, record_hash: null }; },
  "forged unresolved count": v => { v.return_summary.open_case_count = 1; v.return_summary.discrepancy_event_count = 0; },
  "unknown fields": v => { Object.assign(v.dispense_returns!, { private_billing: true }); },
};
for (const [name, mutate] of Object.entries(mutations)) test(`current print rejects ${name}`, () => { const v = resolved(); mutate(v); assert.throws(() => renderNativePrescriptionV4(v)); });
