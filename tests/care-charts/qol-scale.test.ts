import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  QOL_SCALE_CATEGORIES,
  QOL_SCALE_MAX_TOTAL,
  activeReference,
  chartX,
  chartY,
  latestChange,
  parseQolScore,
  qolTotal,
  qolTrend,
  scoredCount,
  unscoredCategories,
  type QolScaleScores,
  type QolTrendInput,
} from "../../src/hub/features/care-charts/qol-scale.ts";
const read = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const migration = read(
  "supabase/migrations/20260928130000_qol_hhhhhmm_scale.sql",
);
const full = (n: number): QolScaleScores => ({
  hurt: n,
  hunger: n,
  hydration: n,
  hygiene: n,
  happiness: n,
  mobility: n,
  more_good_days: n,
});
const row = (
  id: string,
  assessed_at: string,
  scores: QolScaleScores,
  status = "signed",
): QolTrendInput => ({ id, assessed_at, status, ...scores });
test("the scale has the seven published HHHHHMM categories and a 70-point maximum", () => {
  assert.deepEqual(
    QOL_SCALE_CATEGORIES.map((c) => c.label),
    [
      "Hurt",
      "Hunger",
      "Hydration",
      "Hygiene",
      "Happiness",
      "Mobility",
      "More good days than bad",
    ],
  );
  assert.equal(QOL_SCALE_MAX_TOTAL, 70);
});
test("category scores accept blank or whole numbers 0-10 only", () => {
  assert.equal(parseQolScore(""), null);
  assert.equal(parseQolScore("  "), null);
  assert.equal(parseQolScore("0"), 0);
  assert.equal(parseQolScore("10"), 10);
  assert.equal(parseQolScore(" 7 "), 7);
  for (const bad of ["11", "-1", "5.5", "1e1", "NaN", "Infinity", "abc", "100"])
    assert.throws(() => parseQolScore(bad), /0 to 10/);
});
test("total is the sum of all seven categories and unknown while any is unscored", () => {
  assert.equal(qolTotal(full(0)), 0);
  assert.equal(qolTotal(full(10)), 70);
  assert.equal(
    qolTotal({ ...full(5), hurt: 7, more_good_days: 3 }),
    35,
  );
  const partial = { ...full(5), hygiene: null, mobility: null };
  assert.equal(qolTotal(partial), null);
  assert.equal(scoredCount(partial), 5);
  assert.deepEqual(unscoredCategories(partial), ["Hygiene", "Mobility"]);
  assert.deepEqual(unscoredCategories(full(1)), []);
});
test("trend includes signed, fully scored assessments in chronological order", () => {
  const points = qolTrend([
    row("c", "2026-09-20T16:00:00Z", full(6)),
    row("a", "2026-09-01T16:00:00Z", full(4)),
    row("d", "2026-09-25T16:00:00Z", full(9), "draft"),
    row("b", "2026-09-10T16:00:00Z", { ...full(5), hurt: 8 }),
    row("z", "2026-09-10T16:00:00Z", full(3)),
  ]);
  assert.deepEqual(
    points.map((p) => [p.id, p.total]),
    [
      ["a", 28],
      ["b", 38],
      ["z", 21],
      ["c", 42],
    ],
  );
  assert.equal(points[1].scores.hurt, 8);
  assert.equal(latestChange(points), 21);
  assert.equal(latestChange(points, "hurt"), 3);
  assert.equal(latestChange(points.slice(0, 1)), null);
  assert.deepEqual(qolTrend([]), []);
});
test("chart geometry maps 0 to the bottom and the maximum to the top, clamped", () => {
  assert.equal(chartY(0, 70, 16, 168), 184);
  assert.equal(chartY(70, 70, 16, 168), 16);
  assert.equal(chartY(35, 70, 16, 168), 100);
  assert.equal(chartY(99, 70, 16, 168), 16);
  assert.equal(chartY(-5, 10, 0, 100), 100);
  assert.equal(chartX(0, 1, 36, 500), 286);
  assert.equal(chartX(0, 3, 36, 500), 36);
  assert.equal(chartX(2, 3, 36, 500), 536);
});
test("a reference line is shown only when an administrator fully configured it", () => {
  const base = {
    enabled: true,
    reference_total: 30,
    reference_label: "Configured wording",
    review_note: "Reviewed by",
  };
  assert.deepEqual(activeReference(base), {
    total: 30,
    label: "Configured wording",
  });
  assert.equal(activeReference(null), null);
  assert.equal(activeReference(undefined), null);
  assert.equal(activeReference({ ...base, enabled: false }), null);
  assert.equal(activeReference({ ...base, reference_total: null }), null);
  assert.equal(activeReference({ ...base, reference_label: " " }), null);
  assert.equal(activeReference({ ...base, review_note: "" }), null);
  assert.equal(activeReference({ ...base, reference_total: 71 }), null);
});
test("no interpretation threshold is hardcoded in the client or seeded by the migration", () => {
  const client =
    read("src/hub/features/care-charts/qol-scale.ts") +
    read("src/hub/features/care-charts/QolScaleCharts.tsx");
  assert.doesNotMatch(client, /acceptable|euthan|>\s*35|>=\s*35/i);
  assert.match(
    migration,
    /insert into public\.qol_scale_reference_settings\(id\) values\('[0-9a-f-]+'\);/,
  );
  assert.match(migration, /enabled boolean not null default false/);
  assert.match(migration, /reference_total smallint check\(reference_total between 0 and 70\)/);
});
test("migration enforces 0-10 categories, complete signing and immutable signed rows", () => {
  for (const { key } of QOL_SCALE_CATEGORIES)
    assert.match(
      migration,
      new RegExp(`${key} smallint check\\(${key} between 0 and 10\\)`),
    );
  assert.match(
    migration,
    /total smallint generated always as \(hurt\+hunger\+hydration\+hygiene\+happiness\+mobility\+more_good_days\) stored/,
  );
  assert.match(migration, /qol_scale_signed_requires_all_categories/);
  assert.match(
    migration,
    /Signed quality-of-life assessments are immutable; add an addendum/,
  );
  assert.doesNotMatch(
    migration,
    /grant (insert|update|delete)[^;]*(patient_qol_scale|qol_scale_reference)/i,
  );
});
