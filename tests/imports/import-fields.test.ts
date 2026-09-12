import test from "node:test";
import assert from "node:assert/strict";
import {
  initialImportFields,
  sourceDate,
} from "../../src/hub/features/imports/import-fields.ts";
test("patient suggestions retain microchip text without inventing species or sex from foreign IDs", () => {
  const fields = initialImportFields("animal", {
    name: "Juniper",
    species_id: 2,
    sex_id: 1,
    microchip_number: "0000123",
    date_of_birth: 1577836800,
    is_estimated_date_of_birth: true,
  });
  assert.equal(fields.name, "Juniper");
  assert.equal(fields.species, "");
  assert.equal(fields.sex, "unknown");
  assert.equal(fields.microchip_id, "0000123");
  assert.equal(fields.dob, "2020-01-01");
  assert.equal(fields.birth_date_precision, "estimated");
});
test("contact names remain reviewable text and unrelated details are not inferred", () => {
  const fields = initialImportFields("contact", {
    first_name: "<script>alert(1)</script>",
    last_name: "Family",
    email: "not-normalized",
  });
  assert.equal(fields.first_name, "<script>alert(1)</script>");
  assert.equal(fields.primary_email, "");
  assert.equal(fields.housecall_address, "");
  assert.equal(sourceDate("invalid"), "");
  assert.equal(sourceDate(0), "");
  assert.equal(sourceDate("2026-02-31"), "");
});
