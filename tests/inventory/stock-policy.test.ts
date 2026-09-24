import { test } from "node:test";
import assert from "node:assert/strict";
import {
  quantityValue,
  centsValue,
  isDefinitiveRejection,
  currentVaccinations,
} from "../../src/hub/features/inventory/stock-policy.ts";
test("stock quantity preserves allowed precision and rejects silent rounding", () => {
  assert.equal(quantityValue("1.125"), 1.125);
  assert.equal(quantityValue("-2", true), -2);
  for (const value of ["0", "-1", "1.2345", "1e3", "NaN", ""])
    assert.throws(() => quantityValue(value));
});
test("billing price converts exact cents and rejects unsupported precision", () => {
  assert.equal(centsValue("12.34"), 1234);
  assert.equal(centsValue("0"), 0);
  for (const value of ["1.999", "-1", "1000001", "Infinity"])
    assert.throws(() => centsValue(value));
});
test("only known transaction rejections permit a fresh operation ID", () => {
  for (const code of ["23514", "42501", "40001"])
    assert.equal(isDefinitiveRejection({ code }), true);
  for (const failure of [
    new Error("Network timeout"),
    { code: "500" },
    { code: "ECONNRESET" },
    null,
  ])
    assert.equal(isDefinitiveRejection(failure), false);
});
test("corrected vaccinations and medications are excluded from vaccine due display", () => {
  const rows = [
    {
      id: "a",
      kind: "vaccine",
      next_due_on: "2027-01-01",
      administered_at: "2026-01-01",
    },
    {
      id: "b",
      kind: "vaccine",
      next_due_on: "2027-01-01",
      administered_at: "2026-01-01",
    },
    {
      id: "c",
      kind: "medication",
      next_due_on: null,
      administered_at: "2026-01-01",
    },
  ];
  assert.deepEqual(
    currentVaccinations(rows, new Set(["a"])).map((r) => r.id),
    ["b"],
  );
});
