import test from "node:test";
import assert from "node:assert/strict";
import {
  dueFromInterval,
  emptyLab,
} from "../../src/hub/features/lab-work/model.ts";
test("lab due interval uses date arithmetic without timezone or DST shifts", () => {
  assert.equal(dueFromInterval("2026-03-07", 2), "2026-03-09");
  assert.equal(dueFromInterval("2028-02-28", 1), "2028-02-29");
});
test("lab interval rejects invalid dates, fractional and unbounded intervals", () => {
  for (const days of [0, -1, 1.5, NaN, Infinity, 36501])
    assert.throws(() => dueFromInterval("2026-09-12", days));
  assert.throws(() => dueFromInterval("2026-02-30", 1));
});
test("new lab orders do not invent tests, due dates, results or intervals", () => {
  const values = emptyLab();
  assert.equal(values.test_name, "");
  assert.equal(values.due_date, null);
  assert.equal(values.interval_days, null);
  assert.equal(values.result_date, null);
});
