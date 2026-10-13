import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nextVisitContextSchema,
  nextVisitOutcomeValuesSchema,
  nextVisitDueCareSchema,
  futureVisitPageSchema,
  nextVisitCompletionReceiptSchema,
} from "../../src/hub/features/scheduling/next-visit-model.ts";
const id = (n: number) =>
  `49000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = "2030-01-01T16:00:00Z";
const appointment = {
  id: id(1),
  version: 2,
  client_id: id(2),
  pet_id: id(3),
  status: "COMPLETED",
  scheduled_at: at,
  duration_minutes: 30,
  appointment_type: "Custom",
  assigned_dvm_id: id(4),
};
const context = {
  occurrence: {
    id: id(5),
    appointment_id: id(1),
    appointment_version: 2,
    client_id: id(2),
    pet_id: id(3),
    snapshot: appointment,
    binding: null,
    actor_id: id(4),
    recorded_at: at,
  },
  version: 0,
  decision: null,
  current: true,
  source_status: "COMPLETED",
  patient_name: "Dog",
  client_name: "Client",
};
const empty = {
  action: "later",
  note: "",
  followup_on: null,
  booking: null,
  appointment_id: null,
  appointment_version: null,
};
test("Completion identity stays frozen when the current appointment changes patient", () => {
  assert.equal(nextVisitContextSchema.safeParse(context).success, true);
  assert.equal(
    nextVisitContextSchema.safeParse({
      ...context,
      occurrence: {
        ...context.occurrence,
        snapshot: { ...appointment, pet_id: id(6) },
      },
    }).success,
    false,
  );
  assert.equal(
    nextVisitContextSchema.safeParse({
      ...context,
      current: false,
      source_status: "CANCELLED",
    }).success,
    true,
  );
  assert.equal(
    nextVisitContextSchema.safeParse({ ...context, source_status: "CANCELLED" })
      .success,
    false,
  );
});
test("Fresh completion receipt cannot acknowledge a different patient or stale occurrence", () => {
  assert.equal(
    nextVisitCompletionReceiptSchema.safeParse({ appointment, context })
      .success,
    true,
  );
  assert.equal(
    nextVisitCompletionReceiptSchema.safeParse({
      appointment: { ...appointment, pet_id: id(6) },
      context,
    }).success,
    false,
  );
  assert.equal(
    nextVisitCompletionReceiptSchema.safeParse({
      appointment,
      context: { ...context, current: false, source_status: "CANCELLED" },
    }).success,
    false,
  );
  assert.equal(
    nextVisitCompletionReceiptSchema.safeParse({
      appointment,
      context: { ...context, current: false },
    }).success,
    true,
  );
  assert.equal(
    nextVisitContextSchema.safeParse({
      ...context,
      occurrence: {
        ...context.occurrence,
        actor_id: null,
        snapshot: { ...appointment, assigned_dvm_id: null },
      },
    }).success,
    true,
  );
});
test("Mixed existing/new/later work is rejected rather than dropped", () => {
  assert.equal(nextVisitOutcomeValuesSchema.safeParse(empty).success, true);
  assert.equal(
    nextVisitOutcomeValuesSchema.safeParse({
      ...empty,
      action: "existing",
      appointment_id: id(1),
      appointment_version: 1,
    }).success,
    true,
  );
  assert.equal(
    nextVisitOutcomeValuesSchema.safeParse({
      ...empty,
      action: "existing",
      appointment_id: id(1),
    }).success,
    false,
  );
  assert.equal(
    nextVisitOutcomeValuesSchema.safeParse({
      ...empty,
      action: "declined",
      followup_on: "2030-01-01",
    }).success,
    false,
  );
  assert.equal(
    nextVisitOutcomeValuesSchema.safeParse({
      ...empty,
      followup_on: "2030-02-30",
    }).success,
    false,
  );
  assert.equal(
    nextVisitOutcomeValuesSchema.safeParse({ ...empty, extra: "ignored" })
      .success,
    false,
  );
});
test("Receipt cannot link another patient's future appointment", () => {
  const followup = {
    ...appointment,
    id: id(7),
    version: 1,
    status: "SCHEDULED",
  };
  const decision = {
    id: id(8),
    occurrence_id: id(5),
    version: 1,
    kind: "booked",
    note: "",
    followup_on: null,
    appointment_id: id(7),
    booking_receipt: { appointment: followup, binding: null },
    actor_id: id(4),
    recorded_at: at,
  };
  assert.equal(
    nextVisitContextSchema.safeParse({ ...context, version: 1, decision })
      .success,
    true,
  );
  assert.equal(
    nextVisitContextSchema.safeParse({
      ...context,
      version: 1,
      decision: {
        ...decision,
        booking_receipt: {
          appointment: { ...followup, pet_id: id(9) },
          binding: null,
        },
      },
    }).success,
    false,
  );
  assert.equal(
    nextVisitContextSchema.safeParse({ ...context, version: 2, decision })
      .success,
    false,
  );
});
test("Planned lab work is not promoted to a reviewed care recommendation", () => {
  const row = {
    kind: "lab",
    id: id(1),
    version: 1,
    label: "CBC",
    due_on: "2030-01-01",
    review_state: "planned",
  };
  assert.equal(
    nextVisitDueCareSchema.safeParse({ items: [row], next: null }).success,
    true,
  );
  assert.equal(
    nextVisitDueCareSchema.safeParse({
      items: [{ ...row, review_state: "reviewed" }],
      next: null,
    }).success,
    false,
  );
  assert.equal(
    nextVisitDueCareSchema.safeParse({
      items: [{ ...row, kind: "care_plan" }],
      next: null,
    }).success,
    false,
  );
});
test("Future page uses its server as-of and only active appointments", () => {
  const row = {
    ...appointment,
    status: "CONFIRMED",
    scheduled_at: "2030-01-02T16:00:00Z",
  };
  assert.equal(
    futureVisitPageSchema.safeParse({ as_of: at, items: [row], next: null })
      .success,
    true,
  );
  assert.equal(
    futureVisitPageSchema.safeParse({
      as_of: at,
      items: [{ ...row, status: "CANCELLED" }],
      next: null,
    }).success,
    false,
  );
  assert.equal(
    futureVisitPageSchema.safeParse({
      as_of: at,
      items: [{ ...row, scheduled_at: at }],
      next: null,
    }).success,
    false,
  );
});
