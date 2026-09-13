import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  importedPrescriptionSchema,
  parsePatientPrescriptionPage,
} from "../../src/hub/features/imports/prescription-review-state.ts";
const fixture = () =>
  JSON.parse(
    readFileSync(new URL("./receipt.fixture.json", import.meta.url), "utf8"),
  );
test("parses an exact synthetic SQL approval receipt without modifying source text", () => {
  const v = importedPrescriptionSchema.parse(fixture());
  assert.equal(
    v.items[0].source.original.instructions,
    "<script>outside prose</script>",
  );
  assert.equal(v.items[0].source.original.qty, "outside units");
  assert.equal(v.context.reviewed.completeness, "partial");
});
test("rejects patient, source and selected-item mismatches", () => {
  for (const change of [
    (v: ReturnType<typeof fixture>) => {
      v.context.patient_id = v.client_id;
    },
    (v: ReturnType<typeof fixture>) => {
      v.context.source.site_uid = "other-site";
    },
    (v: ReturnType<typeof fixture>) => {
      v.items[0].source.original.instructions = "Rewritten";
    },
  ]) {
    const v = fixture();
    change(v);
    assert.throws(() => importedPrescriptionSchema.parse(v));
  }
});
test("cannot hide omitted observed items or claim an unresolved account is complete", () => {
  const v = fixture();
  v.items = [];
  v.context.selected_items = [];
  assert.throws(() => importedPrescriptionSchema.parse(v));
  const c = fixture();
  c.context.reviewed.completeness = "complete";
  c.context.reviewed.partial_reason = null;
  assert.throws(() => importedPrescriptionSchema.parse(c));
});
test("rejects impossible or ambiguously labelled interpreted dates", () => {
  const v = fixture();
  v.context.reviewed.prescribed_on = "2026-02-30";
  v.context.reviewed.prescription_date_status = "date";
  assert.throws(() => importedPrescriptionSchema.parse(v));
  const c = fixture();
  c.context.reviewed.prescribed_on = "2026-09-13";
  assert.throws(() => importedPrescriptionSchema.parse(c));
});
test("chart response requires requested patient and consistent pagination", () => {
  const v = fixture();
  const page = { prescriptions: [v], has_more: false, next_cursor: null };
  assert.equal(
    parsePatientPrescriptionPage(page, v.pet_id).prescriptions.length,
    1,
  );
  assert.throws(() => parsePatientPrescriptionPage(page, v.client_id));
  assert.throws(() =>
    parsePatientPrescriptionPage({ ...page, has_more: true }, v.pet_id),
  );
  assert.throws(() =>
    parsePatientPrescriptionPage({ ...page, prescriptions: [v, v] }, v.pet_id),
  );
});
