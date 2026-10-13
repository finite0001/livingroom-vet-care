import { test } from "node:test";
import assert from "node:assert/strict";
import {
  typeDefinitionSchema,
  resourceDefinitionSchema,
  bookingValuesSchema,
  bindingSchema,
  matchesType,
  requiresTimeReview,
} from "../../src/hub/features/scheduling/catalog-model.ts";
const type = {
  name: "Wellness",
  category: "well",
  species: ["Dog"],
  visit_types: ["clinic", "housecall"],
  duration_minutes: 30,
  travel_before_minutes: 0,
  travel_after_minutes: 0,
  resource_kind: "exam",
  staffing: "dvm",
  allow_override: false,
};
test("Species and location matching uses patient labels without accepting an unreviewed species", () => {
  const definition = typeDefinitionSchema.parse(type);
  assert.equal(matchesType(definition, " dog ", "clinic"), true);
  assert.equal(matchesType(definition, "Cat", "clinic"), false);
  assert.equal(matchesType(definition, "Dog", "virtual"), false);
});
test("Case duration needs review; zero travel buffers are preserved", () => {
  const definition = typeDefinitionSchema.parse(type);
  assert.equal(requiresTimeReview(definition, 30, 0, 0), false);
  assert.equal(
    requiresTimeReview({ ...definition, duration_minutes: null }, 30, 0, 0),
    true,
  );
  assert.equal(requiresTimeReview(definition, 45, 0, 0), true);
  assert.equal(requiresTimeReview(definition, 30, 0, 10), true);
});
test("Definitions reject duplicate species/modes, null policy booleans and silent extra fields", () => {
  for (const patch of [
    { species: ["Dog", "dog"] },
    { visit_types: ["clinic", "clinic"] },
    { allow_override: null },
    { duration_minutes: 5 },
    { resource_kind: 4 },
    { unreviewed: true },
  ])
    assert.equal(
      typeDefinitionSchema.safeParse({ ...type, ...patch }).success,
      false,
    );
  assert.equal(
    resourceDefinitionSchema.safeParse({
      name: "Room 1",
      resource_kind: "exam",
      visit_types: ["clinic"],
      aliases: ["Room One", "room one"],
    }).success,
    false,
  );
});
test("Booking requests require a timezone, distinct reminders and all reviewed fields", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const values = {
    type_version_id: id,
    resource_version_id: null,
    client_id: id,
    pet_id: id,
    scheduled_at: "2030-01-01T16:00:00Z",
    duration_minutes: 30,
    status: "SCHEDULED",
    assigned_dvm_id: id,
    visit_type: "clinic",
    address_snapshot: "Synthetic",
    travel_before_minutes: 0,
    travel_after_minutes: 0,
    notes: "",
    reminder_offsets: [],
    override_note: "",
  };
  assert.equal(bookingValuesSchema.safeParse(values).success, true);
  for (const patch of [
    { scheduled_at: "2030-01-01T09:00:00" },
    { reminder_offsets: [24, 24] },
    { override_note: null },
    { duration_minutes: 0 },
  ])
    assert.equal(
      bookingValuesSchema.safeParse({ ...values, ...patch }).success,
      false,
    );
});
test("Frozen binding rejects swapped type names, draft versions and resource identities", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const revision = {
    id,
    entry_id: id,
    version: 2,
    state: "published",
    definition: type,
    review_note: "Synthetic review",
    actor_id: id,
    recorded_at: "2026-10-13T18:00:00Z",
  };
  const binding = {
    type: revision,
    resource: null,
    fields: {
      client_id: id,
      pet_id: id,
      appointment_type: "Wellness",
      visit_type: "clinic",
      duration_minutes: 30,
      travel_before_minutes: 0,
      travel_after_minutes: 0,
      resource_name: null,
    },
    override_note: "",
  };
  assert.equal(bindingSchema.safeParse(binding).success, true);
  assert.equal(
    bindingSchema.safeParse({
      ...binding,
      type: { ...revision, state: "draft" },
    }).success,
    false,
  );
  assert.equal(
    bindingSchema.safeParse({
      ...binding,
      fields: { ...binding.fields, appointment_type: "Wrong" },
    }).success,
    false,
  );
  assert.equal(
    bindingSchema.safeParse({
      ...binding,
      fields: { ...binding.fields, resource_name: "Unknown" },
    }).success,
    false,
  );
});
