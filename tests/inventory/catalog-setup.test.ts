import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  configureSourceSchema,
  sourceItemSchema,
} from "../../src/hub/features/inventory/catalog-setup/model.ts";

const items = JSON.parse(
  readFileSync(
    new URL("../../docs/inventory/catalog-source.json", import.meta.url),
    "utf8",
  ),
);
test("source import retains all rows and unknown quantities without inventing catalog settings", () => {
  assert.equal(items.length, 217);
  assert.equal(new Set(items.map((row) => row.id)).size, 217);
  assert.equal(
    new Set(items.map((row) => `${row.source_tab}:${row.source_row}`)).size,
    217,
  );
  assert.equal(new Set(items.map((row) => row.source_tab)).size, 16);
  for (const item of items) {
    assert.equal(
      item.source_fields.Drug ??
        item.source_fields.Item ??
        item.source_fields.Vaccine,
      item.name,
    );
    assert.equal(
      item.source_fields["On hand"] ?? item.source_fields["Current Inventory"],
      "",
    );
    assert.equal("unit" in item, false);
    assert.equal("unit_price_cents" in item, false);
  }
  assert.equal(items.filter((row) => row.source_tab === "Vax").length, 8);
});
test("configuring a product requires explicit exact metadata and staff identity", () => {
  const request = {
    p_actor_id: "8259ab86-0992-4344-bea3-71c9cbba0f2b",
    p_source_id: items[0].id,
    p_id: "34000000-0000-4000-8000-000000000001",
    p_name: "Carprofen 25 mg tablet",
    p_kind: "medication",
    p_manufacturer: "",
    p_unit: "tablet",
    p_unit_price_cents: 125,
  };
  assert.ok(configureSourceSchema.safeParse(request).success);
  for (const change of [
    { p_unit: "" },
    { p_name: " " },
    { p_unit_price_cents: undefined },
    { p_unit_price_cents: -1 },
    { p_unit_price_cents: 1.5 },
    { p_actor_id: "" },
    { p_kind: "supply" },
  ])
    assert.equal(
      configureSourceSchema.safeParse({ ...request, ...change }).success,
      false,
    );
});
test("draft reads preserve several linked variants and empty inventory source values", () => {
  const row = {
    ...items[0],
    source_url: "https://docs.google.com/spreadsheets/d/source/edit",
    captured_on: "2026-11-10",
    products: [
      {
        id: "34000000-0000-4000-8000-000000000001",
        name: "Carprofen 25 mg tablet",
        active: true,
      },
      {
        id: "34000000-0000-4000-8000-000000000002",
        name: "Carprofen 75 mg tablet",
        active: false,
      },
    ],
  };
  assert.equal(sourceItemSchema.parse(row).products.length, 2);
  assert.equal(sourceItemSchema.parse(row).source_fields["On hand"], "");
});
