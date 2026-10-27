import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { entryContextSchema, entryOptionsSchema } from "../../src/hub/features/controlled-drugs/entry/schema.ts";
import { entryFixtureFromBytes } from "./controlled-entry-fixture.ts";

const fixture = () => entryFixtureFromBytes(readFileSync(new URL("./record-review-stock-movement-reference.json", import.meta.url)));

test("entry display labels, names and units retain original single-line text rules", () => {
  const options = fixture().probe.options!;
  assert.equal(entryOptionsSchema.safeParse(options).success, true);
  for (const value of ["Actual\tlabel", "Actual\nlabel", "Actual\rlabel", "Actual\x7flabel"]) {
    const cases = [
      { ...options, product_name: value },
      { ...options, stock_unit: value },
      { ...options, sites: [{ ...options.sites[0], label: value }] },
      { ...options, locations: [{ ...options.locations[0], label: value }] },
      { ...options, custodians: [{ ...options.custodians[0], name: value }] },
      { ...options, containers: [{ ...options.containers[0], label: value }] },
    ];
    for (const candidate of cases) assert.equal(entryOptionsSchema.safeParse(candidate).success, false, JSON.stringify(value));
  }
  assert.equal(entryOptionsSchema.safeParse({ ...options, product_name: "Actual 🐾 medication" }).success, true);
  assert.equal(entryOptionsSchema.safeParse({ ...options, product_name: "\u0085" }).success, true);
});

test("only entry basis notes permit internal TAB and LF; CR and altered edges refuse", () => {
  const context = fixture().context;
  const parse = (note: string | null) => entryContextSchema.safeParse({ ...context, basis: { ...context.basis, note } }).success;
  assert.equal(parse("Counted\nstock\tcarefully"), true);
  assert.equal(parse(null), true);
  for (const note of ["Counted\rstock", "Counted\r\nstock", " Counted", "Counted\n", "\tCounted", "Counted\x7fstock"])
    assert.equal(parse(note), false, JSON.stringify(note));
  for (let code = 0; code < 32; code++)
    assert.equal(parse(`Counted${String.fromCodePoint(code)}stock`), code === 9 || code === 10, String(code));
});

test("new container labels also use single-line text while notes retain multiline spelling", () => {
  const f = fixture(), original = f.context.containers[0];
  const create = { kind: "stock" as const, label: "Actual bottle", stock_lot_id: original.lines[0].lot_id,
    site_id: f.probe.options!.sites[0].id, location_id: original.after.location_id!, custodian_id: original.after.custodian_id };
  const context = { ...f.context, basis: { ...f.context.basis, note: "Counted\nstock\tcarefully" },
    containers: [{ ...original, expected_version: null, create }] };
  assert.equal(entryContextSchema.safeParse(context).success, true);
  for (const label of ["Actual\tbottle", "Actual\nbottle", "Actual\rbottle"])
    assert.equal(entryContextSchema.safeParse({ ...context, containers: [{ ...context.containers[0], create: { ...create, label } }] }).success, false);
});
