import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createNativeDispenseFinanceApi,
  financeDollarsToCents,
  formatFinanceCents,
  type FinanceSnapshot,
} from "../../src/hub/features/prescriptions/dispense-finance-api.ts";
import {
  persistFinanceIntent,
  loadFinanceIntent,
  clearFinanceIntent,
  restoredFinanceState,
  financeIntentKey,
} from "../../src/hub/features/prescriptions/dispense-finance-state.ts";
const id = (n: number) =>
    `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  actor = id(1),
  target = { authorization_id: id(2), pet_id: id(3), dispense_id: id(4) },
  hash = "a".repeat(64),
  stamp = "2026-09-16T12:00:00.000001Z";
function snapshot(): FinanceSnapshot {
  return {
    target,
    authorization_hash: hash,
    dispense_document_hash: hash,
    invoice: {
      id: id(5),
      client_id: id(6),
      item_id: id(7),
      version: 1,
      status: "issued",
      currency: "usd",
      total_cents: "1000",
      item_amount_cents: "1000",
    },
    source_heads: {
      correction: { event_id: null, version: 0, record_hash: null },
      returns: { event_id: null, version: 0, record_hash: null },
      discrepancy: { event_id: null, version: 0, record_hash: null },
    },
    clinical_context_hash: hash,
    financial_context_hash: hash,
    credits: [],
    payments: [{ id: id(8), amount_cents: "1000", remaining_cents: "1000" }],
    refunds: [],
    balance: {
      obligation_cents: "1000",
      paid_cents: "1000",
      refunded_cents: "0",
      net_cash_cents: "1000",
      outstanding_cents: "0",
      pending_refund_cents: "0",
      refundable_cents: "0",
    },
    capacity: {
      linked_credit_cents: "0",
      unallocated_credit_cents: "0",
      item_credit_capacity_cents: "1000",
      invoice_credit_capacity_cents: "1000",
      credit_capacity_cents: "1000",
    },
    blockers: [],
  };
}
const intent = {
  target,
  action: "credit" as const,
  amount_cents: "250",
  reason: "Duplicate charge",
  credit_id: null,
  payment_id: null,
};
const operation = {
  id: id(9),
  kind: "record_native_dispense_finance",
  payload: { intent, expected_context_hash: hash, attest_review: true },
};
const context = () => ({
  snapshot: snapshot(),
  intent,
  eligible_amount_cents: "1000",
});
function receipt() {
  return {
    version: 1,
    id: operation.id,
    actor_id: actor,
    request: operation.payload,
    request_hash: hash,
    created_at: stamp,
    result: {
      id: operation.id,
      target,
      action: "credit",
      actor_id: actor,
      created_at: stamp,
      invoice_id: id(5),
      invoice_item_id: id(7),
      credit_id: operation.id,
      refund_request_id: null,
      payment_id: null,
      amount_cents: "250",
      currency: "usd",
      reason: intent.reason,
      reviewed_context: context(),
      reviewed_context_hash: hash,
      record_hash: hash,
    },
  };
}
const api = (value: unknown) =>
  createNativeDispenseFinanceApi(
    { rpc: async () => ({ data: value, error: null }) },
    actor,
    target,
  );
test("integer cents preserve bigint precision without number conversion", () => {
  assert.equal(financeDollarsToCents("90071992547409.93"), "9007199254740993");
  assert.equal(
    formatFinanceCents("9007199254740993"),
    "$90,071,992,547,409.93",
  );
  for (const x of ["1e2", "-1", "0", "1.001", "01"])
    assert.throws(() => financeDollarsToCents(x));
});
test("valid exact creator receipt and historical recovery are accepted", async () => {
  assert.deepEqual(await api(receipt()).execute(operation), receipt());
  assert.deepEqual(await api(receipt()).recover(operation), receipt());
  assert.equal(await api(null).recover(operation), null);
});
test("receipt rejects foreign actor, target, amount and extra fields", async () => {
  for (const mutate of [
    (r: ReturnType<typeof receipt>) => {
      r.actor_id = id(20);
    },
    (r: ReturnType<typeof receipt>) => {
      r.result.target = { ...target, dispense_id: id(20) };
    },
    (r: ReturnType<typeof receipt>) => {
      r.result.amount_cents = "251";
    },
    (r: ReturnType<typeof receipt>) => {
      Object.assign(r, { extra: true });
    },
  ]) {
    const r = receipt();
    mutate(r);
    await assert.rejects(api(r).execute(operation));
  }
});
test("preview rejects incorrect capacities and blocked-success claims", async () => {
  const p = {
    version: 1,
    actor_id: actor,
    observed_at: stamp,
    context: context(),
    context_hash: hash,
    allowed: true,
    blockers: [],
  };
  assert.deepEqual(await api(p).preview(intent), p);
  p.context.snapshot.capacity.credit_capacity_cents = "999";
  await assert.rejects(api(p).preview(intent));
  p.context = context();
  p.context.eligible_amount_cents = "0";
  await assert.rejects(api(p).preview(intent));
});
test("read binds current rows and rejects missing operation history", async () => {
  const s = snapshot();
  await api({ version: 1, actor_id: actor, snapshot: s, results: [] }).read();
  s.credits = [
    {
      id: operation.id,
      amount_cents: "250",
      reason: intent.reason,
      actor_id: actor,
      created_at: stamp,
      dispense_id: target.dispense_id,
    },
  ];
  s.capacity = {
    linked_credit_cents: "250",
    unallocated_credit_cents: "0",
    item_credit_capacity_cents: "750",
    invoice_credit_capacity_cents: "750",
    credit_capacity_cents: "750",
  };
  s.balance!.obligation_cents = "750";
  s.balance!.refundable_cents = "250";
  await assert.rejects(
    api({ version: 1, actor_id: actor, snapshot: s, results: [] }).read(),
  );
  await api({
    version: 1,
    actor_id: actor,
    snapshot: s,
    results: [receipt().result],
  }).read();
});
test("persisted intent survives reload as uncertain and cannot be replaced", () => {
  const m = new Map<string, string>(),
    storage = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => {
        m.set(k, v);
      },
      removeItem: (k: string) => {
        m.delete(k);
      },
    },
    parse = api(null).parseOperation;
  persistFinanceIntent(storage, actor, target, operation, parse);
  const saved = loadFinanceIntent(storage, actor, target, parse);
  assert.equal(restoredFinanceState(actor, target, saved).phase, "uncertain");
  assert.throws(() =>
    persistFinanceIntent(
      storage,
      actor,
      target,
      { ...operation, id: id(99) },
      parse,
    ),
  );
  assert.equal(loadFinanceIntent(storage, id(99), target, parse), null);
  clearFinanceIntent(storage, actor, target, operation, parse);
  assert.equal(loadFinanceIntent(storage, actor, target, parse), null);
  storage.setItem(financeIntentKey(actor, target), "{}");
  assert.throws(() => loadFinanceIntent(storage, actor, target, parse));
});
test("storage failure prevents a durable operation reservation", () => {
  const parse = api(null).parseOperation;
  assert.throws(() =>
    persistFinanceIntent(
      {
        getItem: () => null,
        setItem: () => {
          throw new Error("quota");
        },
        removeItem: () => {},
      },
      actor,
      target,
      operation,
      parse,
    ),
  );
  assert.throws(() =>
    persistFinanceIntent(
      { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      actor,
      target,
      operation,
      parse,
    ),
  );
});
test("generic historical reasons remain readable byte-for-byte", async () => {
  const s = snapshot();
  s.credits = [
    {
      id: id(40),
      amount_cents: "100",
      reason: "  Adjustment  ",
      actor_id: actor,
      created_at: stamp,
      dispense_id: null,
    },
  ];
  s.capacity = {
    linked_credit_cents: "0",
    unallocated_credit_cents: "100",
    item_credit_capacity_cents: "900",
    invoice_credit_capacity_cents: "900",
    credit_capacity_cents: "900",
  };
  s.balance!.obligation_cents = "900";
  s.balance!.refundable_cents = "100";
  const read = await api({
    version: 1,
    actor_id: actor,
    snapshot: s,
    results: [],
  }).read();
  assert.equal(read.snapshot.credits[0].reason, "  Adjustment  ");
  s.credits[0].reason = "\t";
  await api({ version: 1, actor_id: actor, snapshot: s, results: [] }).read();
});
test("late reconciliation may over-reserve a credit and payment, yielding zero eligibility", async () => {
  const s = snapshot();
  s.credits = [
    {
      id: id(40),
      amount_cents: "100",
      reason: "credit",
      actor_id: actor,
      created_at: stamp,
      dispense_id: target.dispense_id,
    },
  ];
  s.capacity = {
    linked_credit_cents: "100",
    unallocated_credit_cents: "0",
    item_credit_capacity_cents: "900",
    invoice_credit_capacity_cents: "900",
    credit_capacity_cents: "900",
  };
  s.payments = [{ id: id(8), amount_cents: "100", remaining_cents: "0" }];
  s.refunds = [41, 42].map((n) => ({
    id: id(n),
    payment_id: id(8),
    amount_cents: "100",
    reason: "refund",
    actor_id: actor,
    created_at: stamp,
    state: n === 41 ? "reconciliation" : "pending",
    settled: false,
    credit_id: id(40),
    dispense_id: target.dispense_id,
  })) as FinanceSnapshot["refunds"];
  s.blockers = ["payment_reconciliation"];
  s.balance = {
    obligation_cents: "900",
    paid_cents: "100",
    refunded_cents: "0",
    net_cash_cents: "100",
    outstanding_cents: "800",
    pending_refund_cents: "200",
    refundable_cents: "0",
  };
  const i = {
      ...intent,
      action: "refund",
      amount_cents: "1",
      credit_id: id(40),
      payment_id: id(8),
    },
    p = {
      version: 1,
      actor_id: actor,
      observed_at: stamp,
      context: { snapshot: s, intent: i, eligible_amount_cents: "0" },
      context_hash: hash,
      allowed: false,
      blockers: ["payment_reconciliation", "refund_capacity_exceeded"],
    };
  assert.equal((await api(p).preview(i)).allowed, false);
});
test("refund eligibility uses exact linked credit, captured payment and pending reservations", async () => {
  const s = snapshot();
  s.credits = [
    {
      id: id(40),
      amount_cents: "250",
      reason: "credit",
      actor_id: actor,
      created_at: stamp,
      dispense_id: target.dispense_id,
    },
  ];
  s.capacity = {
    linked_credit_cents: "250",
    unallocated_credit_cents: "0",
    item_credit_capacity_cents: "750",
    invoice_credit_capacity_cents: "750",
    credit_capacity_cents: "750",
  };
  s.balance!.obligation_cents = "750";
  s.balance!.refundable_cents = "250";
  const i = {
      ...intent,
      action: "refund",
      credit_id: id(40),
      payment_id: id(8),
    },
    p = {
      version: 1,
      actor_id: actor,
      observed_at: stamp,
      context: { snapshot: s, intent: i, eligible_amount_cents: "250" },
      context_hash: hash,
      allowed: true,
      blockers: [],
    };
  await api(p).preview(i);
  p.context.intent.credit_id = id(99);
  await assert.rejects(api(p).preview(p.context.intent));
});

test("uniqueness rejection releases first attempt but never replaces an earlier uncertain request", async () => {
  const { financeOperationFailed } = await import(
    "../../src/hub/features/prescriptions/dispense-finance-state.ts"
  );
  const {
    emptyPrescriptionOperation,
    reviewPrescriptionOperation,
    commitPrescriptionOperation,
  } = await import(
    "../../src/hub/features/prescriptions/prescription-state.ts"
  );
  const pending = commitPrescriptionOperation(
    reviewPrescriptionOperation(
      emptyPrescriptionOperation(actor, target.pet_id),
      operation,
    ),
  );
  const reply = { actor, patientId: target.pet_id, operationId: operation.id };
  assert.equal(
    financeOperationFailed(pending, reply, { code: "23505" }).phase,
    "editing",
  );
  assert.equal(
    financeOperationFailed({ ...pending, priorUncertainty: true }, reply, {
      code: "23505",
    }).phase,
    "uncertain",
  );
});
