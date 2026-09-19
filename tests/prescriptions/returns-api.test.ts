import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createNativeReturnsApi,
  createNativeReturnPolicyApi,
  returnIntentSchema,
} from "../../src/hub/features/prescriptions/fulfillment-returns-api.ts";
const id = (n: number) =>
    `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  hash = "a".repeat(64),
  actor = id(1),
  time = "2026-09-16T12:00:00.123456Z",
  target = { authorization_id: id(2), pet_id: id(3), dispense_id: id(4) },
  head = { event_id: null, version: 0, record_hash: null };
function fixture() {
  const intent = {
    target,
    action: "intake" as const,
    intake_id: null,
    allocations: [{ allocation_id: id(5), quantity: "1.25" }],
    custody: "unknown" as const,
    package_condition: "unknown" as const,
    storage_history: "unknown" as const,
    reason: "Synthetic receipt",
    note: "Client-shareable custody facts",
  };
  const balance = {
    allocation_id: id(5),
    lot_id: id(6),
    lot_number: "LOT",
    expires_on: "2027-01-01",
    dispensed_quantity: "2.000",
    returned_quantity: "0.000",
    remaining_returnable_quantity: "2.000",
    held_quantity: "0.000",
    disposed_quantity: "0.000",
    restocked_quantity: "0.000",
  };
  const context = {
    version: 1,
    target,
    authorization_hash: hash,
    dispense_document_hash: hash,
    dispensed_at: time,
    head,
    original_pickup: null,
    correction_head: head,
    allocations: [balance],
    intake: null,
    stock_review: null,
    policy: null,
    intent,
  };
  const request = {
      intent,
      expected_context_hash: hash,
      expected_head: head,
      attest_review: true as const,
      attest_restock: false,
    },
    op = { id: id(7), kind: "record_return", payload: request };
  const event = {
    version: 1,
    id: op.id,
    target,
    authorization_hash: hash,
    dispense_document_hash: hash,
    sequence: 1,
    prior_event_id: null,
    prior_record_hash: null,
    actor: { id: actor, name: "Staff", authority: "active_staff" },
    action: intent.action,
    intake_id: null,
    allocations: [
      {
        allocation_id: id(5),
        lot_id: id(6),
        quantity: "1.250",
        movement_id: null,
      },
    ],
    custody: intent.custody,
    package_condition: intent.package_condition,
    storage_history: intent.storage_history,
    reason: intent.reason,
    note: intent.note,
    policy: null,
    reviewed_context_hash: hash,
    created_at: time,
    record_hash: hash,
  };
  const receipt = {
    version: 1,
    id: op.id,
    actor_id: actor,
    request,
    request_hash: hash,
    result: event,
    created_at: time,
  };
  let response: unknown = receipt;
  const calls: Record<string, unknown>[] = [];
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return { data: response, error: null };
    },
  };
  return {
    intent,
    balance,
    context,
    request,
    op,
    event,
    receipt,
    client,
    calls,
    api: createNativeReturnsApi(client, actor, target),
    set: (v: unknown) => {
      response = v;
    },
  };
}
test("native return preserves exact input decimals and canonical receipt through recovery", async () => {
  const f = fixture();
  assert.deepEqual(await f.api.execute(f.op), f.receipt);
  assert.deepEqual(await f.api.recover(f.op), f.receipt);
  assert.equal(f.receipt.request.intent.allocations[0].quantity, "1.25");
});
test("immutable target, actor, amount and head substitutions are rejected", async () => {
  for (const mutate of [
    (r: ReturnType<typeof fixture>["receipt"]) => {
      r.result.allocations[0].quantity = "1.251";
    },
    (r: ReturnType<typeof fixture>["receipt"]) => {
      r.result.target.pet_id = id(8);
    },
    (r: ReturnType<typeof fixture>["receipt"]) => {
      r.actor_id = id(8);
    },
    (r: ReturnType<typeof fixture>["receipt"]) => {
      r.result.sequence = 2;
    },
  ]) {
    const f = fixture(),
      bad = structuredClone(f.receipt);
    mutate(bad);
    f.set(bad);
    await assert.rejects(f.api.recover(f.op));
  }
});
test("read balances enforce exact conservation, independent of partial history", async () => {
  const f = fixture(),
    read = {
      version: 1,
      target,
      authorization_hash: hash,
      dispense_document_hash: hash,
      dispensed_at: time,
      head,
      allocations: [f.balance],
    };
  f.set(read);
  assert.deepEqual(await f.api.read(), read);
  f.set({ ...read, allocations: [{ ...f.balance, held_quantity: "1.000" }] });
  await assert.rejects(f.api.read());
});
test("intent cannot duplicate origins, invent disposition custody or use noncanonical UUID", () => {
  const f = fixture();
  assert.throws(() =>
    returnIntentSchema.parse({
      ...f.intent,
      allocations: [...f.intent.allocations, ...f.intent.allocations],
    }),
  );
  assert.throws(() =>
    returnIntentSchema.parse({
      ...f.intent,
      action: "dispose",
      intake_id: id(9),
    }),
  );
  assert.throws(() =>
    returnIntentSchema.parse({
      ...f.intent,
      target: { ...target, pet_id: "A0000000-0000-4000-8000-000000000001" },
    }),
  );
});
test("preview checks remaining intake bound and original lot binding in receipt", async () => {
  const f = fixture();
  const preview = {
    version: 1,
    actor_id: actor,
    observed_at: time,
    context: f.context,
    context_hash: hash,
    allowed: true,
    blockers: [],
  };
  f.set(preview);
  await f.api.preview(f.intent);
  f.set({
    ...f.receipt,
    result: {
      ...f.event,
      allocations: [{ ...f.event.allocations[0], lot_id: id(90) }],
    },
  });
  await assert.rejects(f.api.execute(f.op));
  f.set({
    ...preview,
    context: {
      ...f.context,
      allocations: [
        {
          ...f.balance,
          dispensed_quantity: "1.000",
          remaining_returnable_quantity: "1.000",
        },
      ],
    },
  });
  await assert.rejects(f.api.preview(f.intent));
});
test("history cannot omit current head or claim an incomplete chain complete", async () => {
  const f = fixture(),
    page = {
      version: 1,
      target,
      head: { version: 1, event_id: f.event.id, record_hash: hash },
      events: [f.event],
      next_before_version: null,
    };
  f.set(page);
  assert.deepEqual(await f.api.history(), page);
  f.set({ ...page, events: [] });
  await assert.rejects(f.api.history());
});
test("policy default is honest and decision recovery binds actor revision and review", async () => {
  const f = fixture(),
    api = createNativeReturnPolicyApi(f.client, actor),
    empty = {
      version: 0,
      enabled: false,
      review_reference: null,
      actor_id: null,
      actor_name: null,
      reviewed_at: null,
      record_hash: null,
    };
  f.set(empty);
  assert.deepEqual(await api.read(), empty);
  f.set({ ...empty, enabled: true });
  await assert.rejects(api.read());
  const request = {
      expected_version: 0,
      enabled: true,
      review_reference: "Synthetic review only",
      attest_review: true,
    },
    op = { id: id(10), kind: "configure_return_policy", payload: request };
  const receipt = {
    version: 1,
    id: op.id,
    actor_id: actor,
    request,
    request_hash: hash,
    result: {
      version: 1,
      enabled: true,
      review_reference: request.review_reference,
      actor_id: actor,
      actor_name: "DVM admin",
      reviewed_at: time,
      record_hash: hash,
    },
    created_at: time,
  };
  f.set(receipt);
  assert.deepEqual(await api.execute(op), receipt);
  f.set({ ...receipt, result: { ...receipt.result, version: 2 } });
  await assert.rejects(api.recover(op));
});
test("restock cannot disguise movement or DVM absence as intake", async () => {
  const f = fixture();
  f.set({
    ...f.receipt,
    result: {
      ...f.event,
      allocations: [{ ...f.event.allocations[0], movement_id: id(90) }],
    },
  });
  await assert.rejects(f.api.execute(f.op));
});
test("exact intake read rejects another target and future intake sequence", async () => {
  const f = fixture(),
    intake = {
      id: id(20),
      sequence: 1,
      custody: "unknown",
      package_condition: "unknown",
      storage_history: "unknown",
      allocations: [
        {
          allocation_id: id(5),
          lot_id: id(6),
          quantity: "1.000",
          held_quantity: "1.000",
          disposed_quantity: "0.000",
          restocked_quantity: "0.000",
        },
      ],
    };
  f.set({
    version: 1,
    target,
    head: { version: 1, event_id: id(20), record_hash: hash },
    intake,
  });
  assert.equal(
    (await f.api.readIntake(id(20)))?.intake.allocations[0].held_quantity,
    "1.000",
  );
  f.set({
    version: 1,
    target: { ...target, pet_id: id(90) },
    head: { version: 1, event_id: id(20), record_hash: hash },
    intake,
  });
  await assert.rejects(f.api.readIntake(id(20)));
  f.set({version:1,target,head,intake});
  await assert.rejects(f.api.readIntake(id(20)));
});
