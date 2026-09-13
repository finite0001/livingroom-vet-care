export const retryReasons = {
  provider_recovered: "Provider service recovered",
  rate_limit_resolved: "Rate limit resolved",
  processor_repaired: "Processing problem repaired",
};
export interface StripeRetryIntent {
  p_resolution_id: string;
  p_receipt_id: string;
  p_expected_work_hash: string;
  p_reason: keyof typeof retryReasons;
  p_attest: true;
}
export interface StripeRetryCycle {
  id: string;
  receipt_id: string;
  actor_id: string;
  cycle_no: number;
  expected_work_hash: string;
  reason: keyof typeof retryReasons;
  previous_attempt_count: number;
  previous_cycle_attempt_count: number;
  created_at: string;
}
export interface StripeRetryRow {
  id: string;
  event_type: string;
  work_state: string;
  attempt_count: number;
  cycle_no: number;
  cycle_attempt_count: number;
  work_reason: string;
}
export interface StripeRetryPreview {
  receiptId: string;
  eligible: boolean;
  hash: string;
  workState: string;
  attemptCount: number;
  cycleNo: number;
  cycleAttemptCount: number;
  cycles: StripeRetryCycle[];
  history: Array<{
    action: string;
    reason: string;
    attemptCount: number;
    cycleNo: number;
    createdAt: string;
  }>;
}
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hash = /^[a-f0-9]{64}$/;
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
function fail(): never {
  throw new Error("Payment processing review unavailable");
}
function text(v: unknown, re: RegExp) {
  if (typeof v !== "string" || !re.test(v)) fail();
  return v;
}
function count(v: unknown, max = Number.MAX_SAFE_INTEGER) {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0 || v > max) {
    fail();
  }
  return v;
}
function reason(v: unknown): keyof typeof retryReasons {
  if (
    typeof v !== "string" ||
    !Object.prototype.hasOwnProperty.call(retryReasons, v)
  )
    fail();
  return v as keyof typeof retryReasons;
}
export function stripeRetryIntent(v: unknown): StripeRetryIntent {
  if (
    !object(v) ||
    Object.keys(v).sort().join() !==
      [
        "p_resolution_id",
        "p_receipt_id",
        "p_expected_work_hash",
        "p_reason",
        "p_attest",
      ]
        .sort()
        .join() ||
    v.p_attest !== true
  )
    fail();
  return {
    p_resolution_id: text(v.p_resolution_id, uuid),
    p_receipt_id: text(v.p_receipt_id, uuid),
    p_expected_work_hash: text(v.p_expected_work_hash, hash),
    p_reason: reason(v.p_reason),
    p_attest: true,
  };
}
export function stripeRetryCycle(v: unknown): StripeRetryCycle {
  if (!object(v)) fail();
  const created_at = text(v.created_at, /./);
  if (!Number.isFinite(Date.parse(created_at))) fail();
  const cycle_no = count(v.cycle_no);
  if (cycle_no < 1 || v.previous_cycle_attempt_count !== 5) fail();
  return {
    id: text(v.id, uuid),
    receipt_id: text(v.receipt_id, uuid),
    actor_id: text(v.actor_id, uuid),
    cycle_no,
    expected_work_hash: text(v.expected_work_hash, hash),
    reason: reason(v.reason),
    previous_attempt_count: count(v.previous_attempt_count),
    previous_cycle_attempt_count: 5,
    created_at,
  };
}
export function matchingStripeRetry(
  c: StripeRetryCycle,
  i: StripeRetryIntent,
  actor: string,
) {
  return (
    c.id === i.p_resolution_id &&
    c.receipt_id === i.p_receipt_id &&
    c.actor_id === actor &&
    c.expected_work_hash === i.p_expected_work_hash &&
    c.reason === i.p_reason
  );
}
export function stripeRetryRows(v: unknown): StripeRetryRow[] {
  if (!Array.isArray(v) || v.length > 250) fail();
  return v.map((row) => {
    if (!object(row)) fail();
    return {
      id: text(row.id, uuid),
      event_type: text(row.event_type, /^[a-z][a-z0-9_.]{0,99}$/),
      work_state: text(
        row.work_state,
        /^(queued|processing|completed|quarantined|ignored)$/,
      ),
      attempt_count: count(row.attempt_count),
      cycle_no: count(row.cycle_no),
      cycle_attempt_count: count(row.cycle_attempt_count, 5),
      work_reason: text(row.work_reason, /^[a-z_]*$/),
    };
  });
}
export function stripeRetryPreview(
  v: unknown,
  receiptId: string,
): StripeRetryPreview {
  if (
    !object(v) ||
    !object(v.receipt) ||
    v.receipt.id !== receiptId ||
    !object(v.work) ||
    v.work.receipt_id !== receiptId ||
    typeof v.eligible !== "boolean" ||
    !Array.isArray(v.cycles) ||
    v.cycles.length > 1000
  )
    fail();
  if (!Array.isArray(v.history)) fail();
  const history = v.history.map((h) => {
    if (!object(h)) fail();
    return {
      action: text(h.action, /^[a-z_]+$/),
      reason: text(h.reason, /^[a-z_]*$/),
      attemptCount: count(h.attempt_count),
      cycleNo: count(h.cycle_no),
      createdAt: text(h.created_at, /./),
    };
  });
  const cycles = v.cycles.map(stripeRetryCycle);
  if (
    cycles.some((c) => c.receipt_id !== receiptId) ||
    new Set(cycles.map((c) => c.id)).size !== cycles.length
  )
    fail();
  return {
    receiptId,
    eligible: v.eligible,
    hash: text(v.expected_work_hash, hash),
    workState: text(
      v.work.state,
      /^(queued|processing|completed|quarantined|ignored)$/,
    ),
    attemptCount: count(v.work.attempt_count),
    cycleNo: count(v.work.cycle_no),
    cycleAttemptCount: count(v.work.cycle_attempt_count, 5),
    cycles,
    history,
  };
}

export interface StripeQueueCursor {
  at: string;
  id: string;
}
export interface StripeQueuePage {
  items: Array<StripeRetryRow & { created_at: string }>;
  has_more: boolean;
}
export function stripeQueuePage(v: unknown): StripeQueuePage {
  if (!object(v) || typeof v.has_more !== "boolean") fail();
  const rows = stripeRetryRows(v.items);
  return {
    items: rows.map((row, i) => {
      const original = (v.items as Record<string, unknown>[])[i];
      const created_at = text(original.created_at, /./);
      if (!Number.isFinite(Date.parse(created_at))) fail();
      return { ...row, created_at };
    }),
    has_more: v.has_more,
  };
}
