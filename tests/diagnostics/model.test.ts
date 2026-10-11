import { test } from "node:test";
import assert from "node:assert/strict";
import {
  valuesSchema,
  numericInput,
  actionSchema,
  detailSchema,
} from "../../src/hub/features/diagnostics/model.ts";
import {
  comparableSeries,
  plotPoints,
} from "../../src/hub/features/diagnostics/trends.ts";
import { values, finalized, uuid } from "./fixture.ts";
test("zero is a numeric value; blanks never become zero or an accepted result", () => {
  assert.equal(numericInput("0"), 0);
  assert.equal(numericInput(""), null);
  assert.equal(numericInput("  "), null);
  assert.equal(numericInput("-2.5e-2"), -0.025);
  for (const s of ["-", "1e", "NaN", "Infinity", "0xFF", "1 2"])
    assert.throws(() => numericInput(s));
  const v = values();
  assert.equal(valuesSchema.parse(v).observations[0].value_number, 0);
  v.observations[0].value_number = null;
  assert.throws(() => valuesSchema.parse(v));
});
test("qualitative values remain text and cannot carry numeric/reference fields", () => {
  const v = values();
  v.observations[1].value_text = "0";
  assert.equal(valuesSchema.parse(v).observations[1].value_text, "0");
  v.observations[1].reference_low = 0;
  assert.throws(() => valuesSchema.parse(v));
});
test("invalid identities, fields, numbers and calendar dates fail validation", () => {
  for (const mutate of [
    (v: ReturnType<typeof values>) =>
      (v.observations[0].value_number = Infinity),
    (v) => (v.reported_on = "2026-02-30"),
    (v) => (v.reported_on = "2026-09-01"),
    (v) => (v.observations[0].unit = " U/L "),
    (v) => (v.observations[0].reference_low = 101),
    (v) => (v.document_id = uuid(70)),
    (v) => v.observations.push({ ...v.observations[0], id: uuid(80) }),
  ]) {
    const v = values();
    mutate(v);
    assert.throws(() => valuesSchema.parse(v));
  }
  assert.throws(() =>
    valuesSchema.parse({ ...values(), created_by: uuid(700) }),
  );
});
test("draft actions cannot forge clinical review and exact finalization review is required", () => {
  const a = {
    id: uuid(50),
    pet_id: uuid(900),
    expected_version: null,
    kind: "draft",
    values: values(),
    review_note: "",
    correction_reason: "",
  };
  assert.equal(actionSchema.parse(a).kind, "draft");
  assert.throws(() =>
    actionSchema.parse({ ...a, review_note: "pretend approval" }),
  );
  assert.throws(() => actionSchema.parse({ ...a, kind: "finalize" }));
});
test("compatible series retain zero, exact units and source-linked result versions", () => {
  const a = finalized(10),
    b = finalized(11);
  b.snapshot.collected_on = "2026-10-02";
  b.snapshot.observations[0].value_number = 2;
  const series = comparableSeries([b, a]);
  const numeric = series.find((s) => s.kind === "numeric")!;
  assert.equal(numeric.points.length, 2);
  assert.equal(numeric.points[0].finding.value_number, 0);
  assert.equal(numeric.points[0].panel.id, a.id);
  assert.ok(
    plotPoints(numeric).every(
      (p) => Number.isFinite(p.x) && Number.isFinite(p.y),
    ),
  );
  assert.equal(
    plotPoints(series.find((s) => s.kind === "qualitative")!).length,
    0,
  );
});
test("different unit/specimen/device/source or analyte identity creates separate series", () => {
  for (const field of ["unit", "specimen", "method", "source", "analyte_key"]) {
    const a = finalized(10),
      b = finalized(11);
    if (field === "unit") b.snapshot.observations[0].unit = "IU/L";
    else if (field === "analyte_key")
      b.snapshot.observations[0].analyte_key = "other-alt";
    else
      b.snapshot[field as "specimen" | "method" | "source"] =
        "Different exact source";
    assert.equal(
      comparableSeries([a, b]).filter((s) => s.kind === "numeric").length,
      2,
    );
  }
});
test("duplicate current panels are rejected instead of graphing old and current values together", () => {
  const a = finalized();
  assert.throws(
    () => comparableSeries([a, structuredClone(a)]),
    /Duplicate current/,
  );
});
test("a finalized result cannot be attached to a different patient or current panel head", () => {
  const v = finalized();
  const detail = {
    panel: {
      id: v.panel_id,
      pet_id: v.pet_id,
      version: 2,
      draft: null,
      current_finalized_id: v.id,
      current_finalized_number: 1,
      created_by: uuid(800),
      updated_by: uuid(801),
      created_at: v.reviewed_at,
      updated_at: v.reviewed_at,
    },
    current: { ...v, original_current_available: null },
    pdf_status: "not_available",
    export_eligible: false,
  };
  assert.equal(
    detailSchema.parse(detail).current?.snapshot.observations[0].value_number,
    0,
  );
  assert.throws(() =>
    detailSchema.parse({
      ...detail,
      current: { ...detail.current, pet_id: uuid(901) },
    }),
  );
});

test("different patients cannot share a diagnostic trend series", () => {
  const a = finalized(10),
    b = finalized(11);
  b.pet_id = uuid(901);
  assert.throws(() => comparableSeries([a, b]), /one patient/);
});

test("numeric underflow cannot turn a nonzero documented result into zero", () => {
  for (const text of ["1e-400", "-1e-400", "1e-200"])
    assert.throws(() => numericInput(text));
  const v = values();
  v.observations[0].value_number = 1e-200;
  assert.throws(() => valuesSchema.parse(v));
  assert.equal(numericInput("0e-400"), 0);
});
