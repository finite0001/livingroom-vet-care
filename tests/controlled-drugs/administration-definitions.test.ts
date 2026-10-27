import assert from "node:assert/strict";
import test from "node:test";
import { initialStockPolicyDraft, buildStockPolicy } from "../../src/hub/features/controlled-drugs/administration/stock-policy-form.ts";
import { buildStockOpening, type OpeningFormDraft } from "../../src/hub/features/controlled-drugs/administration/opening-form.ts";
import { administrationRequestSchema } from "../../src/hub/features/controlled-drugs/administration/schema.ts";
import { stockOpeningPreviewReplySchema } from "../../src/hub/features/controlled-drugs/administration/queries.ts";
import { reviewEventKindSchema } from "../../src/hub/features/controlled-drugs/record-review/queue-model.ts";
import { stockPermissionBasis, openingSlotIdentity, openingPlacementSchema, stockOpeningDefinitionSchema } from "../../src/hub/features/controlled-drugs/administration/opening-definition.ts";
import { administrationName, administrationReference } from "../../src/hub/features/controlled-drugs/administration/primitives.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const policy = () => ({ sites: [id(1)], retainedReturns: "no", reference: "Reviewed clinic policy", rules: Object.fromEntries(reviewEventKindSchema.options.map(kind => [kind, { enabled: "no", roles: [], witness: "none", secondary: "no", locations: [] }])) });
function opening() {
  return stockOpeningPreviewReplySchema.parse({ schema_version: 1, state: "available", data: { product: { id: id(2), name: "Synthetic medication", version: "1", stock_unit: "mL" }, draft_version_id: id(3), source_basis_digest: "a".repeat(64), blocked_reason: null,
    slots: [{ slot: { channel: "available", lot_id: id(4), dispense_id: null, allocation_id: null, intake_id: null }, display_label: "Synthetic lot", recorded_quantity: "10.000", custody_state: "onsite", observation_required: true }] } });
}
test("first policy settings are blank and every source action needs an explicit decision", () => {
  const draft = initialStockPolicyDraft(); assert.equal(draft.retainedReturns, ""); assert.deepEqual(draft.sites, []);
  assert.ok(Object.values(draft.rules).every(row => row.enabled === "" && row.witness === "" && row.secondary === "" && row.roles.length === 0));
  assert.throws(() => buildStockPolicy(draft, [id(1)]));
  const complete = buildStockPolicy(policy(), [id(1)]);
  assert.equal(Object.keys(complete.permissions).length, 22);
  for (const kind of reviewEventKindSchema.options) assert.equal(complete.permissions[kind]!.basis, stockPermissionBasis(kind));
  const enabled = policy(); enabled.rules.receive_inventory.enabled = "yes";
  assert.throws(() => buildStockPolicy(enabled, [id(1)]));
  assert.throws(() => buildStockPolicy({ ...policy(), sites: [id(9)] }, [id(1)]));
});
test("opening binds complete preview positions and keeps observed quantity independent of recorded stock", () => {
  const source = opening(), slot = source.data.slots![0].slot;
  const draft: OpeningFormDraft = { policy: policy(), placements: [{ slotKey: openingSlotIdentity(slot), label: "Vial A", location: id(5), custodian: "", quantity: "10.000", observedLocal: "2026-10-27T10:00:00", observedOffset: "" }], completedLocal: "2026-10-27T10:05:00", completedOffset: "", note: "Physical opening observation", attest: true };
  const locations = [{ id: id(5), site_id: id(1), label: "Clinic safe", kind: "clinic" as const, initial_custodian_id: null }];
  const result = buildStockOpening(source, draft, locations, [], [id(1)]);
  assert.equal(result.placements[0].quantity, "10.000"); assert.equal(result.placements[0].custodian_id, null);
  assert.equal(source.data.slots![0].recorded_quantity, "10.000");
  assert.throws(() => buildStockOpening(source, { ...draft, placements: [{ ...draft.placements[0], quantity: "9.125" }] }, locations, [], [id(1)]), /differs/);
  assert.throws(() => buildStockOpening(source, { ...draft, placements: [] }, locations, [], [id(1)]));
  assert.throws(() => buildStockOpening(source, { ...draft, placements: [{ ...draft.placements[0], slotKey: "another" }] }, locations, [], [id(1)]));
  assert.throws(() => buildStockOpening(source, { ...draft, placements: [{ ...draft.placements[0], quantity: "" }] }, locations, [], [id(1)]));
  assert.throws(() => buildStockOpening(source, { ...draft, attest: false }, locations, [], [id(1)]));
  assert.throws(() => buildStockOpening(source, { ...draft, completedLocal: "2026-10-27T09:59:00" }, locations, [], [id(1)]));
  const mobile = [{ ...locations[0], kind: "mobile_kit" as const, initial_custodian_id: id(6) }];
  assert.throws(() => buildStockOpening(source, draft, mobile, [id(6)], [id(1)]));
  assert.equal(buildStockOpening(source, { ...draft, placements: [{ ...draft.placements[0], custodian: id(6) }] }, mobile, [id(6)], [id(1)]).placements[0].custodian_id, id(6));
});
test("administration requests have exactly seven keys and bind the selected scope", () => {
  const request = { schema_version: 1, actor_id: id(1), operation_id: id(2), action: "site_register", product_id: null, site_id: id(2), definition: { site: { label: "Clinic", registration_reference: "Actual registration" }, locations: [{ key: "safe", label: "Safe", kind: "clinic", initial_custodian_id: null }] } };
  assert.equal(Object.keys(administrationRequestSchema.parse(request)).length, 7);
  assert.equal(administrationRequestSchema.safeParse({ ...request, site_id: id(3) }).success, false);
  assert.equal(administrationRequestSchema.safeParse({ ...request, product_id: id(4) }).success, false);
  assert.equal(administrationRequestSchema.safeParse({ ...request, extra: true }).success, false);
});
test("setup text preserves the original SQL spelling, Unicode edges and control rules", () => {
  for (const value of [" Clinic", "Clinic\u00a0", "\u2000Clinic", "Clinic\0", "Clinic\rnote", "Clinic\x7f", "Clinic\tnote", "Clinic\nnote"])
    assert.equal(administrationName.safeParse(value).success, false, JSON.stringify(value));
  assert.equal(administrationName.safeParse("Clinic 🐾").success, true);
  assert.equal(administrationName.safeParse("\u0085").success, true);
  assert.equal(administrationName.safeParse("\u200b").success, true);
  assert.equal(administrationReference.safeParse("Reviewed\nclinic\tnote").success, true);
  for (const value of ["\nReviewed", "Reviewed\n", "Reviewed\rnote", "Reviewed\x1fnote"])
    assert.equal(administrationReference.safeParse(value).success, false);
});
test("onsite opening requires an explicit observation and the original complete tuple order", () => {
  const placement = { slot: opening().data.slots![0].slot, label: "Bottle", location_id: id(5), custodian_id: null,
    status: "onsite", quantity: "0.000", observed_at: "2026-10-27T10:00:00.000000Z" };
  assert.equal(openingPlacementSchema.safeParse(placement).success, true);
  assert.equal(openingPlacementSchema.safeParse({ ...placement, quantity: null, observed_at: null }).success, false);
  assert.equal(openingPlacementSchema.safeParse({ ...placement, status: "handed_off", quantity: null, observed_at: null }).success, true);
  assert.equal(openingPlacementSchema.safeParse({ ...placement, status: "disposed" }).success, false);
  const second = { ...placement, slot: { ...placement.slot, lot_id: id(8) } };
  const definition = { draft_version_id: id(3), expected_basis_digest: "a".repeat(64), policy: buildStockPolicy(policy(), [id(1)]), completed_at: "2026-10-27T10:05:00.000000Z", note: "Reviewed actual source", placements: [placement, second] };
  assert.equal(stockOpeningDefinitionSchema.safeParse(definition).success, true);
  assert.equal(stockOpeningDefinitionSchema.safeParse({ ...definition, placements: [second, placement] }).success, false);
  assert.equal(stockOpeningDefinitionSchema.safeParse({ ...definition, placements: [placement, placement] }).success, false);
});
