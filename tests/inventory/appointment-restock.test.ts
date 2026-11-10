import assert from "node:assert/strict";
import test from "node:test";
import {
  restockState,
  thresholdSchema,
} from "../../src/hub/features/inventory/restocking/model.ts";

test("unconfirmed opening stock is distinct from a counted zero", () => {
  const row = {
    id: "vaccine",
    name: "Synthetic vaccine",
    unit: "dose",
    version: 1,
    threshold: 0,
    counted: false,
    balance: 0,
  };
  assert.equal(restockState(row), "uncounted");
  assert.equal(restockState({ ...row, counted: true }), "low");
  assert.equal(restockState({ ...row, counted: true, balance: 1 }), "ok");
  assert.equal(restockState({ ...row, threshold: null }), "disabled");
  assert.equal(
    restockState({ ...row, counted: true, threshold: 2.5, balance: 2.5 }),
    "low",
  );
  assert.equal(thresholdSchema.parse("0"), 0);
  assert.equal(thresholdSchema.parse("2.125"), 2.125);
  for (const input of ["-1", "1e3", "1.0001", "", "NaN", "100000000000"])
    assert.equal(thresholdSchema.safeParse(input).success, false);
});
