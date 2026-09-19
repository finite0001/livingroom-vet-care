import { test } from "node:test";
import assert from "node:assert/strict";
import { initialWeightFields } from "../../src/hub/features/imports/weight-fields.ts";
test("weight suggestions preserve explicit units and source time in Denver", () => {
  assert.deepEqual(
    initialWeightFields({
      weight: "12.30",
      weight_unit: "kg",
      timestamp: Date.parse("2026-09-02T01:00:00Z") / 1000,
    }),
    { weight: "12.30", unit: "kg", measuredAt: "2026-09-01" },
  );
});
test("unknown units and invalid source measurements are never invented", () => {
  for (const value of [NaN, Infinity, -1, "unknown"])
    assert.equal(
      initialWeightFields({ weight: value, weight_unit: "g", timestamp: 0 })
        .weight,
      "",
    );
  assert.deepEqual(
    initialWeightFields({
      weight: 10,
      weight_unit: "grams",
      timestamp: "invalid",
    }),
    { weight: "10", unit: "", measuredAt: "" },
  );
});
