import test from "node:test";
import assert from "node:assert/strict";
import {
  addCareDays,
  denverCalendarDay,
} from "../../src/hub/features/care-reminders/date-tools.ts";
test("administration anchor uses Denver day rather than UTC midnight", () =>
  assert.equal(denverCalendarDay("2026-01-01T06:30:00Z"), "2025-12-31"));
test("reviewed due intervals preserve calendar arithmetic over DST and leap years", () => {
  assert.equal(addCareDays("2026-03-07", 2), "2026-03-09");
  assert.equal(addCareDays("2028-02-28", 1), "2028-02-29");
});
test("invalid date or interval cannot propose a due plan", () => {
  for (const days of [0, -1, NaN, Infinity, 1.5, 36501])
    assert.throws(() => addCareDays("2026-01-01", days));
  assert.throws(() => addCareDays("2026-02-30", 10));
});
