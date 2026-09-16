import test from "node:test";
import assert from "node:assert/strict";
import {
  createFulfillmentApi,
  fulfillmentChargeCents,
  fulfillmentMoneySchema,
} from "../../src/hub/features/prescriptions/fulfillment-api.ts";
import {
  createPrescriptionApi,
  prescriptionUsageSchema,
} from "../../src/hub/features/prescriptions/prescription-api.ts";
import { parseNativeRefillEvent } from "../../src/hub/features/refills/refill-api.ts";
import {
  actor,
  pet,
  client,
  time,
  hash,
  id,
  signed,
  initialUsage,
  head,
  target,
  dispenseContext,
  slot,
  usedUsage,
  dispense,
  operation,
  receipt,
  closeOperation,
  closure,
  pickupOperation,
  pickup,
} from "./fulfillment-fixture.ts";
function setup(response: unknown) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  return {
    calls,
    api: createFulfillmentApi(
      {
        rpc: async (name, args) => {
          calls.push({ name, args });
          return { data: response, error: null };
        },
      },
      actor,
      signed() as never,
    ),
  };
}
test("dispense preview and immutable receipt preserve exact request strings and allocation identities", async () => {
  const preview = {
    version: 1,
    actor_id: actor,
    context: dispenseContext(),
    context_hash: hash,
    observed_at: time,
  };
  await setup(preview).api.previewDispense(target());
  const { api, calls } = setup(receipt());
  assert.deepEqual(await api.execute(operation()), receipt());
  await api.recover(operation());
  assert.deepEqual(calls[0], {
    name: "record_native_dispense",
    args: { p_id: id(1), p_request: operation().payload },
  });
  assert.equal(calls[1].name, "recover_native_fulfillment_operation");
  assert.equal(await setup(null).api.recover(operation()), null);
});
test("dispense rejects altered patient, actor, stock, invoice, artifact and slot metadata", async () => {
  const mutations: Array<(r: ReturnType<typeof receipt>) => void> = [
    (r) => {
      r.actor_id = client;
    },
    (r) => {
      r.result.dispense.pet_id = client;
    },
    (r) => {
      r.result.dispense.reviewed_context.patient.client_id = pet;
    },
    (r) => {
      r.result.dispense.reviewed_context.authorization.state = "cancelled";
    },
    (r) => {
      r.result.dispense.reviewed_context.lots[0].balance = "0.500";
    },
    (r) => {
      r.result.dispense.reviewed_context.lots[0].expires_on = "2026-09-15";
    },
    (r) => {
      r.result.dispense.reviewed_context.alerts.snapshot.patient_version = 2;
    },
    (r) => {
      r.result.dispense.allocations[0].quantity = "0.500";
    },
    (r) => {
      r.result.dispense.invoice_version_after = 3;
    },
    (r) => {
      r.result.dispense.artifact.lots[0].number = "Replaced live number";
    },
    (r) => {
      r.result.slot.opened_by = client;
    },
    (r) => {
      r.result.slot.opened_at = "2026-09-17T00:00:00Z";
    },
    (r) => {
      r.result.dispense.reviewed_context_hash = "b".repeat(64);
    },
    (r) => {
      r.request.quantity = "1.000";
    },
  ];
  for (const mutate of mutations) {
    const r = receipt();
    mutate(r);
    await assert.rejects(setup(r).api.recover(operation()));
  }
});
test("invalid allocation requests fail before transport without silently sorting or rounding", async () => {
  const { api, calls } = setup(receipt());
  for (const allocations of [
    [{ lot_id: id(3), quantity: "0.999" }],
    [
      { lot_id: id(3), quantity: "0.5" },
      { lot_id: id(3), quantity: "0.5" },
    ],
    [
      { lot_id: id(4), quantity: "0.5" },
      { lot_id: id(3), quantity: "0.5" },
    ],
    [{ lot_id: id(3), quantity: "1.0001" }],
  ])
    await assert.rejects(
      api.execute({
        ...operation(),
        payload: { ...operation().payload, allocations },
      }),
    );
  for (const quantity of ["1e0", "01", "0", "-1", "1.0001", "100000000000"])
    await assert.rejects(
      api.execute({
        ...operation(),
        payload: { ...operation().payload, quantity },
      }),
    );
  assert.equal(calls.length, 0);
});
test("money uses exact decimal arithmetic with half-up event rounding and bigint boundaries", () => {
  assert.equal(fulfillmentChargeCents("0.005", "100"), "1");
  assert.equal(fulfillmentChargeCents("0.004", "100"), "0");
  assert.equal(fulfillmentChargeCents("99999999999.999", "1"), "100000000000");
  assert.equal(
    fulfillmentChargeCents("90071992547.409", "100000000"),
    "9007199254740900000",
  );
  assert.throws(() => fulfillmentChargeCents("99999999999.999", "100000000"));
  assert.throws(() => fulfillmentChargeCents("1", "100000001"));
  assert.equal(
    fulfillmentMoneySchema.parse("9223372036854775807"),
    "9223372036854775807",
  );
  assert.throws(() => fulfillmentMoneySchema.parse("9223372036854775808"));
});
test("invoice total overflow and per-lot rounding cannot pass a preview", async () => {
  const c = dispenseContext();
  c.invoice.existing_items_total_cents = "9223372036854775807";
  c.charge.projected_invoice_total_cents = "9223372036854775807";
  await assert.rejects(
    setup({
      version: 1,
      actor_id: actor,
      context: c,
      context_hash: hash,
      observed_at: time,
    }).api.previewDispense(target()),
  );
  const c2 = dispenseContext();
  c2.charge.amount_cents = "99";
  await assert.rejects(
    setup({
      version: 1,
      actor_id: actor,
      context: c2,
      context_hash: hash,
      observed_at: time,
    }).api.previewDispense(target()),
  );
});
test("explicit slot close binds predecessor and records lost remainder without reopening allowance", async () => {
  const op = closeOperation(),
    r = {
      version: 1,
      id: op.id,
      actor_id: actor,
      operation: "close_slot",
      request: op.payload,
      request_hash: hash,
      result: closure(),
      created_at: time,
    };
  await setup(r).api.execute(op);
  for (const patch of [
    { remaining_quantity: "1.500" },
    { version: 3 },
    { opened_by: client },
    { dispensed_quantity: "2.000" },
  ])
    await assert.rejects(
      setup({
        ...r,
        result: { ...closure(), after: { ...closure().after, ...patch } },
      }).api.recover(op),
    );
  await assert.rejects(
    setup({
      ...r,
      result: { ...closure(), forfeited_quantity: "1.000" },
    }).api.recover(op),
  );
});
test("pickup records frozen dispense without another stock charge and rejects relinking", async () => {
  const op = pickupOperation(),
    r = {
      version: 1,
      id: op.id,
      actor_id: actor,
      operation: "pickup",
      request: op.payload,
      request_hash: hash,
      result: pickup(),
      created_at: time,
    };
  const { api, calls } = setup(r);
  await api.execute(op);
  assert.equal(calls[0].name, "record_native_pickup");
  assert.equal(calls.length, 1);
  for (const patch of [
    { dispense_id: id(9) },
    { recipient_name: "Changed name" },
    { refill_id: id(9), refill_event_id: id(10) },
  ])
    await assert.rejects(
      setup({ ...r, result: { ...pickup(), ...patch } }).api.recover(op),
    );
  await assert.rejects(
    setup({
      ...r,
      result: {
        ...pickup(),
        reviewed_context: {
          ...pickup().reviewed_context,
          existing_pickup_id: id(9),
        },
      },
    }).api.recover(op),
  );
});
test("fulfillment histories reject wrong targets, duplicate IDs, reversed cursors and silent truncation", async () => {
  const page = {
    version: 1,
    authorization_id: signed().id,
    pet_id: pet,
    dispenses: [dispense()],
    has_more: true,
    next_cursor: { before_at: time, before_id: id(1) },
  };
  await setup(page).api.history("dispenses", null, 1);
  for (const invalid of [
    { ...page, pet_id: client },
    { ...page, has_more: false },
    { ...page, next_cursor: null },
    { ...page, next_cursor: { before_at: time, before_id: id(2) } },
    { ...page, dispenses: [dispense(), dispense()] },
  ])
    await assert.rejects(setup(invalid).api.history("dispenses", null, 1));
  await assert.rejects(
    setup(page).api.history(
      "dispenses",
      { before_at: time, before_id: id(1) },
      1,
    ),
  );
  const slots = {
    version: 1,
    authorization_id: signed().id,
    pet_id: pet,
    slots: [slot()],
    has_more: false,
    next_index: null,
  };
  await setup(slots).api.slots();
  await assert.rejects(setup(slots).api.slots(0));
});
test("V1 unknown accounting stays exact; V2 requires explicit external unknown or balanced native allowance", async () => {
  const v1 = {
    version: 1,
    native_fill_accounting: "not_implemented",
    dispensed_quantity: null,
    used_fill_slots: null,
    remaining_quantity: null,
    external_fulfillment: "unknown",
  };
  assert.deepEqual(prescriptionUsageSchema.parse(v1), v1);
  assert.throws(() =>
    prescriptionUsageSchema.parse({ ...v1, remaining_quantity: "0.000" }),
  );
  const external = {
    ...initialUsage(),
    allowance_basis: "external_unknown",
    remaining_quantity: null,
    unopened_fill_slots: null,
  };
  assert.deepEqual(prescriptionUsageSchema.parse(external), external);
  assert.throws(() =>
    prescriptionUsageSchema.parse({ ...external, remaining_quantity: "0.000" }),
  );
  assert.throws(() =>
    prescriptionUsageSchema.parse({ ...external, unopened_fill_slots: 1 }),
  );
  assert.throws(() =>
    prescriptionUsageSchema.parse({
      ...external,
      open_slot: usedUsage().open_slot,
    }),
  );
  const current = {
    version: 1,
    authorization: head(),
    usage: usedUsage(),
    open_slot: slot(),
  };
  await setup(current).api.read();
  await assert.rejects(
    setup({
      ...current,
      usage: { ...usedUsage(), remaining_quantity: "2.000" },
    }).api.read(),
  );
  await assert.rejects(
    setup({ ...current, usage: external, open_slot: null }).api.read(),
  );
  const status = {
    version: 1,
    pet_id: pet,
    status: {
      authorization_id: signed().id,
      authorization_hash: hash,
      checked_at: time,
      state: "active",
      reason: null,
      replacement_id: null,
    },
    head_id: null,
    head_version: 0,
    usage: external,
  };
  const api = createPrescriptionApi(
    { rpc: async () => ({ data: status, error: null }) },
    actor,
    pet,
  );
  await assert.rejects(api.readStatus(signed() as never));
});
test("aggregate V2 balances accept large multi-slot sums without loosening individual slot precision", () => {
  assert.doesNotThrow(() =>
    prescriptionUsageSchema.parse({
      ...initialUsage(),
      unopened_fill_slots: 1001,
      remaining_quantity: "100099999999998.999",
    }),
  );
  assert.throws(() =>
    prescriptionUsageSchema.parse({
      ...initialUsage(),
      remaining_quantity: "1000000000000000.000",
    }),
  );
  assert.throws(() =>
    prescriptionUsageSchema.parse({
      ...usedUsage(),
      open_slot: {
        ...usedUsage().open_slot,
        remaining_quantity: "100000000000.000",
      },
    }),
  );
});
const refill = () => ({
  id: id(10),
  pet_id: pet,
  client_id: client,
  version: 2,
  state: "open",
  medication_requested: "Stock medication",
  requester_note: null,
  channel: "phone",
  assigned_to: null,
  authorization_id: signed().id,
  authorization_hash: hash,
  created_by: actor,
  created_at: time,
  updated_by: actor,
  updated_at: time,
});
const refillEvent = () => ({
  version: 2,
  id: id(11),
  refill_id: id(10),
  revision: 3,
  action: "dispense",
  actor_id: actor,
  reason: "Dispense reviewed",
  prior_event_id: id(12),
  before: refill(),
  after: { ...refill(), version: 3 },
  link_context: null,
  created_at: time,
  fulfillment_reference: {
    kind: "dispense",
    id: id(1),
    dispense_id: id(1),
    authorization_id: signed().id,
  },
});
test("V2 refill events bind fulfillment separately from event UUID and reject V1 pollution", () => {
  assert.doesNotThrow(() => parseNativeRefillEvent(refillEvent()));
  for (const invalid of [
    { ...refillEvent(), version: 1 },
    { ...refillEvent(), fulfillment_reference: null },
    { ...refillEvent(), action: "close" },
    {
      ...refillEvent(),
      fulfillment_reference: {
        ...refillEvent().fulfillment_reference,
        authorization_id: id(9),
      },
    },
    {
      ...refillEvent(),
      fulfillment_reference: {
        ...refillEvent().fulfillment_reference,
        dispense_id: id(9),
      },
    },
  ])
    assert.throws(() => parseNativeRefillEvent(invalid));
  assert.doesNotThrow(() =>
    parseNativeRefillEvent({
      ...refillEvent(),
      action: "pickup",
      after: { ...refill(), version: 3, state: "closed" },
      fulfillment_reference: {
        kind: "pickup",
        id: id(8),
        dispense_id: id(1),
        authorization_id: signed().id,
      },
    }),
  );
});
test("atomic optional refill update verifies event predecessor and exact original authorization", async () => {
  const r = receipt(),
    op = operation();
  const linked = { refill: refill(), head_id: id(12) },
    event = refillEvent();
  Object.assign(op.payload, { refill: { id: id(10), expected_version: 2 } });
  r.request = structuredClone(op.payload);
  Object.assign(r.result.dispense.reviewed_context.target, {
    refill: { id: id(10), expected_version: 2 },
  });
  Object.assign(r.result.dispense.reviewed_context, { refill: linked });
  Object.assign(r.result.dispense, {
    refill_id: id(10),
    refill_event_id: event.id,
  });
  Object.assign(r.result, { refill_event: event });
  await setup(r).api.execute(op);
  for (const patch of [
    { id: id(13) },
    { prior_event_id: id(13) },
    { reason: "Other reason" },
    {
      fulfillment_reference: {
        ...event.fulfillment_reference,
        id: id(13),
        dispense_id: id(13),
      },
    },
  ])
    await assert.rejects(
      setup({
        ...r,
        result: { ...r.result, refill_event: { ...event, ...patch } },
      }).api.recover(op),
    );
});
test("partial continuation preserves opening identity and automatically closes only at exact maximum", async () => {
  const op = operation(),
    r = receipt(),
    before = slot();
  op.payload.quantity = "1.5";
  op.payload.allocations[0].quantity = "1.5";
  Object.assign(op.payload, { expected_slot_version: 1 });
  r.request = structuredClone(op.payload);
  const c = r.result.dispense.reviewed_context;
  Object.assign(c, {
    slot: before,
    usage: usedUsage(),
    target: {
      ...target(),
      quantity: "1.5",
      allocations: [{ lot_id: id(3), quantity: "1.5" }],
      expected_slot_version: 1,
    },
  });
  c.lots[0].quantity = "1.500";
  c.charge = {
    quantity: "1.500",
    unit_price_cents: "100",
    amount_cents: "150",
    projected_invoice_total_cents: "150",
  };
  Object.assign(r.result.dispense, {
    quantity: "1.500",
    slot_version_before: 1,
    slot_version_after: 2,
    amount_cents: "150",
  });
  r.result.dispense.allocations[0].quantity = "1.500";
  r.result.dispense.artifact.quantity = "1.500";
  r.result.dispense.artifact.lots[0].quantity = "1.500";
  Object.assign(r.result.slot, {
    version: 2,
    dispensed_quantity: "2.500",
    remaining_quantity: "0.000",
    state: "closed",
    closure_kind: "filled",
    closed_by: actor,
    closed_at: time,
  });
  await setup(r).api.execute(op);
  await assert.rejects(
    setup({
      ...r,
      result: {
        ...r.result,
        slot: { ...r.result.slot, closure_kind: "forfeited" },
      },
    }).api.recover(op),
  );
});
test("closure preview and closed history retain exact slot identity even after authorization cancellation", async () => {
  const c = closure();
  Object.assign(c.reviewed_context.authorization, {
    state: "cancelled",
    head_id: id(15),
    head_version: 1,
  });
  await setup({
    version: 1,
    actor_id: actor,
    context: c.reviewed_context,
    context_hash: hash,
    observed_at: time,
  }).api.previewClose(0);
  await setup({
    version: 1,
    authorization_id: signed().id,
    pet_id: pet,
    closures: [c],
    has_more: false,
    next_cursor: null,
  }).api.history("closures");
  const p = pickup();
  Object.assign(p.reviewed_context.authorization, {
    state: "cancelled",
    head_id: id(15),
    head_version: 1,
  });
  await setup({
    version: 1,
    actor_id: actor,
    context: p.reviewed_context,
    context_hash: hash,
    observed_at: time,
  }).api.previewPickup(p.dispense_id);
  await setup({
    version: 1,
    authorization_id: signed().id,
    pet_id: pet,
    pickups: [p],
    has_more: false,
    next_cursor: null,
  }).api.history("pickups");
});
test("multi-lot fractional billing rounds once for the event, preserving immutable allocation order", async () => {
  const c = dispenseContext();
  c.target.quantity = "0.010";
  c.target.allocations = [
    { lot_id: id(3), quantity: "0.005" },
    { lot_id: id(4), quantity: "0.005" },
  ];
  c.lots = [
    { ...c.lots[0], quantity: "0.005" },
    { ...c.lots[0], id: id(4), lot_number: "LOT-2", quantity: "0.005" },
  ];
  c.charge = {
    quantity: "0.010",
    unit_price_cents: "100",
    amount_cents: "1",
    projected_invoice_total_cents: "1",
  };
  const p = {
    version: 1,
    actor_id: actor,
    context: c,
    context_hash: hash,
    observed_at: time,
  };
  await setup(p).api.previewDispense(c.target);
  await assert.rejects(
    setup({
      ...p,
      context: {
        ...c,
        charge: {
          ...c.charge,
          amount_cents: "2",
          projected_invoice_total_cents: "2",
        },
      },
    }).api.previewDispense(c.target),
  );
});
