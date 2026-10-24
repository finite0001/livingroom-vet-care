import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyPreparedReview } from "../../src/hub/features/controlled-drugs/record-review/prepared-packet.ts";
import { summarizePreparedReview } from "../../src/hub/features/controlled-drugs/record-review/review-summary.ts";
import { fixture, syntheticEvidence, other, event } from "./record-review-lifecycle-fixture.ts";
test("readable historical summary preserves exact stock deltas/units, performer and distinct times", async () => {
  const f = await fixture();
  f.value.data.packet.event_lines.push({ ...f.value.data.packet.event_lines[0], id: other, event_id: other, quantity_delta: "1.125" });
  const p = await verifyPreparedReview(f.pointer, f.prepared(), syntheticEvidence, () => {});
  const summary = summarizePreparedReview(p.data.packet);
  assert.equal(summary.product, "Synthetic medication"); assert.equal(summary.originalPerformer, "Synthetic original performer");
  assert.equal(summary.observedAt, "2026-10-22T09:00:00.000000Z"); assert.equal(summary.recordedAt, "2026-10-22T09:01:00.000000Z");
  assert.deepEqual(summary.stockLines.map(v => [v.quantity, v.unit, v.channel]), [["1.125", "mL", "Available stock"]]);
  assert.equal(summary.deadline, "Historical policy unavailable"); assert.equal(summary.historicalPolicy, "No historical policy selected");
});
test("missing retained stock unit does not fall back to catalog unit or interpret a clinical dose", async () => {
  const f = await fixture(); delete f.value.data.packet.containers[0].stock_unit;
  const p = await verifyPreparedReview(f.pointer, f.prepared(), syntheticEvidence, () => {});
  const summary = summarizePreparedReview(p.data.packet);
  assert.equal(summary.stockLines[0].quantity, "1.125"); assert.equal(summary.stockLines[0].unit, "Historical stock unit missing");
  assert.equal(summary.clinicalDose, null);
});
test("structured correction and clinical descriptions use exact own retained source paths", async () => {
  const f = await fixture(), hash = "b".repeat(64);
  f.value.data.packet.source_rows = [{ relation: "public.native_return_events", key: { id: event }, row: { document: { correction_target: { event_id: other, record_hash: hash } } } },
    { relation: "public.patient_treatments", key: { id: event }, row: { dose: "0.02 mL/kg", route: "IV" } },
    { relation: "public.native_dispense_correction_events", key: { id: other }, row: { dispense_id: other } }];
  // Explicit display-only source stub; this test does not establish source integrity.
  const p = await verifyPreparedReview(f.pointer, f.prepared(), { validate() {} }, () => {});
  const summary = summarizePreparedReview(p.data.packet);
  assert.deepEqual(summary.relationships, [{ label: "Corrects return record", id: other, recordHash: hash }]);
  assert.equal(summary.clinicalDose, "0.02 mL/kg"); assert.equal(summary.clinicalRoute, "IV");
  assert.equal(summary.stockLines[0].quantity, "1.125");
});
