import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_DUE_SOON_DAYS,
  addDays,
  daysBetween,
  dueDescription,
  dueSoonWindow,
  parseVaccineStatusSummary,
  suggestedDueDate,
  vaccineDueState,
  vaccineProfileArgs,
  vaccineStatusRows,
  validateDueSoonDays,
  type VaccineStatusGroup,
} from "../../src/hub/features/vaccines/vaccine-status.ts";

const pet = "11111111-1111-4111-8111-111111111111";
const group = (over: Partial<VaccineStatusGroup>): VaccineStatusGroup => ({
  group_key: "g",
  group_name: "Group",
  group_source: "due_template",
  last_given_on: "2026-01-01",
  last_given_source: "practice_administration",
  last_record_id: "22222222-2222-4222-8222-222222222222",
  last_product_name: "Product",
  due_on: null,
  due_source: null,
  record_count: 1,
  plan: null,
  flags: [],
  ...over,
});

test("due state boundaries: overdue after the due date, due today counts as due soon", () => {
  assert.equal(vaccineDueState(null, "2026-09-27", 30), "no_due_date");
  assert.equal(vaccineDueState("2026-09-26", "2026-09-27", 30), "overdue");
  assert.equal(vaccineDueState("2026-09-27", "2026-09-27", 30), "due_soon");
  assert.equal(vaccineDueState("2026-10-27", "2026-09-27", 30), "due_soon");
  assert.equal(vaccineDueState("2026-10-28", "2026-09-27", 30), "current");
  assert.equal(vaccineDueState("2026-10-28", "2026-09-27", 31), "due_soon");
});

test("calendar arithmetic is DST- and leap-year-safe", () => {
  assert.equal(daysBetween("2026-03-07", "2026-03-09"), 2);
  assert.equal(daysBetween("2026-11-01", "2026-11-02"), 1);
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(addDays("2027-02-28", 365), "2028-02-28");
  assert.throws(() => addDays("2026-02-30", 1));
  assert.throws(() => daysBetween("not-a-date", "2026-01-01"));
});

test("due-soon window uses a validated practice value or the documented display default", () => {
  assert.deepEqual(dueSoonWindow(undefined), { days: DEFAULT_DUE_SOON_DAYS, configured: false });
  assert.deepEqual(dueSoonWindow("45"), { days: 45, configured: true });
  for (const bad of ["0", "366", "-1", "1.5", "abc", "", "030"])
    assert.equal(dueSoonWindow(bad).configured, false, bad);
  assert.equal(validateDueSoonDays(" 60 "), "60");
  for (const bad of ["0", "366", "x", "1e2"]) assert.throws(() => validateDueSoonDays(bad));
});

test("rows sort most urgent first and describe days remaining", () => {
  const summary = parseVaccineStatusSummary(
    {
      pet_id: pet,
      as_of: "2026-09-27",
      groups: [
        group({ group_key: "a", group_name: "Current", due_on: "2027-09-01", due_source: "reviewed_due_plan" }),
        group({ group_key: "b", group_name: "None" }),
        group({ group_key: "c", group_name: "Soon", due_on: "2026-10-01", due_source: "practice_administration" }),
        group({ group_key: "d", group_name: "Late", due_on: "2026-09-26", due_source: "outside_record" }),
        group({ group_key: "e", group_name: "Today", due_on: "2026-09-27", due_source: "historical_record" }),
      ],
    },
    pet,
  );
  const rows = vaccineStatusRows(summary, 30);
  assert.deepEqual(
    rows.map((r) => [r.group_name, r.state]),
    [
      ["Late", "overdue"],
      ["Today", "due_soon"],
      ["Soon", "due_soon"],
      ["None", "no_due_date"],
      ["Current", "current"],
    ],
  );
  assert.equal(dueDescription(rows[0]), "1 day overdue");
  assert.equal(dueDescription(rows[1]), "Due today");
  assert.equal(dueDescription(rows[2]), "In 4 days");
  assert.equal(dueDescription(rows[3]), "No due date recorded");
});

test("summary parsing rejects another patient's data and unknown sources", () => {
  const base = { pet_id: pet, as_of: "2026-09-27", groups: [group({})] };
  assert.throws(
    () => parseVaccineStatusSummary(base, "33333333-3333-4333-8333-333333333333"),
    /different patient/,
  );
  assert.throws(() =>
    parseVaccineStatusSummary({ ...base, groups: [{ ...group({}), due_source: "guessed" }] }, pet),
  );
  assert.throws(() => parseVaccineStatusSummary({ ...base, as_of: "2026-02-30" }, pet));
});

test("catalog interval only suggests a date; nothing is suggested without both inputs", () => {
  assert.equal(suggestedDueDate("2026-09-27T10:30", 365), "2027-09-27");
  assert.equal(suggestedDueDate("2026-09-27T10:30", null), null);
  assert.equal(suggestedDueDate("", 365), null);
  assert.equal(suggestedDueDate("2026-09-27T10:30", 0), null);
  assert.equal(suggestedDueDate("2026-09-27T10:30", 1.5), null);
});

test("vaccine profile form mirrors server normalization and validation", () => {
  assert.deepEqual(
    vaccineProfileArgs({
      group_key: " Rabies ",
      species: "Dog, cat, dog, ",
      vaccine_type: " ",
      labeled_duration: "3 years",
      default_booster_interval_days: "",
      review_note: " Label reviewed ",
    }),
    {
      p_group_key: "rabies",
      p_species: ["cat", "dog"],
      p_vaccine_type: null,
      p_labeled_duration: "3 years",
      p_default_booster_interval_days: null,
      p_review_note: "Label reviewed",
    },
  );
  const valid = {
    group_key: "",
    species: "",
    vaccine_type: "",
    labeled_duration: "",
    default_booster_interval_days: "",
    review_note: "Label",
  };
  assert.equal(vaccineProfileArgs(valid).p_group_key, null);
  for (const bad of [
    { group_key: "Bad key!" },
    { labeled_duration: "2 years" },
    { default_booster_interval_days: "0" },
    { default_booster_interval_days: "36501" },
    { default_booster_interval_days: "1.5" },
    { review_note: "  " },
    { species: Array.from({ length: 11 }, (_, i) => `s${i}`).join(",") },
  ])
    assert.throws(() => vaccineProfileArgs({ ...valid, ...bad }), JSON.stringify(bad));
});

test("client source vocabulary matches the SQL status summary", async () => {
  const { readFile } = await import("node:fs/promises");
  const sql = await readFile(
    new URL("../../supabase/migrations/20260928120000_vaccine_catalog_profiles_and_status.sql", import.meta.url),
    "utf8",
  );
  for (const token of [
    "reviewed_due_plan",
    "practice_administration",
    "historical_record",
    "outside_record",
    "due_plan_anchor",
    "plan_awaiting_review",
    "administration_after_plan_anchor",
    "due_template",
    "catalog_profile",
  ])
    assert.ok(sql.includes(`'${token}'`), token);
  assert.ok(sql.includes("'vaccine_due_soon_days'"));
  assert.ok(!/^insert into public\.(catalog_vaccine_profiles|app_settings)/im.test(sql), "no seeded clinical values");
});
