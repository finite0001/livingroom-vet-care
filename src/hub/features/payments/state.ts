export interface ProviderProfile {
  account_id: string;
  livemode: boolean;
  return_origin: string;
}
export interface PaymentAttempt {
  id: string;
  invoice_id: string;
  client_id: string;
  actor_id: string;
  amount_cents: string;
  created_at: string;
  state: string;
  source_hash: string;
}
export interface CapturedPayment {
  id: string;
  invoice_id: string;
  request_id: string;
  amount_cents: string;
  created_at: string;
  payment_id: string;
}
export interface RefundRequest {
  id: string;
  invoice_id: string;
  payment_id: string;
  actor_id: string;
  amount_cents: string;
  reason: string;
  created_at: string;
  state: string;
}
export interface PaymentState {
  invoice_id: string;
  client_id: string;
  source_hash: string;
  balance: {
    obligation_cents: string;
    paid_cents: string;
    refunded_cents: string;
    net_cash_cents: string;
    outstanding_cents: string;
    pending_refund_cents: string;
    refundable_cents: string;
  };
  attempts: PaymentAttempt[];
  payments: CapturedPayment[];
  refund_requests: RefundRequest[];
  reconciliation_observations: Array<{
    resolved?: boolean;
    id: string;
    family: string;
    request_id: string;
    reason: string;
    created_at: string;
  }>;
}
export interface CheckoutArgs {
  p_request_id: string;
  p_invoice_id: string;
  p_client_id: string;
  p_source_hash: string;
  p_amount_cents: number;
  p_account_id: string;
  p_livemode: boolean;
  p_success_url: string;
  p_cancel_url: string;
}
export interface RefundArgs {
  p_request_id: string;
  p_invoice_id: string;
  p_payment_id: string;
  p_amount_cents: number;
  p_reason: string;
}
export interface PaymentIntent {
  family: "checkout";
  args: CheckoutArgs;
}
export interface RefundIntent {
  family: "refund";
  args: RefundArgs;
}
export type PendingIntent = PaymentIntent | RefundIntent;
export function cents(value: unknown): bigint {
  if (typeof value !== "string" || !/^\d+$/.test(value))
    throw new Error("Payment amounts could not be verified.");
  return BigInt(value);
}
export function formatCents(value: string): string {
  const amount = cents(value);
  return `$${(amount / 100n).toLocaleString("en-US")}.${String(amount % 100n).padStart(2, "0")}`;
}
export function parsePaymentState(
  value: unknown,
  invoice: string,
  client: string,
): PaymentState {
  const state = value as PaymentState;
  if (
    !state ||
    state.invoice_id !== invoice ||
    state.client_id !== client ||
    !/^[a-f0-9]{64}$/.test(state.source_hash) ||
    !state.balance
  )
    throw new Error("Invoice payment state could not be verified.");
  for (const key of [
    "obligation_cents",
    "paid_cents",
    "refunded_cents",
    "net_cash_cents",
    "outstanding_cents",
    "pending_refund_cents",
    "refundable_cents",
  ] as const)
    cents(state.balance[key]);
  if (
    !Array.isArray(state.attempts) ||
    !Array.isArray(state.payments) ||
    !Array.isArray(state.refund_requests) ||
    !Array.isArray(state.reconciliation_observations)
  )
    throw new Error("Payment history is incomplete.");
  for (const row of [
    ...state.attempts,
    ...state.payments,
    ...state.refund_requests,
  ]) {
    if (
      !row ||
      row.invoice_id !== invoice ||
      !row.id ||
      !Number.isFinite(Date.parse(row.created_at))
    )
      throw new Error("Payment history does not match this invoice.");
    cents(row.amount_cents);
  }
  if (
    state.attempts.some(
      (row) =>
        row.client_id !== client ||
        !["prepared", "open", "paid", "expired", "reconciliation"].includes(
          row.state,
        ),
    ) ||
    state.refund_requests.some(
      (row) =>
        !["pending", "failed", "succeeded", "reconciliation"].includes(
          row.state,
        ),
    )
  )
    throw new Error("Payment history has an unsupported state.");
  if (
    state.reconciliation_observations.some(
      (row) =>
        !row ||
        (row.resolved !== undefined && typeof row.resolved !== "boolean"),
    )
  )
    throw new Error("Payment reconciliation history has an unsupported state.");
  return state;
}
export function requiresReconciliation(state: PaymentState): boolean {
  return (
    state.reconciliation_observations.some((row) => row.resolved !== true) ||
    state.attempts.some((row) => row.state === "reconciliation") ||
    state.refund_requests.some((row) => row.state === "reconciliation")
  );
}
export function parseProfile(rows: unknown): ProviderProfile | null {
  if (!Array.isArray(rows) || rows.length > 1)
    throw new Error("Payment configuration could not be verified.");
  if (!rows.length) return null;
  const p = rows[0] as ProviderProfile;
  let url: URL;
  try {
    url = new URL(p.return_origin);
  } catch {
    throw new Error("Payment return address is invalid.");
  }
  if (
    !/^acct_[A-Za-z0-9]+$/.test(p.account_id) ||
    typeof p.livemode !== "boolean" ||
    url.origin !== p.return_origin ||
    url.protocol !== "https:" ||
    url.username ||
    url.password
  )
    throw new Error("Payment configuration could not be verified.");
  return p;
}
export function checkoutUrl(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string")
    throw new Error("Stripe Checkout address unavailable.");
  const url = new URL(value);
  if (
    url.origin !== "https://checkout.stripe.com" ||
    !url.pathname.startsWith("/c/pay/") ||
    url.username ||
    url.password
  )
    throw new Error("Stripe Checkout address unavailable.");
  return url.href;
}
export function validateIntent(
  value: unknown,
  invoice: string,
  client: string,
): PendingIntent {
  const p = value as PendingIntent;
  if (
    !p ||
    !["checkout", "refund"].includes(p.family) ||
    !p.args ||
    p.args.p_invoice_id !== invoice ||
    !/^[0-9a-f-]{36}$/i.test(p.args.p_request_id) ||
    !Number.isSafeInteger(p.args.p_amount_cents) ||
    p.args.p_amount_cents <= 0
  )
    throw new Error(
      "Saved payment request cannot be verified. Reconcile payment history before proceeding.",
    );
  if (Object.keys(p).sort().join(",") !== "args,family")
    throw new Error("Unexpected payment intent fields.");
  if (p.family === "checkout") {
    const a = p.args;
    if (
      Object.keys(a).sort().join(",") !==
        [
          "p_request_id",
          "p_invoice_id",
          "p_client_id",
          "p_source_hash",
          "p_amount_cents",
          "p_account_id",
          "p_livemode",
          "p_success_url",
          "p_cancel_url",
        ]
          .sort()
          .join(",") ||
      a.p_client_id !== client ||
      !/^[a-f0-9]{64}$/.test(a.p_source_hash) ||
      a.p_amount_cents < 50 ||
      a.p_amount_cents > 99999999
    )
      throw new Error("Saved Checkout request does not match this invoice.");
    const origin = new URL(a.p_success_url).origin;
    parseProfile([
      {
        account_id: a.p_account_id,
        livemode: a.p_livemode,
        return_origin: origin,
      },
    ]);
    if (
      a.p_success_url !== origin + "/payment/return" ||
      a.p_cancel_url !== origin + "/payment/cancel"
    )
      throw new Error("Saved return destinations cannot be verified.");
  } else if (
    Object.keys(p.args).sort().join(",") !==
      [
        "p_request_id",
        "p_invoice_id",
        "p_payment_id",
        "p_amount_cents",
        "p_reason",
      ]
        .sort()
        .join(",") ||
    !p.args.p_payment_id ||
    typeof p.args.p_reason !== "string" ||
    !p.args.p_reason.trim() ||
    p.args.p_reason.length > 2000
  )
    throw new Error("Saved refund request cannot be verified.");
  return p;
}
export function verifyPrepared(
  value: unknown,
  intent: PendingIntent,
  actor: string,
): void {
  const row = value as {
    id: string;
    invoice_id: string;
    actor_id: string;
    amount_cents: number;
  };
  if (
    !row ||
    row.id !== intent.args.p_request_id ||
    row.invoice_id !== intent.args.p_invoice_id ||
    row.actor_id !== actor ||
    !Number.isSafeInteger(row.amount_cents) ||
    row.amount_cents !== intent.args.p_amount_cents
  )
    throw new Error(
      "Payment preparation response is unconfirmed. Recover the same request.",
    );
}
