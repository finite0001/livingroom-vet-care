import assert from "node:assert/strict";
import { test } from "node:test";
import { calendarDue, calendarDateSchema, recurrenceSchema, timeMinutes, minutesTime } from "../../src/hub/features/care-plans/calendar.ts";
import { planValuesSchema, policyValuesSchema, templateValuesSchema } from "../../src/hub/features/care-plans/model.ts";
const rule = { interval_amount: 1, interval_unit: "months" as const, anchor_mode: "fixed_schedule" as const, month_end: "clamp" as const };
test("month-end calculations retain the original anchor across short months", () => {
 assert.equal(calendarDue("2026-01-31", rule), "2026-02-28");
 assert.equal(calendarDue("2026-01-31", rule, 2), "2026-03-31");
 assert.equal(calendarDue("2026-04-30", rule), "2026-05-30");
 assert.equal(calendarDue("2026-04-30", { ...rule, month_end: "preserve_end" }), "2026-05-31");
});
test("annual leap dates return when the original anniversary permits", () => {
 assert.equal(calendarDue("2024-02-29", { ...rule, interval_unit: "years" }), "2025-02-28");
 assert.equal(calendarDue("2024-02-29", { ...rule, interval_unit: "years" }, 4), "2028-02-29");
});
test("day and week intervals cross DST as calendar dates", () => {
 assert.equal(calendarDue("2026-03-07", { ...rule, interval_unit: "days" }, 2), "2026-03-09");
 assert.equal(calendarDue("2026-11-01", { ...rule, interval_unit: "weeks", interval_amount: 2 }), "2026-11-15");
});
test("quarterly intervals and early calendar years use full dates", () => {
 assert.equal(calendarDue("2026-01-31", { ...rule, interval_amount: 3 }), "2026-04-30");
 assert.equal(calendarDue("0001-01-31", rule), "0001-02-28");
});
test("invalid dates, zero intervals and unsupported result years are rejected", () => {
 for (const date of ["2026-02-29", "2026-04-31", "0000-01-01", "2026-1-01", "infinity"]) assert.equal(calendarDateSchema.safeParse(date).success, false);
 for (const amount of [0, -1, 1.5, 1201, Infinity]) assert.equal(recurrenceSchema.safeParse({ ...rule, interval_amount: amount }).success, false);
 assert.throws(() => calendarDue("9999-12-31", rule));
 assert.throws(() => calendarDue("2026-01-01", rule, 0));
});
test("send-window minute bounds support midnight only as an end", () => {
 assert.equal(timeMinutes("08:30"), 510);assert.equal(timeMinutes("24:00", true), 1440);assert.equal(minutesTime(1440), "24:00");
 assert.throws(() => timeMinutes("24:00"));assert.throws(() => timeMinutes("20:60", true));assert.throws(() => minutesTime(1441));
 const values = { channel: "EMAIL", message_template_id: "12345678-1234-4234-8234-123456789abc", message_template_version: 1, subject: "Care reminder", enabled: false, review_note: "Reviewed", start_minute: 480, end_minute: 1200 };
 assert.equal(policyValuesSchema.safeParse(values).success, true);
 assert.equal(policyValuesSchema.safeParse({ ...values, end_minute: 480 }).success, false);
 assert.equal(policyValuesSchema.safeParse({ ...values, unreviewed: true }).success, false);
});
test("clinical requests require review and reject invented metadata", () => {
 const values = { ...rule, care_key: "synthetic", name: "Wellness", care_kind: "wellness", active: true, review_note: "Reviewed" };
 assert.equal(templateValuesSchema.safeParse(values).success, true);
 assert.equal(templateValuesSchema.safeParse({ ...values, review_note: " " }).success, false);
 assert.equal(templateValuesSchema.safeParse({ ...values, approved_by: "anyone" }).success, false);
 const plan = { ...rule, template_id: "12345678-1234-4234-8234-123456789abc", template_version: 1, name: "Wellness", anchor_on: "2026-01-31", due_on: "2026-02-28", status: "proposed", reminders_enabled: false, override_reason: "", review_note: "Proposed", replace_anchor_evidence: false };
 assert.equal(planValuesSchema.safeParse(plan).success, true);
 assert.equal(planValuesSchema.safeParse({ ...plan, due_on: plan.anchor_on }).success, false);
 assert.equal(planValuesSchema.safeParse({ ...plan, replace_anchor_evidence: true }).success, false);
});
