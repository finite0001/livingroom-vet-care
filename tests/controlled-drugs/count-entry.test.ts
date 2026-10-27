import assert from "node:assert/strict";
import test from "node:test";
import { buildCountStatement, countObservationTime, countQuantityInput, type CountEntryFields } from "../../src/hub/features/controlled-drugs/count/count-entry.ts";
import { id, identity, syntheticCount } from "./count-entry-fixture.ts";

function fields(): CountEntryFields {
  return { observedAt: "2026-10-26T12:30:15", observedOffset: "", quantities: { [id(20)]: "90071992547.125" }, presence: { [id(21)]: "present" }, findings: [], attest: true };
}
test("physical quantity conversion preserves exact decimals without floating point", () => {
  for (const [input, expected] of [["0", "0.000"], ["1.2", "1.200"], ["90071992547.125", "90071992547.125"], [" 3.001 ", "3.001"]])
    assert.equal(countQuantityInput(input), expected);
  for (const invalid of ["", "1e2", "-1", "+1", ".1", "01", "1.", "1.0000", "100000000000", "NaN", "Infinity", "1,2"])
    assert.throws(() => countQuantityInput(invalid));
});
test("observation is explicitly entered and calendar rollovers are refused", () => {
  const result = countObservationTime("2026-10-26T12:30:15");
  assert.match(result, /^2026-10-26T\d{2}:\d{2}:15\.000000Z$/);
  for (const invalid of ["", "2026-02-29T12:00", "2026-04-31T12:00", "2026-13-01T00:00", "2026-01-01T24:00", "2026-01-01T00:00:60", "2026-01-01T12:00Z"])
    assert.throws(() => countObservationTime(invalid));
  assert.match(countObservationTime("2024-02-29T12:00"), /^2024-02-29T/);
});
test("a complete attested physical observation keeps the captured identities and raw quantity", () => {
  const request = buildCountStatement(identity, syntheticCount(), fields());
  assert.equal(request.actor_id, id(1)); assert.equal(request.snapshot_id, id(11));
  assert.equal(request.quantities[0].quantity, "90071992547.125");
  assert.ok(Object.isFrozen(request)); assert.ok(Object.isFrozen(request.quantities[0]));
});
test("the form cannot add, omit, or substitute captured stock membership", () => {
  for (const quantities of [{}, { [id(20)]: "1", [id(99)]: "1" }, { [id(99)]: "1" }])
    assert.throws(() => buildCountStatement(identity, syntheticCount(), { ...fields(), quantities }));
  for (const presence of [{}, { [id(99)]: "present" as const }, { [id(21)]: "" as const }])
    assert.throws(() => buildCountStatement(identity, syntheticCount(), { ...fields(), presence }));
  assert.throws(() => buildCountStatement(identity, syntheticCount(), { ...fields(), findings: [{ location_id: id(99), description: "Unexpected bottle" }] }));
});
test("recording requires current participant, unchanged snapshot and explicit attestation", () => {
  const data = syntheticCount();
  for (const next of [{ ...identity, actor_id: id(3) }, { ...identity, snapshot_id: id(99) }, { ...identity, count_id: id(99) }])
    assert.throws(() => buildCountStatement(next, data, fields()));
  assert.throws(() => buildCountStatement(identity, data, { ...fields(), attest: false }));
  assert.throws(() => buildCountStatement(identity, { ...data, current_boundary_state: "changed" }, fields()));
  assert.throws(() => buildCountStatement(identity, { ...data, history_state: "stale" }, fields()));
  assert.throws(() => buildCountStatement(identity, { ...data, participants: [{ ...data.participants[0], submitted: true }, data.participants[1]] }, fields()));
});
