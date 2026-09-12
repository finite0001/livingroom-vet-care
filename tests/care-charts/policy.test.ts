import { test } from "node:test";
import assert from "node:assert/strict";
import {
  coordinate,
  measurement,
  moveCoordinate,
} from "../../src/hub/features/care-charts/policy.ts";
test("mass measurements preserve optional zero and reject nonfinite or negative values", () => {
  assert.equal(measurement(""), null);
  assert.equal(measurement("0"), 0);
  assert.equal(measurement("12.5"), 12.5);
  for (const value of ["NaN", "Infinity", "-1", "1e300"])
    assert.throws(() => measurement(value));
});
test("normalized schematic coordinates and keyboard motion stay in bounds", () => {
  assert.equal(coordinate("0.5"), 0.5);
  for (const value of ["", "NaN", "-0.1", "1.1"])
    assert.throws(() => coordinate(value));
  assert.equal(moveCoordinate(0, -0.01), 0);
  assert.equal(moveCoordinate(1, 0.01), 1);
  assert.equal(moveCoordinate(0.5, 0.01), 0.51);
});
