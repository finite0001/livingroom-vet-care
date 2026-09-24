import { test } from "node:test";
import assert from "node:assert/strict";
import {
  denverInstant,
  denverLocal,
  shiftDay,
  reminderOffsets,
  formatDenverTime,
  formatDenverDayLabel,
} from "../../src/hub/features/scheduling/time.ts";
test("Denver conversion does not depend on workstation timezone", () => {
  assert.equal(denverInstant("2026-10-28T09:00"), "2026-10-28T15:00:00.000Z");
  assert.equal(denverInstant("2027-01-28T09:00"), "2027-01-28T16:00:00.000Z");
  assert.equal(denverLocal("2027-01-28T16:00:00Z"), "2027-01-28T09:00");
});
test("formatDenverTime renders a big 12-hour label in the practice timezone", () => {
  assert.equal(formatDenverTime("2027-01-28T16:00:00Z"), "9:00 AM");
  assert.equal(formatDenverTime("2026-10-28T15:00:00.000Z"), "9:00 AM");
  assert.equal(formatDenverTime("2027-01-28T04:30:00Z"), "9:30 PM");
});
test("formatDenverDayLabel renders a human day for a practice day", () => {
  assert.equal(formatDenverDayLabel("2026-09-23"), "Wednesday, September 23");
  assert.equal(formatDenverDayLabel("2027-01-01"), "Friday, January 1");
});
test("spring gap and autumn repeated hour cannot silently shift bookings", () => {
  assert.throws(() => denverInstant("2027-03-14T02:30"), /does not exist/);
  assert.throws(() => denverInstant("2026-11-01T01:30"), /occurs twice/);
  assert.throws(() => denverInstant("2026-02-30T12:00"), /does not exist/);
  assert.equal(shiftDay("2026-12-31", 1), "2027-01-01");
});
test("reminder settings accept disabled/default/custom and reject unsafe values", () => {
  assert.deepEqual(reminderOffsets(""), []);
  assert.deepEqual(reminderOffsets("48,24"), [48, 24]);
  for (const value of ["0", "-2", "24,24", "1.5", "721", "1,2,3,4,5,6"])
    assert.throws(() => reminderOffsets(value));
});
