import assert from "node:assert/strict";
import { test } from "node:test";
import { timeClockTotals, shiftOverlapSeconds } from "../../src/hub/features/time-clock/time-totals.ts";
import { updateClosedTimeEntry, deleteClosedTimeEntry, type OriginalTimeEntry, type TimeEntryClient } from "../../src/hub/features/time-clock/admin-time-entry.ts";

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

// Model PostgREST's same-request predicates against a row changed since it was read.
function store(initial: OriginalTimeEntry) {
  let row: OriginalTimeEntry | null = { ...initial };
  const tables: string[] = [];
  const client: TimeEntryClient = { from(table) {
    tables.push(table);
    const filters: ((value: OriginalTimeEntry) => boolean)[] = [];
    let change: Partial<OriginalTimeEntry> | null = null;
    const query = {
      eq(column: string, value: string) { filters.push((row) => row[column as keyof OriginalTimeEntry] === value); return query; },
      is(column: string, value: null) { filters.push((row) => row[column as keyof OriginalTimeEntry] === value); return query; },
      not(column: string, _operator: string, value: null) { filters.push((row) => row[column as keyof OriginalTimeEntry] !== value); return query; },
      async select() {
        if (!row || !filters.every((filter) => filter(row!))) return { data: [], error: null };
        const id = row.id;
        row = change ? { ...row, ...change } : null;
        return { data: [{ id }], error: null };
      },
    };
    return { update(values) { change = values; return query; }, delete() { return query; } };
  } };
  return { client, tables, read: () => row };
}

test("closed shift correction/deletion never writes duty status", async () => {
  const saved = store(original);
  await updateClosedTimeEntry(saved.client, original, { clock_in_at: original.clock_in_at, clock_out_at: "2026-10-01T09:00:00Z", note: "Corrected" });
  assert.equal(saved.read()?.clock_out_at, "2026-10-01T09:00:00Z");
  await deleteClosedTimeEntry(saved.client, saved.read()!);
  assert.equal(saved.read(), null);
  assert.deepEqual(saved.tables, ["time_entries", "time_entries"]);
});

test("open shifts are refused before transport; corrections cannot reopen a closed shift", async () => {
  const open = { ...original, clock_out_at: null };
  const saved = store(open);
  await assert.rejects(deleteClosedTimeEntry(saved.client, open), /clock out/);
  await assert.rejects(updateClosedTimeEntry(saved.client, open, { clock_in_at: original.clock_in_at, clock_out_at: original.clock_out_at!, note: null }), /clock out/);
  assert.deepEqual(saved.tables, []);
  await assert.rejects(updateClosedTimeEntry(saved.client, original, { clock_in_at: original.clock_in_at, clock_out_at: "", note: null }), /valid closed shift/);
});

test("stale timestamp, note, staff binding and reopened rows reject update and delete", async () => {
  for (const changed of [
    { ...original, clock_in_at: "2026-10-01T06:00:00Z" },
    { ...original, clock_out_at: "2026-10-01T10:00:00Z" },
    { ...original, note: "Another admin correction" },
    { ...original, staff_id: "another-staff" },
    { ...original, clock_out_at: null },
  ]) {
    const saved = store(changed);
    await assert.rejects(updateClosedTimeEntry(saved.client, original, { clock_in_at: original.clock_in_at, clock_out_at: original.clock_out_at!, note: "Overwrite" }), /changed or is no longer editable/);
    await assert.rejects(deleteClosedTimeEntry(saved.client, original), /changed or is no longer editable/);
    assert.deepEqual(saved.read(), changed);
  }
  const note = { ...original, note: "Original note" };
  const saved = store(note);
  await deleteClosedTimeEntry(saved.client, note);
  assert.equal(saved.read(), null);
});
