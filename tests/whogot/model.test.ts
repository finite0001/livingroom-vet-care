import assert from "node:assert/strict";
import { test } from "node:test";
import {
  csvCell,
  emptyFilters,
  filtersSchema,
  sourceHref,
  whogotCsv,
  type WhogotRow,
} from "../../src/hub/features/whogot/model.ts";
const row: WhogotRow = {
  id: "11111111-1111-4111-8111-111111111111",
  pet_id: "22222222-2222-4222-8222-222222222222",
  product_id: null,
  product_name: "Vaccine, original",
  event_type: "administered",
  item_kind: "vaccine",
  occurred_at: "2026-10-01T12:00:00Z",
  historical: true,
  clinician: "Outside DVM",
  lots: '=HYPERLINK("example")',
  correction_status: "corrected",
  correction_reason: "Wrong entry",
  replacement_id: null,
  encounter_id: null,
  authorization_id: null,
  source_note: "Owner record",
  patient_name: "Pet",
  species: "Dog",
  deceased_at: null,
  archived_at: null,
  client_id: "33333333-3333-4333-8333-333333333333",
  client_name: "Client",
  phone: "+13035550101",
  email: "client@example.test",
};
test("date filters reject calendar overflow and reversed ranges, retain inclusive calendar dates", () => {
  assert.equal(
    filtersSchema.safeParse({ ...emptyFilters, from: "2026-02-30" }).success,
    false,
  );
  assert.equal(
    filtersSchema.safeParse({
      ...emptyFilters,
      from: "2026-10-02",
      to: "2026-10-01",
    }).success,
    false,
  );
  assert.equal(
    filtersSchema.safeParse({
      ...emptyFilters,
      from: "2026-10-01",
      to: "2026-10-01",
    }).success,
    true,
  );
  assert.equal(
    filtersSchema.safeParse({ ...emptyFilters, eventType: "prescribed" })
      .success,
    false,
  );
});
test("filters preserve exact lot identity and reject malformed stable IDs", () => {
  assert.equal(
    filtersSchema.parse({ ...emptyFilters, lot: " LOT-1 " }).lot,
    "LOT-1",
  );
  assert.equal(
    filtersSchema.safeParse({ ...emptyFilters, productId: "rabies" }).success,
    false,
  );
  assert.equal(
    filtersSchema.safeParse({ ...emptyFilters, lot: "x".repeat(201) }).success,
    false,
  );
});
test("CSV protects formulas including whitespace, tab and telephone prefixes", () => {
  for (const unsafe of [
    "=SUM(A1)",
    "+123",
    "-123",
    "@formula",
    "  =formula",
    "\tformula",
    "\rformula",
    "\nformula",
  ])
    assert.ok(csvCell(unsafe).startsWith("\"'"));
  assert.equal(csvCell("ordinary"), '"ordinary"');
  assert.equal(csvCell('a,"b"\nc'), '"a,""b""\nc"');
});
test("CSV carries historical and correction evidence and exact source links", () => {
  const csv = whogotCsv([row], "2026-10-09T12:00:00Z");
  assert.ok(csv.includes("Historical entry"));
  assert.ok(csv.includes("corrected"));
  assert.ok(csv.includes("Wrong entry"));
  assert.ok(csv.includes('"Vaccine, original"'));
  assert.ok(csv.includes("2026-10-09T12:00:00Z"));
  assert.ok(csv.includes(sourceHref(row)));
  assert.ok(csv.includes('"\'+13035550101"'));
  assert.ok(
    sourceHref(row).includes(
      `/source/administered/${row.id}?patient=${row.pet_id}`,
    ),
  );
});
