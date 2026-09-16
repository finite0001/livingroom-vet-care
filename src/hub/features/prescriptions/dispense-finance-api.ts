/** Closed native finance transport. PostgreSQL verifies canonical hashes and ledger links. */
import { z } from "zod";
import type { PrescriptionRpc } from "./prescription-api.ts";
import type { PrescriptionOperation } from "./prescription-state.ts";
import { correctionEqual } from "./fulfillment-corrections-api.ts";
import type { DispenseFinanceTarget } from "./dispense-finance-state.ts";
export type { DispenseFinanceTarget } from "./dispense-finance-state.ts";
export interface FinanceIntent {
  target: DispenseFinanceTarget;
  action: "credit" | "refund";
  amount_cents: string;
  reason: string;
  credit_id: string | null;
  payment_id: string | null;
}
export interface FinanceRequest {
  intent: FinanceIntent;
  expected_context_hash: string;
  attest_review: true;
}
export interface FinanceHead {
  event_id: string | null;
  version: number;
  record_hash: string | null;
}
export interface FinanceCredit {
  id: string;
  amount_cents: string;
  reason: string;
  actor_id: string;
  created_at: string;
  dispense_id: string | null;
}
export interface FinancePayment {
  id: string;
  amount_cents: string;
  remaining_cents: string;
}
export interface FinanceRefund {
  id: string;
  payment_id: string;
  amount_cents: string;
  reason: string;
  actor_id: string;
  created_at: string;
  state: "pending" | "failed" | "succeeded" | "reconciliation";
  settled: boolean;
  credit_id: string | null;
  dispense_id: string | null;
}
export interface FinanceBalance {
  obligation_cents: string;
  paid_cents: string;
  refunded_cents: string;
  net_cash_cents: string;
  outstanding_cents: string;
  pending_refund_cents: string;
  refundable_cents: string;
}
export interface FinanceSnapshot {
  target: DispenseFinanceTarget;
  authorization_hash: string;
  dispense_document_hash: string;
  invoice: {
    id: string;
    client_id: string;
    item_id: string;
    version: number;
    status: "draft" | "issued" | "void";
    currency: "usd";
    total_cents: string | null;
    item_amount_cents: string;
  };
  source_heads: {
    correction: FinanceHead;
    returns: FinanceHead;
    discrepancy: FinanceHead;
  };
  clinical_context_hash: string;
  financial_context_hash: string;
  credits: FinanceCredit[];
  payments: FinancePayment[];
  refunds: FinanceRefund[];
  balance: FinanceBalance | null;
  capacity: {
    linked_credit_cents: string;
    unallocated_credit_cents: string;
    item_credit_capacity_cents: string;
    invoice_credit_capacity_cents: string;
    credit_capacity_cents: string;
  };
  blockers: string[];
}
export interface FinanceContext {
  snapshot: FinanceSnapshot;
  intent: FinanceIntent;
  eligible_amount_cents: string;
}
export interface FinancePreview {
  version: 1;
  actor_id: string;
  observed_at: string;
  context: FinanceContext;
  context_hash: string;
  allowed: boolean;
  blockers: string[];
}
export interface FinanceResult {
  id: string;
  target: DispenseFinanceTarget;
  action: "credit" | "refund";
  actor_id: string;
  created_at: string;
  invoice_id: string;
  invoice_item_id: string;
  credit_id: string;
  refund_request_id: string | null;
  payment_id: string | null;
  amount_cents: string;
  currency: "usd";
  reason: string;
  reviewed_context: FinanceContext;
  reviewed_context_hash: string;
  record_hash: string;
}
export interface FinanceReceipt {
  version: 1;
  id: string;
  actor_id: string;
  request: FinanceRequest;
  request_hash: string;
  result: FinanceResult;
  created_at: string;
}
export interface FinanceRead {
  version: 1;
  actor_id: string;
  snapshot: FinanceSnapshot;
  results: FinanceResult[];
}
export interface FinanceClosure {
  version: 1;
  id: string;
  actor_id: string;
  request: FinanceRequest;
  request_hash: string;
  closed_at: string;
  record_hash: string;
}
export interface FinanceRecordedResolution {
  version: 1;
  status: "recorded";
  receipt: FinanceReceipt;
}
export interface FinanceClosedResolution {
  version: 1;
  status: "closed_unrecorded";
  closure: FinanceClosure;
}
export type FinanceCloseResult = FinanceRecordedResolution | FinanceClosedResolution;
const uuid = z
    .string()
    .uuid()
    .refine((v) => v === v.toLowerCase()),
  hash = z.string().regex(/^[a-f0-9]{64}$/),
  version = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const cents = z
    .string()
    .regex(/^(?:0|[1-9]\d*)$/)
    .refine((v) => BigInt(v) <= 9223372036854775807n),
  positiveCents = cents.refine((v) => BigInt(v) > 0n);
const reason = z
  .string()
  .refine(
    (v) => v.length > 0 && v === v.trim() && Array.from(v).length <= 2000,
  );
const timestamp = z
  .string()
  .datetime({ offset: true })
  .refine((v) => Number.isFinite(Date.parse(v)) && !/\.\d{7}/.test(v));
const target = z
  .object({ authorization_id: uuid, pet_id: uuid, dispense_id: uuid })
  .strict();
const head = z
  .object({ event_id: uuid.nullable(), version, record_hash: hash.nullable() })
  .strict()
  .refine((h) =>
    h.version === 0
      ? h.event_id === null && h.record_hash === null
      : h.event_id !== null && h.record_hash !== null,
  );
export const financeIntentSchema = z
  .object({
    target,
    action: z.enum(["credit", "refund"]),
    amount_cents: positiveCents,
    reason,
    credit_id: uuid.nullable(),
    payment_id: uuid.nullable(),
  })
  .strict()
  .refine((i) =>
    i.action === "credit"
      ? i.credit_id === null && i.payment_id === null
      : i.credit_id !== null &&
        i.payment_id !== null &&
        BigInt(i.amount_cents) <= 99999999n,
  );
const request = z
  .object({
    intent: financeIntentSchema,
    expected_context_hash: hash,
    attest_review: z.literal(true),
  })
  .strict();
const ledgerReason = z.string().refine((v) => {
  const trimmed = v.replace(/^ +| +$/g, "");
  return Array.from(trimmed).length >= 1 && Array.from(trimmed).length <= 2000;
});
const credit = z
  .object({
    id: uuid,
    amount_cents: positiveCents,
    reason: ledgerReason,
    actor_id: uuid,
    created_at: timestamp,
    dispense_id: uuid.nullable(),
  })
  .strict();
const payment = z
  .object({ id: uuid, amount_cents: positiveCents, remaining_cents: cents })
  .strict();
const refund = z
  .object({
    id: uuid,
    payment_id: uuid,
    amount_cents: positiveCents,
    reason: ledgerReason,
    actor_id: uuid,
    created_at: timestamp,
    state: z.enum(["pending", "failed", "succeeded", "reconciliation"]),
    settled: z.boolean(),
    credit_id: uuid.nullable(),
    dispense_id: uuid.nullable(),
  })
  .strict()
  .refine((r) => (r.credit_id === null) === (r.dispense_id === null));
const balance = z
  .object({
    obligation_cents: cents,
    paid_cents: cents,
    refunded_cents: cents,
    net_cash_cents: cents,
    outstanding_cents: cents,
    pending_refund_cents: cents,
    refundable_cents: cents,
  })
  .strict();
const baseBlocker = z.enum([
    "invoice_not_issued",
    "checkout_unresolved",
    "payment_reconciliation",
  ]),
  allBlocker = z.enum([
    "invoice_not_issued",
    "checkout_unresolved",
    "payment_reconciliation",
    "credit_capacity_exceeded",
    "refund_capacity_exceeded",
  ]);
const sorted = (v: string[]) => v.every((id, i) => i === 0 || v[i - 1] < id);
const snapshot = z
  .object({
    target,
    authorization_hash: hash,
    dispense_document_hash: hash,
    invoice: z
      .object({
        id: uuid,
        client_id: uuid,
        item_id: uuid,
        version: version.refine((v) => v > 0),
        status: z.enum(["draft", "issued", "void"]),
        currency: z.literal("usd"),
        total_cents: cents.nullable(),
        item_amount_cents: cents,
      })
      .strict(),
    source_heads: z
      .object({ correction: head, returns: head, discrepancy: head })
      .strict(),
    clinical_context_hash: hash,
    financial_context_hash: hash,
    credits: z.array(credit),
    payments: z.array(payment),
    refunds: z.array(refund),
    balance: balance.nullable(),
    capacity: z
      .object({
        linked_credit_cents: cents,
        unallocated_credit_cents: cents,
        item_credit_capacity_cents: cents,
        invoice_credit_capacity_cents: cents,
        credit_capacity_cents: cents,
      })
      .strict(),
    blockers: z.array(baseBlocker).refine(sorted),
  })
  .strict();
const context = z
  .object({
    snapshot,
    intent: financeIntentSchema,
    eligible_amount_cents: cents,
  })
  .strict();
const preview = z
  .object({
    version: z.literal(1),
    actor_id: uuid,
    observed_at: timestamp,
    context,
    context_hash: hash,
    allowed: z.boolean(),
    blockers: z.array(allBlocker).refine(sorted),
  })
  .strict();
const result = z
  .object({
    id: uuid,
    target,
    action: z.enum(["credit", "refund"]),
    actor_id: uuid,
    created_at: timestamp,
    invoice_id: uuid,
    invoice_item_id: uuid,
    credit_id: uuid,
    refund_request_id: uuid.nullable(),
    payment_id: uuid.nullable(),
    amount_cents: positiveCents,
    currency: z.literal("usd"),
    reason,
    reviewed_context: context,
    reviewed_context_hash: hash,
    record_hash: hash,
  })
  .strict();
const receipt = z
  .object({
    version: z.literal(1),
    id: uuid,
    actor_id: uuid,
    request,
    request_hash: hash,
    result,
    created_at: timestamp,
  })
  .strict();
const closure = z.object({
  version: z.literal(1),
  id: uuid,
  actor_id: uuid,
  request,
  request_hash: hash,
  closed_at: timestamp,
  record_hash: hash,
}).strict();
const resolution = z.discriminatedUnion("status", [
  z.object({ version: z.literal(1), status: z.literal("recorded"), receipt }).strict(),
  z.object({ version: z.literal(1), status: z.literal("closed_unrecorded"), closure }).strict(),
]);
const read = z
  .object({
    version: z.literal(1),
    actor_id: uuid,
    snapshot,
    results: z.array(result),
  })
  .strict();
const operation = z
  .object({
    id: uuid,
    kind: z.literal("record_native_dispense_finance"),
    payload: request,
  })
  .strict();
function check(v: unknown): asserts v {
  if (!v)
    throw new Error(
      "Financial evidence does not match the exact reviewed dispense and ledger.",
    );
}
const max0 = (v: bigint) => (v > 0n ? v : 0n);
const min = (...v: bigint[]) => v.reduce((a, b) => (a < b ? a : b));
const sum = (rows: { amount_cents: string }[]) =>
  rows.reduce((n, r) => n + BigInt(r.amount_cents), 0n);
function micros(v: string) {
  const f = v.match(/\.(\d+)(?:Z|[+-]\d\d:\d\d)$/)?.[1] ?? "";
  return BigInt(Date.parse(v)) * 1000n + BigInt(f.padEnd(6, "0").slice(3));
}
export function formatFinanceCents(v: string) {
  const n = BigInt(cents.parse(v));
  return `$${(n / 100n).toLocaleString("en-US")}.${String(n % 100n).padStart(2, "0")}`;
}
export function financeDollarsToCents(value: string) {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value))
    throw new Error(
      "Enter a positive dollar amount with at most two decimal places.",
    );
  const [whole, fraction = ""] = value.split(".");
  return positiveCents.parse(
    (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"))).toString(),
  );
}
function validateSnapshot(s: FinanceSnapshot, t: DispenseFinanceTarget) {
  check(correctionEqual(s.target, t));
  for (const a of [s.credits, s.payments, s.refunds])
    check(sorted(a.map((r) => r.id)));
  check((s.invoice.status === "draft") === (s.invoice.total_cents === null));
  check((s.invoice.status === "draft") === (s.balance === null));
  check(
    s.blockers.includes("invoice_not_issued") ===
      (s.invoice.status !== "issued"),
  );
  const L = sum(s.credits.filter((c) => c.dispense_id === t.dispense_id)),
    U = sum(s.credits.filter((c) => c.dispense_id === null)),
    C = sum(s.credits),
    item = max0(BigInt(s.invoice.item_amount_cents) - L - U),
    invoice =
      s.invoice.total_cents === null
        ? 0n
        : max0(BigInt(s.invoice.total_cents) - C);
  check(
    s.capacity.linked_credit_cents === L.toString() &&
      s.capacity.unallocated_credit_cents === U.toString() &&
      s.capacity.item_credit_capacity_cents === item.toString() &&
      s.capacity.invoice_credit_capacity_cents === invoice.toString() &&
      s.capacity.credit_capacity_cents === min(item, invoice).toString(),
  );
  for (const p of s.payments) {
    const spent = sum(
      s.refunds.filter((r) => r.payment_id === p.id && r.state !== "failed"),
    );
    check(
      p.remaining_cents === max0(BigInt(p.amount_cents) - spent).toString(),
    );
  }
  for (const r of s.refunds) {
    check(s.payments.some((p) => p.id === r.payment_id));
    if (r.credit_id !== null)
      check(
        s.credits.some(
          (c) => c.id === r.credit_id && c.dispense_id === r.dispense_id,
        ),
      );
  }
  if (s.balance) {
    const b = s.balance,
      T = BigInt(s.invoice.total_cents!),
      paid = sum(s.payments),
      refunded = sum(s.refunds.filter((r) => r.settled)),
      pending = sum(
        s.refunds.filter(
          (r) => !r.settled && ["pending", "reconciliation"].includes(r.state),
        ),
      );
    check(T >= C && paid >= refunded);
    const obligation = T - C,
      net = paid - refunded;
    check(
      b.obligation_cents === obligation.toString() &&
        b.paid_cents === paid.toString() &&
        b.refunded_cents === refunded.toString() &&
        b.net_cash_cents === net.toString() &&
        b.outstanding_cents === max0(obligation - net).toString() &&
        b.pending_refund_cents === pending.toString() &&
        b.refundable_cents === max0(net - obligation - pending).toString(),
    );
  }
}
export function financeEligibleAmount(
  s: FinanceSnapshot,
  i: FinanceIntent,
): string {
  if (i.action === "refund") {
    const c = s.credits.find(
        (c) => c.id === i.credit_id && c.dispense_id === i.target.dispense_id,
      ),
      p = s.payments.find((p) => p.id === i.payment_id);
    check(c && p);
    const spent = sum(
      s.refunds.filter(
        (r) => r.credit_id === c.id && (r.settled || r.state !== "failed"),
      ),
    );
    return s.invoice.status !== "issued" || s.blockers.length
      ? "0"
      : min(
          max0(BigInt(c.amount_cents) - spent),
          BigInt(p.remaining_cents),
          BigInt(s.balance!.refundable_cents),
          99999999n,
        ).toString();
  }
  return s.invoice.status !== "issued" || s.blockers.length
    ? "0"
    : s.capacity.credit_capacity_cents;
}
function validateContext(c: FinanceContext, t: DispenseFinanceTarget) {
  validateSnapshot(c.snapshot, t);
  check(correctionEqual(c.intent.target, t));
  check(
    c.eligible_amount_cents === financeEligibleAmount(c.snapshot, c.intent),
  );
}
function validateResult(r: FinanceResult, t: DispenseFinanceTarget) {
  validateContext(r.reviewed_context, t);
  const i = r.reviewed_context.intent,
    s = r.reviewed_context.snapshot;
  check(
    correctionEqual(r.target, t) &&
      r.action === i.action &&
      r.amount_cents === i.amount_cents &&
      r.reason === i.reason &&
      r.invoice_id === s.invoice.id &&
      r.invoice_item_id === s.invoice.item_id &&
      r.currency === s.invoice.currency &&
      BigInt(r.amount_cents) <=
        BigInt(r.reviewed_context.eligible_amount_cents),
  );
  check(
    r.action === "credit"
      ? r.credit_id === r.id &&
          r.refund_request_id === null &&
          r.payment_id === null
      : r.refund_request_id === r.id &&
          r.credit_id === i.credit_id &&
          r.payment_id === i.payment_id,
  );
}
export function createNativeDispenseFinanceApi(
  client: PrescriptionRpc,
  actorId: string,
  t: DispenseFinanceTarget,
) {
  uuid.parse(actorId);
  target.parse(t);
  const contexts = new Map<string, FinanceContext>();
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const { data, error } = await client.rpc(name, args);
    if (error) throw error;
    return data;
  };
  function parseOperation(value: unknown): Readonly<PrescriptionOperation> {
    const op = operation.parse(value);
    check(correctionEqual(op.payload.intent.target, t));
    return op as PrescriptionOperation;
  }
  function parseReceipt(
    raw: unknown,
    op: Readonly<PrescriptionOperation>,
  ): FinanceReceipt {
    const q = parseOperation(op).payload as unknown as FinanceRequest,
      r = receipt.parse(raw) as FinanceReceipt;
    validateResult(r.result, t);
    check(
      r.id === op.id &&
        r.result.id === op.id &&
        r.actor_id === actorId &&
        r.result.actor_id === actorId &&
        correctionEqual(r.request, q) &&
        correctionEqual(r.result.reviewed_context.intent, q.intent) &&
        r.result.reviewed_context_hash === q.expected_context_hash &&
        micros(r.created_at) === micros(r.result.created_at),
    );
    const c = contexts.get(q.expected_context_hash);
    if (c) check(correctionEqual(r.result.reviewed_context, c));
    return r;
  }
  return {
    parseOperation,
    async read(): Promise<FinanceRead> {
      const r = read.parse(
        await rpc("read_native_dispense_finance", {
          p_authorization_id: t.authorization_id,
          p_pet_id: t.pet_id,
          p_dispense_id: t.dispense_id,
        }),
      ) as FinanceRead;
      check(r.actor_id === actorId);
      validateSnapshot(r.snapshot, t);
      const ids = new Set<string>();
      r.results.forEach((v, index) => {
        validateResult(v, t);
        check(!ids.has(v.id));
        ids.add(v.id);
        check(
          v.invoice_id === r.snapshot.invoice.id &&
            v.invoice_item_id === r.snapshot.invoice.item_id &&
            v.reviewed_context.snapshot.authorization_hash ===
              r.snapshot.authorization_hash &&
            v.reviewed_context.snapshot.dispense_document_hash ===
              r.snapshot.dispense_document_hash,
        );
        if (index) {
          const prior = r.results[index - 1];
          check(
            micros(prior.created_at) < micros(v.created_at) ||
              (micros(prior.created_at) === micros(v.created_at) &&
                prior.id < v.id),
          );
        }
        const ledger =
          v.action === "credit"
            ? r.snapshot.credits.find((c) => c.id === v.credit_id)
            : r.snapshot.refunds.find((f) => f.id === v.refund_request_id);
        check(
          ledger &&
            ledger.dispense_id === t.dispense_id &&
            ledger.amount_cents === v.amount_cents &&
            ledger.reason === v.reason &&
            ledger.actor_id === v.actor_id &&
            micros(ledger.created_at) === micros(v.created_at),
        );
        if (v.action === "refund") {
          const row = ledger as FinanceRefund;
          check(
            row.credit_id === v.credit_id && row.payment_id === v.payment_id,
          );
        }
      });
      for (const c of r.snapshot.credits.filter(
        (c) => c.dispense_id === t.dispense_id,
      ))
        check(r.results.some((v) => v.action === "credit" && v.id === c.id));
      for (const f of r.snapshot.refunds.filter(
        (f) => f.dispense_id === t.dispense_id,
      ))
        check(r.results.some((v) => v.action === "refund" && v.id === f.id));
      return r;
    },
    async preview(value: unknown): Promise<FinancePreview> {
      const intent = financeIntentSchema.parse(value) as FinanceIntent;
      check(correctionEqual(intent.target, t));
      const p = preview.parse(
        await rpc("preview_native_dispense_finance", { p_intent: intent }),
      ) as FinancePreview;
      check(
        p.actor_id === actorId && correctionEqual(p.context.intent, intent),
      );
      validateContext(p.context, t);
      const blockers = [...p.context.snapshot.blockers];
      if (BigInt(intent.amount_cents) > BigInt(p.context.eligible_amount_cents))
        blockers.push(
          intent.action === "credit"
            ? "credit_capacity_exceeded"
            : "refund_capacity_exceeded",
        );
      check(
        correctionEqual(p.blockers, [...new Set(blockers)].sort()) &&
          p.allowed === (p.blockers.length === 0),
      );
      contexts.set(p.context_hash, p.context);
      return p;
    },
    async execute(op: Readonly<PrescriptionOperation>) {
      const parsed = parseOperation(op);
      return parseReceipt(
        await rpc("record_native_dispense_finance", {
          p_id: parsed.id,
          p_request: parsed.payload,
        }),
        parsed,
      );
    },
    async recover(op: Readonly<PrescriptionOperation>) {
      const parsed = parseOperation(op),
        raw = await rpc("recover_native_dispense_finance", { p_id: parsed.id });
      return raw === null ? null : parseReceipt(raw, parsed);
    },
    async close(op: Readonly<PrescriptionOperation>): Promise<FinanceCloseResult> {
      const parsed = parseOperation(op);
      const r = resolution.parse(await rpc("close_native_dispense_finance", {
        p_id: parsed.id,
        p_request: parsed.payload,
      }));
      if (r.status === "recorded")
        return { version: 1, status: "recorded", receipt: parseReceipt(r.receipt, parsed) };
      check(r.closure.id === parsed.id && r.closure.actor_id === actorId &&
        correctionEqual(r.closure.request, parsed.payload));
      return r as FinanceClosedResolution;
    },
  };
}
