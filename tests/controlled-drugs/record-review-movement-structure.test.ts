import { test } from "node:test";
import assert from "node:assert/strict";
import { ExactJsonNumber } from "../../src/hub/features/controlled-drugs/record-review/exact-json.ts";
import { movementAdjustArgumentsSchema, movementContextSchema, movementFrozenSchema, movementReceiveArgumentsSchema } from "../../src/hub/features/controlled-drugs/record-review/movement-structure.ts";
import { actor, event, operation, policy } from "./record-review-lifecycle-fixture.ts";
const number = (value: string) => new ExactJsonNumber(value);
const catalog = () => ({ id: policy, name: "Synthetic stock", kind: "medication", manufacturer: "", unit: "mL",
  unit_price_cents: number("100"), active: true, version: number("1"), created_by: actor, created_at: "2000-01-01T00:00:00Z" });
const line = () => ({ lot_id: operation, channel: "available", dispense_id: null, intake_id: null, quantity_delta: "-0.001" });
const context = () => ({ version: number("1"), product_id: policy, policy_version_id: policy, state_head_id: event, opening_id: operation,
  basis: { kind: "physical_record", observed_at: "2000-01-01T00:00:00.000001Z", note: "Synthetic note\nwith details" },
  containers: [{ id: actor, expected_version: number("0"), create: null,
    after: { status: "onsite", location_id: operation, custodian_id: null }, lines: [line()] }] });

test("retained catalog names and units use PostgreSQL space-only trim and code-point lengths", () => {
  const schema = movementFrozenSchema.shape.catalog;
  for (const name of [" ".repeat(300) + "x" + " ".repeat(300), "🐕".repeat(200), "\u00a0"])
    assert.equal(schema.safeParse({ ...catalog(), name }).success, true);
  for (const name of ["", "   ", "🐕".repeat(201)]) assert.equal(schema.safeParse({ ...catalog(), name }).success, false);
  assert.equal(schema.safeParse({ ...catalog(), unit: "🐕".repeat(50) }).success, true);
  assert.equal(schema.safeParse({ ...catalog(), unit: "  " }).success, false);
  assert.equal(schema.safeParse({ ...catalog(), unit_price_cents: "100" }).success, false);
  assert.equal(schema.safeParse({ ...catalog(), manufacturer: "" }).success, true);
});
test("movement context distinguishes numeric source tokens, decimal strings and historical timestamps", () => {
  assert.equal(movementContextSchema.safeParse(context()).success, true);
  assert.equal(movementContextSchema.safeParse({ ...context(), version: number("1.0") }).success, true);
  const empty = context(); empty.containers[0].lines = [];
  assert.equal(movementContextSchema.safeParse(empty).success, true); // Empty descriptors still need a transition later.
  const changes = [c => { c.version = 1; }, c => { c.basis.observed_at = "2000-02-30T00:00:00Z"; },
    c => { c.containers[0].expected_version = number("0.0"); }, c => { c.containers[0].lines[0].quantity_delta = "0"; },
    c => { c.containers[0].lines[0].quantity_delta = "-0.0001"; }, c => { c.containers[0].lines[0].quantity_delta = number("-0.001"); },
    c => { c.containers[0].lines[0].channel = "prepared"; }, c => { c.containers[0].after.status = "disposed"; },
    c => { c.containers.push(c.containers[0]); }, c => { c.basis.extra = "unknown"; }];
  for (const change of changes) { const c = context(); change(c); assert.equal(movementContextSchema.safeParse(c).success, false); }
});
test("receive and adjustment argument objects stay distinct and retain clean original text", () => {
  const adjust = { lot_id: operation, quantity: "-1.00", reason: "Synthetic adjustment\nwith detail" };
  assert.equal(movementAdjustArgumentsSchema.safeParse(adjust).success, true);
  assert.equal(movementAdjustArgumentsSchema.safeParse({ ...adjust, product_id: policy }).success, false);
  assert.equal(movementAdjustArgumentsSchema.safeParse({ ...adjust, reason: " leading space" }).success, false);
  const receive = { ...adjust, quantity: "1.000", product_id: policy, lot_number: "SYNTHETIC", expires_on: "2027-01-01", location: "Synthetic clinic" };
  assert.equal(movementReceiveArgumentsSchema.safeParse(receive).success, true);
  assert.equal(movementReceiveArgumentsSchema.safeParse({ ...receive, expires_on: "2027-02-29" }).success, false);
});
