import test from "node:test";
import assert from "node:assert/strict";
import { correctionFixture } from "./correction-fixture.ts";
import { renderNativePrescriptionV2, type NativePrescriptionPrintV2 } from "../../supabase/functions/_shared/native-dispense-corrections.ts";
import { renderReviewedPrescriptionCopy } from "../../src/hub/features/prescriptions/prescription-print.ts";

test("current print preserves original dispense and pickup alongside complete attributed amendments", () => {
  const value = correctionFixture(), original = structuredClone(value), html = renderNativePrescriptionV2(value);
  assert.deepEqual(value, original); assert.equal(html, renderNativePrescriptionV2(structuredClone(value)));
  for (const phrase of ["Recorded prescription dispense", "10 test units", "Original recipient", "Corrected recipient", "Clinical annotation", "Operational annotation", "Original pickup recorded in error", "Corrected handoff assertion", "not a new prescription", "do not restore allowance", "print format 2"]) assert.ok(html.includes(phrase), phrase);
  const target = { patientId: value.prescription.patient.id, authorizationId: value.prescription.authorization_id, dispenseId: value.dispense!.id };
  assert.equal(renderReviewedPrescriptionCopy(value, target), html);
  assert.throws(() => renderReviewedPrescriptionCopy(value, { ...target, dispenseId: null }));
});
test("order-only print discloses correction summary without implicitly selecting fill details", () => {
  const value = correctionFixture(); value.dispense = null; value.dispense_corrections = null; value.original_pickup = null;
  const html = renderNativePrescriptionV2(value); assert.match(html, /4 recorded amendment\(s\) across 1 dispensing/); assert.doesNotMatch(html, /Corrected recipient/);
});
test("amendment prose and original or corrected recipient assertions are escaped", () => {
  const value = correctionFixture(); value.dispense_corrections!.events[0].note = '<script>alert("x")</script>';
  value.original_pickup!.recipient_name = '<img src=x>';
  const html = renderNativePrescriptionV2(value); assert.match(html, /&lt;script&gt;/); assert.match(html, /&lt;img src=x&gt;/); assert.doesNotMatch(html, /<script|<img/);
});
const changes: Record<string, (v: NativePrescriptionPrintV2) => void> = {
  "omitted chain entry": v => { v.dispense_corrections!.events.splice(1, 1); },
  "wrong predecessor": v => { v.dispense_corrections!.events[1].prior_event_id = null; },
  "wrong predecessor fingerprint": v => { v.dispense_corrections!.events[1].prior_record_hash = "a".repeat(64); },
  "wrong current head": v => { v.dispense_corrections!.head.record_hash = "a".repeat(64); },
  "wrong patient": v => { v.dispense_corrections!.events[0].target.pet_id = v.dispense!.id; },
  "changed original document": v => { v.dispense_corrections!.events[1].dispense_document_hash = "b".repeat(64); },
  "staff clinical authority": v => { v.dispense_corrections!.events[1].actor.authority = "active_staff"; },
  "cross-kind amendment": v => { v.dispense_corrections!.events[1].amends_event_id = v.dispense_corrections!.events[0].id; },
  "pickup follow-up skips latest amendment": v => { v.dispense_corrections!.events[3].amends_event_id = null; },
  "pickup on another original": v => { v.dispense_corrections!.events[2].pickup_amendment!.original_pickup_id = v.dispense!.id; },
  "invented current pickup": v => { v.dispense_corrections!.latest_pickup_amendment = null; },
  "missing original pickup": v => { v.original_pickup = null; },
  "partial current summary": v => { v.correction_summary.event_count = 3; },
  "hidden financial metadata": v => { Object.assign(v.dispense_corrections!.events[0], { invoice_id: "private" }); },
  "control character": v => { v.dispense_corrections!.events[0].note = 'Synthetic\rtext'; },
  "outdated current status read": v => { v.status.checked_at = '2026-09-16T12:00:00Z'; },
};
for (const [name, change] of Object.entries(changes)) test(`correction disclosure rejects ${name}`, () => { const v = correctionFixture(); change(v); assert.throws(() => renderNativePrescriptionV2(v)); });
test("corrected handoff respects microsecond bounds including equivalent timezones", () => {
  const v = correctionFixture(), e = v.dispense_corrections!.events[3];
  e.pickup_amendment!.handoff!.picked_up_at = '2026-09-16T12:04:00.000001Z';
  assert.throws(() => renderNativePrescriptionV2(v));
  e.pickup_amendment!.handoff!.picked_up_at = '2026-09-16T06:04:00-06:00';
  assert.doesNotThrow(() => renderNativePrescriptionV2(v));
});
