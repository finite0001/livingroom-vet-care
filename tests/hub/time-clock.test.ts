import assert from "node:assert/strict";
import { test } from "node:test";
import { timeClockTotals, shiftOverlapSeconds } from "../../src/hub/features/time-clock/time-totals.ts";
import { updateTimeEntry, deleteTimeEntry, type OriginalTimeEntry, type TimeEntryClient, type TimeEntryArguments } from "../../src/hub/features/time-clock/admin-time-entry.ts";

test("overnight and long-running shifts contribute only the time inside each reporting window", () => {
  const now = Date.parse("2026-11-06T08:00:00Z"); // 01:00 Denver
  assert.deepEqual(timeClockTotals([
    { clock_in_at: "2026-11-06T06:00:00Z", clock_out_at: null },
  ], now), { today: 3600, week: 7200 });
  assert.deepEqual(timeClockTotals([
    { clock_in_at: "2026-10-01T00:00:00Z", clock_out_at: null },
  ], now), { today: 3600, week: 7 * 86400 });
  assert.equal(shiftOverlapSeconds({ clock_in_at: "2026-10-01T00:00:00Z", clock_out_at: "2026-10-30T09:00:00Z" }, now - 7 * 86400000, now), 3600);
});

test("Denver midnight handles spring-forward and fall-back elapsed hours", () => {
  assert.equal(timeClockTotals([{ clock_in_at: "2026-11-01T06:00:00Z", clock_out_at: null }], Date.parse("2026-11-02T06:00:00Z")).today, 24 * 3600); // 23:00 after 25-hour day
  assert.equal(timeClockTotals([{ clock_in_at: "2027-03-14T07:00:00Z", clock_out_at: null }], Date.parse("2027-03-15T05:00:00Z")).today, 22 * 3600); // 23:00 after 23-hour day
  assert.equal(timeClockTotals([{ clock_in_at: "2026-11-06T00:00:00Z", clock_out_at: null }], Date.parse("2026-11-06T06:30:00Z")).today, 6.5 * 3600); // still November 5 Denver
});

test("reporting excludes future, non-overlapping and malformed intervals", () => {
  const from = Date.parse("2026-11-06T07:00:00Z"), until = from + 3600000;
  for (const entry of [
    { clock_in_at: "invalid", clock_out_at: null },
    { clock_in_at: "2026-11-06T08:00:00Z", clock_out_at: null },
    { clock_in_at: "2026-11-06T05:00:00Z", clock_out_at: "2026-11-06T07:00:00Z" },
    { clock_in_at: "2026-11-06T08:00:00Z", clock_out_at: "2026-11-06T07:00:00Z" },
  ]) assert.equal(shiftOverlapSeconds(entry, from, until), 0);
});

const original: OriginalTimeEntry = { id: "shift", staff_id: "staff", clock_in_at: "2026-10-01T07:00:00Z", clock_out_at: "2026-10-01T08:00:00Z", note: null };

// Database concurrency and authorization are tested by scripts/time-clock/verify.py.
// These adapter checks verify the reviewed values survive the client boundary.
test("corrections and deletions carry exact reviewed values through the atomic RPC", async () => {
  const calls: TimeEntryArguments[] = [];
  const client: TimeEntryClient = { async rpc(name, args) {
    assert.equal(name, "admin_correct_time_entry"); calls.push(args);
    return { data: original, error: null };
  } };
  await updateTimeEntry(client, original, { ...original, note: "Correction" });
  await deleteTimeEntry(client, original);
  assert.equal(calls[0].p_expected_note, null);
  assert.equal(calls[0].p_expected_clock_out_at, original.clock_out_at);
  assert.equal(calls[0].p_staff_id, original.staff_id);
  assert.equal(calls[0].p_note, "Correction");
  assert.equal(calls[0].p_delete, false);
  assert.equal(calls[1].p_delete, true);
});

test("open shifts use the same atomic RPC; invalid times and reopening are refused", async () => {
  const open = { ...original, clock_out_at: null };
  let calls = 0;
  const client: TimeEntryClient = { async rpc() { calls++; return { data: open, error: null }; } };
  await updateTimeEntry(client, open, open);
  await deleteTimeEntry(client, open);
  assert.equal(calls, 2);
  await assert.rejects(updateTimeEntry(client, original, open), /cannot be reopened/);
  await assert.rejects(updateTimeEntry(client, open, { ...open, clock_in_at: "invalid" }), /valid times/);
  await assert.rejects(updateTimeEntry(client, open, { ...open, clock_out_at: "2026-09-01T00:00:00Z" }), /valid times/);
  assert.equal(calls, 2);
});

test("server conflicts, authorization failures and unverifiable responses never report success", async () => {
  for (const message of ["This entry changed. Refresh the timesheet and review it again", "Only active administrators can correct time entries"]) {
    const client: TimeEntryClient = { async rpc() { return { data: null, error: { message } }; } };
    await assert.rejects(updateTimeEntry(client, original, original), { message });
    await assert.rejects(deleteTimeEntry(client, original), { message });
  }
  for (const data of [null, { ...original, id: "wrong" }, { ...original, staff_id: "wrong" }]) {
    const client: TimeEntryClient = { async rpc() { return { data, error: null }; } };
    await assert.rejects(deleteTimeEntry(client, original), /could not be verified/);
  }
});
