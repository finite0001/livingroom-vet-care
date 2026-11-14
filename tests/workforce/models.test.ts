import { test } from "node:test";
import assert from "node:assert/strict";
import {
  timeTotals,
  commandSchema,
  settingsSchema,
} from "../../src/hub/features/workforce/model.ts";
import { calculate } from "../../src/hub/features/clinical-tools/calculators.ts";
import {
  csvCell,
  dollarsToCents,
} from "../../src/hub/features/workforce/people-model.ts";
import {
  helperRequestSchema,
  validateHelperEvidence,
} from "../../supabase/functions/_shared/clinical-helper-contract.ts";
import {
  createClinicalHelperHandler,
  type HelperDependencies,
} from "../../supabase/functions/_shared/clinical-helper-handler.ts";
const id = "11111111-1111-4111-8111-111111111111",
  pet = "22222222-2222-4222-8222-222222222222",
  encounter = "33333333-3333-4333-8333-333333333333";
const settings = settingsSchema.parse({
  singleton: true,
  version: 1,
  workweek_start: 1,
  weekly_hours: 40,
  daily_hours: 8,
  auto_close_hours: null,
  late_grace_minutes: null,
  payroll_provider: null,
  updated_at: "2026-01-01T00:00:00Z",
});
test("daily overtime is not counted a second time as weekly overtime", () => {
  const entries = Array.from({ length: 5 }, (_, i) => ({
    id,
    staff_id: id,
    clock_in_at: `2026-11-0${i + 2}T15:00:00Z`,
    clock_out_at: `2026-11-0${i + 2}T01:00:00Z`.replace(
      `0${i + 2}T`,
      `0${i + 3}T`,
    ),
    note: null,
  }));
  const totals = timeTotals(entries, settings, "2026-11-02", "2026-11-08")[0];
  assert.equal(totals.regular, 40);
  assert.equal(totals.overtime, 10);
});
test("Denver DST intervals use elapsed hours and reject unconfigured payroll rules", () => {
  const entries = [
    {
      id,
      staff_id: id,
      clock_in_at: "2026-11-01T06:00:00Z",
      clock_out_at: "2026-11-02T07:00:00Z",
      note: null,
    },
  ];
  const total = timeTotals(
    entries,
    { ...settings, daily_hours: null },
    "2026-11-01",
    "2026-11-01",
  )[0];
  assert.equal(total.regular, 25);
  assert.throws(
    () =>
      timeTotals(
        entries,
        { ...settings, workweek_start: null },
        "2026-11-01",
        "2026-11-02",
      ),
    /Set workweek/,
  );
});
test("unknown policy values and invalid leave ranges cannot become implied defaults", () => {
  assert.equal(
    commandSchema.safeParse({
      action: "request_leave",
      data: {
        kind: "PTO",
        starts_on: "2026-02-20",
        ends_on: "2026-02-19",
        hours: 8,
        reason: "",
      },
    }).success,
    false,
  );
  assert.equal(
    commandSchema.safeParse({
      action: "settings",
      data: {
        ...settings,
        version: 1,
        workweek_start: null,
        weekly_hours: null,
      },
    }).success,
    true,
  );
});
test("clinical calculators preserve units and approved known-answer cases", () => {
  const result = calculate("fluid", {
    weight: 10,
    unit: "kg",
    species: "dog",
    dehydration_percent: 5,
    replacement_hours: 24,
    ongoing_ml_hour: 10,
  });
  assert.equal(result.values.deficit_ml, 500);
  assert.ok(
    Math.abs(Number(result.values.total_ml_hour) - (25 + 500 / 24 + 10)) < 1e-9,
  );
  assert.equal(
    calculate("shock", { weight: 10, unit: "kg", species: "cat" }).values
      .bolus_low_ml,
    50,
  );
  assert.ok(
    Math.abs(
      Number(
        calculate("chocolate", {
          weight: 10,
          unit: "kg",
          grams: 100,
          product: "milk",
        }).values.estimated_methylxanthines_mg_kg_high,
      ) - 23,
    ) < 1e-9,
  );
  assert.equal(
    calculate("gestation", {
      species: "dog",
      basis: "ovulation",
      date: "2026-01-01",
    }).values.earliest_estimated_date,
    "2026-03-04",
  );
  assert.throws(() =>
    calculate("chocolate", {
      weight: 10,
      unit: "kg",
      grams: 100,
      product: "unknown",
    }),
  );
  assert.throws(() => calculate("fluid", { weight: -1 }));
});
test("payroll CSV neutralizes formulas and preserves embedded delimiters", () => {
  assert.equal(csvCell("=cmd()"), '"\'=cmd()"');
  assert.equal(csvCell('a,"b"'), '"a,""b"""');
  assert.equal(csvCell(25), "25");
});
const source = {
  patient: { id: pet, name: "Synthetic", species: "Dog" },
  sources: [{ source_ref: encounter, content: { plan: "Rest tonight." } }],
};
const result = {
  claims: [
    {
      text: "Rest tonight.",
      citations: [{ source_ref: encounter, quote: "Rest tonight." }],
    },
  ],
  review_flags: [],
};
test("clinical drafts must cite the selected source and bloodwork must include verified units/ranges", () => {
  assert.deepEqual(validateHelperEvidence(result, source), result);
  assert.throws(() =>
    validateHelperEvidence(
      {
        ...result,
        claims: [
          {
            text: "Made up",
            citations: [{ source_ref: id, quote: "Rest tonight." }],
          },
        ],
      },
      source,
    ),
  );
  assert.equal(
    helperRequestSchema.safeParse({
      id,
      pet_id: pet,
      kind: "bloodwork",
      data: {
        encounter_id: encounter,
        lab_id: id,
        lab_values: [],
        attest_reviewed: true,
      },
    }).success,
    false,
  );
});
test("clinical provider auth/activation failures never create paid work; valid output is persisted once", async () => {
  let claims = 0,
    calls = 0,
    finishes = 0;
  const deps: HelperDependencies = {
    enabled: true,
    apiKey: "synthetic",
    model: "configured-model",
    authenticate: async () => ({
      claim: async () => {
        claims++;
        return source;
      },
    }),
    finish: async (_id, value) => {
      finishes++;
      assert.deepEqual(value, result);
    },
    providerFetch: async () => {
      calls++;
      return new Response(
        JSON.stringify({
          status: "completed",
          model: "configured-model",
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: JSON.stringify(result) }],
            },
          ],
        }),
      );
    },
  };
  const body = JSON.stringify({
    id,
    pet_id: pet,
    kind: "discharge",
    data: { encounter_id: encounter },
  });
  const request = (token = true) =>
    new Request("https://example.test", {
      method: "POST",
      headers: token ? { Authorization: "Bearer synthetic" } : {},
      body,
    });
  assert.equal(
    (await createClinicalHelperHandler(deps)(request(false))).status,
    401,
  );
  assert.equal(
    (await createClinicalHelperHandler({ ...deps, enabled: false })(request()))
      .status,
    503,
  );
  assert.equal(claims, 0);
  assert.equal(calls, 0);
  assert.equal(
    (await createClinicalHelperHandler(deps)(request())).status,
    200,
  );
  assert.equal(claims, 1);
  assert.equal(calls, 1);
  assert.equal(finishes, 1);
});

test("money inputs preserve exact cents and reject hidden rounding", () => {
  assert.equal(dollarsToCents("25.01"), 2501);
  assert.throws(() => dollarsToCents("25.005"));
});
