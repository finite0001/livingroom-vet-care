import test from "node:test";
import assert from "node:assert/strict";
import {
  anesthesiaValues,
  emptyAnesthesia,
} from "../../src/hub/features/anesthesia/model.ts";
test("anesthesia form starts without assumed observations, dates, medications or normal values", () => {
  const form = emptyAnesthesia();
  assert.equal(form.started_at, "");
  assert.deepEqual(form.observations, []);
  assert.deepEqual(form.events, []);
});
test("monitoring records preserve explicit units and Denver timestamps without interpreting numbers", () => {
  const form = emptyAnesthesia();
  form.started_at = "2026-01-01T09:00";
  form.observations = [
    {
      at: "2026-01-01T09:02",
      label: "Documented parameter",
      value: "0",
      unit: "mmHg",
      notes: "Synthetic observation",
    },
  ];
  const values = anesthesiaValues(form);
  assert.equal(values.started_at, "2026-01-01T16:00:00.000Z");
  assert.equal(values.observations[0].at, "2026-01-01T16:02:00.000Z");
  assert.equal(values.observations[0].value, 0);
  assert.equal(values.observations[0].unit, "mmHg");
});
test("monitoring rejects empty/nonfinite values or implicit units and DST ambiguity", () => {
  const form = emptyAnesthesia();
  form.started_at = "2026-01-01T09:00";
  for (const value of ["", "Infinity", "NaN", "1e101"]) {
    form.observations = [
      {
        at: "2026-01-01T09:02",
        label: "Parameter",
        value,
        unit: "bpm",
        notes: "",
      },
    ];
    assert.throws(() => anesthesiaValues(form));
  }
  form.observations = [
    {
      at: "2026-01-01T09:02",
      label: "Parameter",
      value: "90",
      unit: "",
      notes: "",
    },
  ];
  assert.throws(() => anesthesiaValues(form));
  form.observations = [];
  form.started_at = "2026-11-01T01:30";
  assert.throws(() => anesthesiaValues(form));
});
