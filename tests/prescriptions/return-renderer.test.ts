import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { returnFixture } from "./return-fixture.ts";
import { renderNativePrescriptionV3 } from "../../supabase/functions/_shared/native-dispense-returns.ts";

test("return print preserves dispensing and separately accounts for held disposed and restocked quantities", () => {
  const a = returnFixture(), original = structuredClone(a), html = renderNativePrescriptionV3(a);
  assert.deepEqual(a, original);
  for (const text of ["10.000 test units", "2.000 test units", "1.000 test units", "3.000 test units", "Returned by client", "Retained at clinic", "Return to available stock", "do not restore prescription allowance"]) assert.ok(html.includes(text), text);
});
test("order-only return summary does not silently select return details", () => {
  const a = returnFixture(); a.dispense = null; a.dispense_returns = null; a.dispense_corrections = null;
  const html = renderNativePrescriptionV3(a); assert.match(html, /4 return intake/); assert.doesNotMatch(html, /Synthetic client-shareable custody note|TEST-LOT/);
});
test("return notes and names are escaped", () => {
  const a = returnFixture(); a.dispense_returns!.events[0].note = '<script>alert("x")</script>';
  assert.match(renderNativePrescriptionV3(a), /&lt;script&gt;/); assert.doesNotMatch(renderNativePrescriptionV3(a), /<script/);
});
const mutations: Record<string, (a: ReturnType<typeof returnFixture>) => void> = {
  "omitted event": a => { a.dispense_returns!.events.splice(1,1); },
  "missing original allocation": a => { a.dispense_returns!.allocations = []; },
  "wrong original lot": a => { a.dispense_returns!.allocations[0].lot_id = "a9130000-0000-4000-8000-000000000099"; },
  "wrong predecessor": a => { a.dispense_returns!.events[1].prior_event_id = null; },
  "wrong head": a => { a.dispense_returns!.head.record_hash = "a".repeat(64); },
  "wrong patient": a => { a.dispense_returns!.events[0].target.pet_id = "a9130000-0000-4000-8000-000000000099"; },
  "cumulative intake over original": a => { a.dispense_returns!.events[3].allocations[0].quantity = "6.000"; },
  "overdisposition": a => { a.dispense_returns!.events[2].allocations[0].quantity = "5.000"; },
  "invented held balance": a => { a.dispense_returns!.allocations[0].held_quantity = "3.000"; },
  "staff restock": a => { a.dispense_returns!.events[2].actor.authority = "active_staff"; },
  "restock disabled policy": a => { a.dispense_returns!.events[2].policy!.enabled = false; },
  "restock unknown custody": a => { a.dispense_returns!.events[0].custody = "unknown"; },
  "restock damaged package": a => { a.dispense_returns!.events[0].package_condition = "damaged"; },
  "restock compromised storage": a => { a.dispense_returns!.events[0].storage_history = "compromised"; },
  "original pickup exists": a => { a.original_pickup = { id: "a9130000-0000-4000-8000-000000000090", document_hash: "f".repeat(64), picked_up_at: "2026-09-16T11:00:00Z", recipient_name: "Synthetic", recipient_relationship: "Owner", actor_id: a.prescription.prescriber.user_id }; },
  "wrong intake disposition": a => { a.dispense_returns!.events[2].intake_id = a.dispense_returns!.events[3].id; },
  "missing positive movement": a => { a.dispense_returns!.events[2].allocations[0].movement_id = null; },
  "invented intake movement": a => { a.dispense_returns!.events[0].allocations[0].movement_id = "a9130000-0000-4000-8000-000000000089"; },
  "exponent quantity": a => { a.dispense_returns!.events[0].allocations[0].quantity = "5e0"; },
  "unreviewed metadata": a => { Object.assign(a.dispense_returns!.events[0], { invoice_id: "private" }); },
  "future disposition": a => { a.dispense_returns!.events[3].created_at = "2026-09-16T13:00:00.000001Z"; },
  "version downgrade": a => { Object.assign(a, { version: 2 }); },
};
for (const [name, mutate] of Object.entries(mutations)) test(`return print rejects ${name}`, () => { const a = returnFixture(); mutate(a); assert.throws(() => renderNativePrescriptionV3(a)); });

// Frozen from the pre-reconciliation renderer at 8945cce. Existing artifact bytes must not change.
test("quantity replay preserves historical full and order-only return artifact bytes", () => {
  const a = returnFixture();
  const digest = () => createHash("sha256").update(renderNativePrescriptionV3(a)).digest("hex");
  assert.equal(digest(), "43375a444c79d7469e9862688b3c3345e047cb2a564f81590a7c5b5b31397f75");
  a.dispense = null; a.dispense_returns = null; a.dispense_corrections = null;
  assert.equal(digest(), "0995ab9cf5ec55b6cf0f5628c2f25b947cd7dd3aa05f5d7b719fc6c8785736e2");
});

test("historical v1 disclosure cannot opt into future correction arithmetic", () => {
  const a = returnFixture();
  Object.assign(a.dispense_returns!.events[1], { action: "retract_intake", correction_target_id: a.dispense_returns!.events[0].id });
  assert.throws(() => renderNativePrescriptionV3(a));
});
