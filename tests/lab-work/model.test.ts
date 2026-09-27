import test from "node:test";
import assert from "node:assert/strict";
import {
  dueFromInterval,
  emptyLab,
  labReminderLabel,
  labRemindersAvailable,
  labValues,
  type LabOrder,
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
test("lab reminders are opt-in per order and only for open orders with a due date", () => {
  assert.equal(emptyLab().reminders_enabled, false);
  const open = { status: "planned", due_date: "2026-10-01" };
  assert.equal(labRemindersAvailable(open), true);
  assert.equal(labRemindersAvailable({ ...open, status: "ordered" }), true);
  assert.equal(labRemindersAvailable({ ...open, due_date: null }), false);
  for (const status of ["collected", "resulted", "cancelled"])
    assert.equal(labRemindersAvailable({ ...open, status }), false);
  assert.equal(
    labReminderLabel({ ...open, reminders_enabled: true }),
    "Reminders on",
  );
  assert.equal(
    labReminderLabel({ ...open, reminders_enabled: false }),
    "Reminders off",
  );
  assert.equal(
    labReminderLabel({ ...open, status: "resulted", reminders_enabled: true }),
    "Reminders not applicable",
  );
});
test("saved rows without the reminder column read as off", () => {
  const row = {
    ...emptyLab(),
    id: "a",
    pet_id: "b",
    version: 1,
    created_by: "c",
    updated_by: "c",
    created_at: "",
    updated_at: "",
  } as LabOrder;
  delete (row as Partial<LabOrder>).reminders_enabled;
  assert.equal(labValues(row).reminders_enabled, false);
  assert.equal(
    labValues({ ...row, reminders_enabled: true }).reminders_enabled,
    true,
  );
});
