import test from "node:test";
import assert from "node:assert/strict";
import {
  createNativeReconciliationApi,
  createNativeReturnDiscrepancyApi,
  reconciliationAttestations,
} from "../../src/hub/features/prescriptions/fulfillment-reconciliation-api.ts";
import { returnFixture } from "./return-fixture.ts";
import { replayNativeReturnQuantities } from "../../supabase/functions/_shared/native-return-quantity-replay.ts";
import type {
  ReconciliationRead,
  ReconciliationPreview,
  ReconciliationReceipt,
  ReconciliationIntent,
  ReturnDiscrepancyReceipt,
  ReturnDiscrepancyPreview,
} from "../../supabase/functions/_shared/native-return-reconciliation-contract.ts";
import type { PrescriptionOperation } from "../../src/hub/features/prescriptions/prescription-state.ts";
import type { PrescriptionRpc } from "../../src/hub/features/prescriptions/prescription-api.ts";
const id = (n: number) =>
    `f9160000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  hash = "a".repeat(64);
function fixture() {
  const f = returnFixture(),
    d = f.dispense_returns!,
    events = d.events,
    t = events[0].target,
    actor = events[0].actor.id;
  const replay = replayNativeReturnQuantities(
    d.allocations.map((a) => ({
      allocation_id: a.allocation_id,
      lot_id: a.lot_id,
      quantity: a.dispensed_quantity,
    })),
    events.map((e) => ({
      id: e.id,
      sequence: e.sequence,
      action: e.action,
      intake_id: e.intake_id,
      correction_target_id: null,
      allocations: e.allocations.map((a) => ({
        allocation_id: a.allocation_id,
        lot_id: a.lot_id,
        quantity: a.quantity,
      })),
    })),
  );
  const empty = {
    version: 1 as const,
    head: { version: 0, event_id: null, record_hash: null },
    open_case_count: 0,
    held_lot_ids: [],
    cases: [],
  };
  const read: ReconciliationRead = {
    version: 2,
    target: t,
    authorization_hash: events[0].authorization_hash,
    dispense_document_hash: events[0].dispense_document_hash,
    dispensed_at: f.dispense!.dispensed_at,
    head: d.head,
    allocations: d.allocations,
    replay,
    discrepancies: empty,
  };
  const source = events[1],
    intent: ReconciliationIntent = {
      target: t,
      action: "retract_disposal",
      intake_id: events[0].id,
      correction_target: {
        event_id: source.id,
        record_hash: source.record_hash,
      },
      discrepancy_id: null,
      allocations: [
        { allocation_id: d.allocations[0].allocation_id, quantity: "0.5" },
      ],
      custody: null,
      package_condition: null,
      storage_history: null,
      reason: "Original disposal did not occur",
      note: "Quantity remains physically held",
    };
  const preview: ReconciliationPreview = {
    version: 2,
    actor_id: actor,
    observed_at: "2026-09-16T14:00:00Z",
    context: {
      ...read,
      discrepancy_head: empty.head,
      original_pickup: null,
      correction_head: empty.head,
      intake: {
        ...replay.intakes[0],
        sequence: 1,
        custody: "clinic_retained",
        package_condition: "sealed_intact",
        storage_history: "controlled",
      },
      stock_review: null,
      policy: null,
      intent,
    },
    context_hash: hash,
    allowed: true,
    blockers: [],
  };
  const op: PrescriptionOperation = {
    id: id(1),
    kind: "record_return_v2",
    payload: {
      intent,
      expected_context_hash: hash,
      expected_head: read.head,
      expected_discrepancy_head: empty.head,
      attest_review: true,
      attest_restock: false,
      physical_attestations: reconciliationAttestations(intent.action),
    },
  };
  const receipt: ReconciliationReceipt = {
    version: 2,
    id: op.id,
    actor_id: actor,
    request: op.payload as unknown as ReconciliationReceipt["request"],
    request_hash: hash,
    created_at: preview.observed_at,
    result: {
      ...source,
      version: 2,
      id: op.id,
      sequence: 5,
      prior_event_id: read.head.event_id,
      prior_record_hash: read.head.record_hash,
      actor: { id: actor, name: "Synthetic DVM", authority: "active_dvm" },
      action: intent.action,
      intake_id: intent.intake_id,
      allocations: [{ ...source.allocations[0], quantity: "0.500" }],
      reason: intent.reason,
      note: intent.note,
      policy: null,
      correction_target: intent.correction_target,
      discrepancy_id: null,
      physical_attestations: reconciliationAttestations(intent.action),
      reviewed_context_hash: hash,
      created_at: preview.observed_at,
      record_hash: hash,
    },
  };
  return { f, events, t, actor, read, preview, op, receipt, intent };
}
function client(
  handler: (name: string, args: Record<string, unknown>) => unknown,
): PrescriptionRpc {
  return {
    rpc: async (name, args) => ({
      data: handler(name, args ?? {}),
      error: null,
    }),
  };
}
test("v2 closed read preserves mixed-history effective quantities and discrepancy state", async () => {
  const f = fixture();
  const api = createNativeReconciliationApi(
    client(() => f.read),
    f.actor,
    f.t,
  );
  assert.deepEqual(await api.read(), f.read);
  const bad = structuredClone(f.read);
  bad.allocations[0].held_quantity = "5.000";
  await assert.rejects(
    createNativeReconciliationApi(
      client(() => bad),
      f.actor,
      f.t,
    ).read(),
  );
});
test("correction preview binds target actor intent and both heads", async () => {
  const f = fixture();
  const api = createNativeReconciliationApi(
    client(() => f.preview),
    f.actor,
    f.t,
  );
  assert.deepEqual(await api.preview(f.intent), f.preview);
  for (const modify of [
    (p: ReconciliationPreview) => (p.actor_id = id(8)),
    (p: ReconciliationPreview) =>
      (p.context.intent.correction_target!.record_hash = "b".repeat(64)),
    (p: ReconciliationPreview) =>
      (p.context.discrepancy_head = {
        version: 1,
        event_id: id(4),
        record_hash: hash,
      }),
  ]) {
    const bad = structuredClone(f.preview);
    modify(bad);
    await assert.rejects(
      createNativeReconciliationApi(
        client(() => bad),
        f.actor,
        f.t,
      ).preview(f.intent),
    );
  }
});
test("source correction remainder and intake held cap reject excessive preview", async () => {
  const f = fixture();
  const bad = structuredClone(f.preview);
  bad.context.intent.allocations[0].quantity = "1.001";
  await assert.rejects(
    createNativeReconciliationApi(
      client(() => bad),
      f.actor,
      f.t,
    ).preview(bad.context.intent),
  );
});
test("correction commit and exact historical recovery bind immutable source and physical facts", async () => {
  const f = fixture();
  const calls: string[] = [];
  const api = createNativeReconciliationApi(
    client((name) => {
      calls.push(name);
      return name.startsWith("preview") ? f.preview : f.receipt;
    }),
    f.actor,
    f.t,
  );
  await api.preview(f.intent);
  assert.deepEqual(await api.execute(f.op), f.receipt);
  assert.deepEqual(await api.recover(f.op), f.receipt);
  assert.deepEqual(calls, [
    "preview_native_dispense_return_v2",
    "record_native_dispense_return_v2",
    "recover_native_dispense_return_v2",
  ]);
  for (const change of [
    (r: ReconciliationReceipt) => (r.actor_id = id(9)),
    (r: ReconciliationReceipt) =>
      (r.result.correction_target!.event_id = id(9)),
    (r: ReconciliationReceipt) =>
      (r.result.physical_attestations.was_not_destroyed = false),
    (r: ReconciliationReceipt) => (r.result.allocations[0].quantity = "0.501"),
  ]) {
    const bad = structuredClone(f.receipt);
    change(bad);
    await assert.rejects(
      createNativeReconciliationApi(
        client(() => bad),
        f.actor,
        f.t,
      ).recover(f.op),
    );
  }
});
test("wrong target and unsupported request properties never reach transport", async () => {
  const f = fixture();
  let calls = 0;
  const api = createNativeReconciliationApi(
    client(() => {
      calls++;
      return f.receipt;
    }),
    f.actor,
    f.t,
  );
  await assert.rejects(
    api.execute({ ...f.op, payload: { ...f.op.payload, extra: true } }),
  );
  await assert.rejects(
    api.execute({
      ...f.op,
      payload: {
        ...f.op.payload,
        intent: { ...f.intent, target: { ...f.t, pet_id: id(9) } },
      },
    }),
  );
  assert.equal(calls, 0);
});
test("absent recovery remains absent and provider errors propagate", async () => {
  const f = fixture();
  assert.equal(
    await createNativeReconciliationApi(
      client(() => null),
      f.actor,
      f.t,
    ).recover(f.op),
    null,
  );
  const error = { code: "40001", message: "Changed source" };
  await assert.rejects(
    createNativeReconciliationApi(
      { rpc: async () => ({ data: null, error }) },
      f.actor,
      f.t,
    ).execute(f.op),
    (e) => e === error,
  );
});
test("mixed history validates descending exact predecessor and pagination sentinel", async () => {
  const f = fixture();
  const p = {
    version: 2,
    target: f.t,
    head: f.read.head,
    discrepancy_head: f.read.discrepancies.head,
    events: [...f.events].reverse(),
    next_before_version: null,
  };
  assert.equal(
    (
      await createNativeReconciliationApi(
        client(() => p),
        f.actor,
        f.t,
      ).history()
    ).events.length,
    4,
  );
  const bad = structuredClone(p);
  bad.events[0].prior_event_id = id(99);
  await assert.rejects(
    createNativeReconciliationApi(
      client(() => bad),
      f.actor,
      f.t,
    ).history(),
  );
});
test("discrepancy report commit binds case identity exact quantities source and heads", async () => {
  const f = fixture(),
    source = f.events[2];
  const intent = {
    target: f.t,
    action: "report" as const,
    case_id: null,
    source: { event_id: source.id, record_hash: source.record_hash },
    allocations: [
      { allocation_id: source.allocations[0].allocation_id, quantity: "1" },
    ],
    observation: "Physical stock could not be located",
    correction_ids: [],
  };
  const preview: ReturnDiscrepancyPreview = {
    version: 1,
    actor_id: f.actor,
    observed_at: f.preview.observed_at,
    context: {
      version: 1,
      target: f.t,
      return_head: f.read.head,
      discrepancy_head: f.read.discrepancies.head,
      source,
      replay: f.read.replay,
      discrepancies: f.read.discrepancies,
      intent,
    },
    context_hash: hash,
    allowed: true,
    blockers: [],
  };
  const op: PrescriptionOperation = {
    id: id(50),
    kind: "record_return_discrepancy",
    payload: {
      intent,
      expected_context_hash: hash,
      expected_return_head: f.read.head,
      expected_discrepancy_head: f.read.discrepancies.head,
      attest_physical_review: true,
      attest_original_quantities_custody_and_stock_accurate: false,
    },
  };
  const receipt: ReturnDiscrepancyReceipt = {
    version: 1,
    id: op.id,
    actor_id: f.actor,
    request: op.payload as unknown as ReturnDiscrepancyReceipt["request"],
    request_hash: hash,
    created_at: preview.observed_at,
    result: {
      version: 1,
      id: op.id,
      target: f.t,
      sequence: 1,
      prior_event_id: null,
      prior_record_hash: null,
      actor: {
        id: f.actor,
        name: "Synthetic reviewer",
        authority: "active_staff",
      },
      action: "report",
      case_id: op.id,
      source: intent.source,
      allocations: [{ ...source.allocations[0], quantity: "1.000" }].map(
        ({ movement_id: _, ...a }) => a,
      ),
      observation: intent.observation,
      correction_ids: [],
      return_head: f.read.head,
      reviewed_context_hash: hash,
      created_at: preview.observed_at,
      record_hash: hash,
    },
  };
  const api = createNativeReturnDiscrepancyApi(
    client((n) => (n.startsWith("preview") ? preview : receipt)),
    f.actor,
    f.t,
  );
  assert.deepEqual(await api.preview(intent), preview);
  assert.deepEqual(await api.execute(op), receipt);
  const bad = structuredClone(receipt);
  bad.result.case_id = id(99);
  await assert.rejects(
    createNativeReturnDiscrepancyApi(
      client(() => bad),
      f.actor,
      f.t,
    ).recover(op),
  );
});

test("every correction uses its own exact physical attestation flags", async () => {
  const f = fixture();
  for (const action of [
    "retract_intake",
    "retract_disposal",
    "retract_restock",
  ] as const) {
    const flags = reconciliationAttestations(action);
    assert.equal(flags.intake_claim_incorrect, action === "retract_intake");
    assert.equal(flags.was_not_destroyed, action === "retract_disposal");
    assert.equal(
      flags.removed_from_available_stock,
      action === "retract_restock",
    );
    let calls = 0;
    const api = createNativeReconciliationApi(
      client(() => {
        calls++;
        return null;
      }),
      f.actor,
      f.t,
    );
    await assert.rejects(
      api.execute({
        ...f.op,
        payload: {
          ...f.op.payload,
          intent: { ...f.intent, action },
          physical_attestations: { ...flags, reviewed_physical_facts: false },
        },
      }),
    );
    assert.equal(calls, 0);
  }
});

test("preview cannot substitute larger intake balances than effective replay", async () => {
  const f = fixture(),
    bad = structuredClone(f.preview);
  bad.context.intake!.allocations[0].quantity = "6.000";
  bad.context.intake!.allocations[0].held_quantity = "2.000";
  await assert.rejects(
    createNativeReconciliationApi(
      client(() => bad),
      f.actor,
      f.t,
    ).preview(f.intent),
  );
});

test("current read rejects fabricated open-case counts and held lots", async () => {
  const f = fixture();
  for (const change of [
    (r: ReconciliationRead) => {
      r.discrepancies.open_case_count = 1;
    },
    (r: ReconciliationRead) => {
      r.discrepancies.held_lot_ids = [r.allocations[0].lot_id];
    },
  ]) {
    const bad = structuredClone(f.read);
    change(bad);
    await assert.rejects(
      createNativeReconciliationApi(
        client(() => bad),
        f.actor,
        f.t,
      ).read(),
    );
  }
});
