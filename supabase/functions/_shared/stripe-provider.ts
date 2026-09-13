/** Server-only provider boundary. Callers persist intent BEFORE invoking a mutation. */
export const STRIPE_API_VERSION = "2026-08-26.dahlia";
export interface StripeEnvironment {
  STRIPE_PAYMENTS_ENABLED?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_ACCOUNT_ID?: string;
  STRIPE_LIVEMODE?: string;
  STRIPE_RETURN_ORIGIN?: string;
}
export interface CheckoutIntent {
  id: string;
  source_hash: string;
  amount_cents: string;
  currency: string;
  account_id: string;
  livemode: boolean;
  success_url: string;
  cancel_url: string;
  idempotency_key: string;
  session_expires_at: string;
  retry_before: string;
}
export interface RefundIntent {
  id: string;
  amount_cents: string;
  provider_payment_id: string;
  account_id: string;
  livemode: boolean;
  currency: string;
  idempotency_key: string;
  retry_before: string;
}
export interface StripeObject { [key: string]: unknown }
export class StripeBoundaryError extends Error {
  readonly code: "disabled" | "configuration" | "intent" | "reconcile" | "provider" | "ambiguous" | "signature";
  constructor(code: StripeBoundaryError["code"]) {
    super(`Stripe ${code}`);
    this.code = code;
  }
}
function fail(code: StripeBoundaryError["code"]): never { throw new StripeBoundaryError(code); }
function record(value: unknown): StripeObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("provider");
  return value as StripeObject;
}
function cents(value: string): string {
  // Stripe USD supports eight digit positive amounts; keep DB bigint values as strings.
  if (!/^[1-9][0-9]{0,7}$/.test(value) || BigInt(value) < 50n) fail("intent");
  return value;
}
function returnUrl(value: string, origin: string, path: string): string {
  let url: URL;
  try { url = new URL(value); } catch { fail("intent"); }
  if (url.origin !== origin || url.username || url.password || url.pathname !== path || url.search || url.hash) fail("intent");
  return value;
}
async function boundedJson(response: Response): Promise<StripeObject> {
  if (!response.body) fail("provider");
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 256 * 1024) { await reader.cancel(); fail("provider"); }
      parts.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  try { return record(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))); }
  catch { fail("provider"); }
}
export function createStripeProvider(env: StripeEnvironment, fetcher: typeof fetch = fetch, now = () => Date.now()) {
  if (env.STRIPE_PAYMENTS_ENABLED !== "true") fail("disabled");
  const live = env.STRIPE_LIVEMODE === "true";
  if (!["true", "false"].includes(env.STRIPE_LIVEMODE ?? "") ||
      !/^acct_[A-Za-z0-9]+$/.test(env.STRIPE_ACCOUNT_ID ?? "") ||
      !new RegExp(`^(sk|rk)_${live ? "live" : "test"}_[A-Za-z0-9]+$`).test(env.STRIPE_SECRET_KEY ?? "")) fail("configuration");
  let origin: URL;
  try { origin = new URL(env.STRIPE_RETURN_ORIGIN ?? ""); } catch { fail("configuration"); }
  if (origin.protocol !== "https:" || origin.origin !== env.STRIPE_RETURN_ORIGIN) fail("configuration");
  async function request(path: string, params?: URLSearchParams, key?: string): Promise<StripeObject> {
    const mutating = params !== undefined;
    try {
      const response = await fetcher(`https://api.stripe.com/v1/${path}`, {
        method: mutating ? "POST" : "GET", redirect: "error", cache: "no-store",
        signal: AbortSignal.timeout(15000),
        headers: {
          Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "Stripe-Version": STRIPE_API_VERSION,
          ...(mutating ? { "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": key! } : {}),
        }, body: params,
      });
      // Even a rejected/invalid response never proves an intent is safe to unlock.
      if (!response.ok) { await response.body?.cancel(); fail(mutating ? "ambiguous" : "provider"); }
      return await boundedJson(response);
    } catch { fail(mutating ? "ambiguous" : "provider"); }
  }
  async function account() {
    const result = await request("account");
    if (result.id !== env.STRIPE_ACCOUNT_ID || result.object !== "account") fail("configuration");
  }
  function validateIntent(intent: CheckoutIntent) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(intent.id) ||
        !/^[0-9a-f]{64}$/.test(intent.source_hash) || intent.account_id !== env.STRIPE_ACCOUNT_ID ||
        intent.livemode !== live || intent.currency !== "usd" ||
        !/^[A-Za-z0-9:_-]{16,200}$/.test(intent.idempotency_key)) fail("intent");
    cents(intent.amount_cents);
    returnUrl(intent.success_url, origin.origin, "/payment/return"); returnUrl(intent.cancel_url, origin.origin, "/payment/cancel");
  }
  return {
    async createCheckout(intent: CheckoutIntent) {
      validateIntent(intent);
      const expiry = Date.parse(intent.session_expires_at);
      const retry = Date.parse(intent.retry_before);
      if (!Number.isFinite(expiry) || !Number.isFinite(retry) || now() >= retry ||
          expiry - now() < 31 * 60_000 || expiry - now() > 24 * 60 * 60_000) fail("reconcile");
      await account();
      // Account lookup can consume time; never cross the expiry/retry boundary during it.
      if (now() >= retry || expiry - now() < 31 * 60_000) fail("reconcile");
      const params = new URLSearchParams({
        mode: "payment", "payment_method_types[0]": "card",
        "line_items[0][quantity]": "1", "line_items[0][price_data][currency]": "usd",
        "line_items[0][price_data][unit_amount]": intent.amount_cents,
        "line_items[0][price_data][product_data][name]": "Living Room Vet payment",
        "adaptive_pricing[enabled]": "false", "automatic_tax[enabled]": "false",
        allow_promotion_codes: "false", "invoice_creation[enabled]": "false",
        "after_expiration[recovery][enabled]": "false",
        client_reference_id: intent.id, "metadata[request_id]": intent.id,
        "metadata[source_hash]": intent.source_hash,
        "payment_intent_data[metadata][request_id]": intent.id,
        "payment_intent_data[metadata][source_hash]": intent.source_hash,
        success_url: intent.success_url, cancel_url: intent.cancel_url,
        expires_at: String(Math.floor(expiry / 1000)),
      });
      return request("checkout/sessions", params, intent.idempotency_key);
    },
    async createRefund(intent: RefundIntent) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(intent.id) ||
          !/^[1-9][0-9]{0,7}$/.test(intent.amount_cents) || !/^pi_[A-Za-z0-9]+$/.test(intent.provider_payment_id) ||
          intent.account_id !== env.STRIPE_ACCOUNT_ID || intent.livemode !== live || intent.currency !== "usd" ||
          !/^[A-Za-z0-9:_-]{16,200}$/.test(intent.idempotency_key)) fail("intent");
      const retry = Date.parse(intent.retry_before);
      if (!Number.isFinite(retry) || now() >= retry) fail("reconcile");
      await account();
      if (now() >= retry) fail("reconcile");
      // Staff reason remains in LRV; it can contain clinical information.
      return request("refunds", new URLSearchParams({
        payment_intent: intent.provider_payment_id, amount: intent.amount_cents,
        "metadata[request_id]": intent.id,
      }), intent.idempotency_key);
    },
    async retrieveRefund(refundId: string) {
      if (!/^re_[A-Za-z0-9]+$/.test(refundId)) fail("intent");
      await account();
      return request(`refunds/${refundId}`);
    },
    async retrieveCheckout(sessionId: string) {
      if (!/^cs_(test_|live_)?[A-Za-z0-9]+$/.test(sessionId)) fail("intent");
      await account();
      return request(`checkout/sessions/${sessionId}`);
    },
    async expireCheckout(sessionId: string, idempotencyKey: string) {
      if (!/^cs_(test_|live_)?[A-Za-z0-9]+$/.test(sessionId) || !/^[A-Za-z0-9:_-]{16,200}$/.test(idempotencyKey)) fail("intent");
      await account();
      return request(`checkout/sessions/${sessionId}/expire`, new URLSearchParams(), idempotencyKey);
    },
  };
}

/** Verify untouched bytes before parsing. Rotation permits multiple v1 signatures. */
export async function verifyStripeSignature(raw: Uint8Array, header: string | null, secret: string, nowMs = Date.now()): Promise<void> {
  if (raw.byteLength > 256 * 1024 || !header || header.length > 4096 || !/^whsec_[A-Za-z0-9]+$/.test(secret)) fail("signature");
  const entries = header.split(",").map((part) => part.trim().split("="));
  const timestamps = entries.filter(([key]) => key === "t");
  if (timestamps.length !== 1 || !/^[0-9]{1,12}$/.test(timestamps[0][1] ?? "")) fail("signature");
  const timestamp = timestamps[0][1];
  if (Math.abs(nowMs / 1000 - Number(timestamp)) > 300) fail("signature");
  const signatures = entries.filter(([key, value]) => key === "v1" && /^[0-9a-f]{64}$/.test(value ?? "")).map(([, value]) => value);
  if (!signatures.length) fail("signature");
  const prefix = new TextEncoder().encode(`${timestamp}.`);
  const signed = new Uint8Array(prefix.length + raw.length); signed.set(prefix); signed.set(raw, prefix.length);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  let valid = false;
  for (const signature of signatures) {
    const bytes = Uint8Array.from(signature.match(/../g)!, (byte) => parseInt(byte, 16));
    valid = await crypto.subtle.verify("HMAC", key, bytes, signed) || valid;
  }
  if (!valid) fail("signature");
}

export interface CheckoutEvidence {
  session_id: string;
  payment_id: string | null;
  state: "session_open" | "session_expired" | "payment_succeeded" | "reconciliation";
  amount_cents: string;
  currency: "usd";
  client_url: string | null;
}
/** Do not persist or expose any raw provider payload, including customer_details. */
export function checkoutEvidence(value: StripeObject, intent: CheckoutIntent): CheckoutEvidence {
  const metadata = record(value.metadata);
  if (value.object !== "checkout.session" || typeof value.id !== "string" ||
      !/^cs_(test_|live_)?[A-Za-z0-9]+$/.test(value.id) || value.livemode !== intent.livemode ||
      value.mode !== "payment" || value.currency !== intent.currency || value.currency !== "usd" ||
      !Number.isSafeInteger(value.amount_total) || String(value.amount_total) !== intent.amount_cents ||
      value.client_reference_id !== intent.id || metadata.request_id !== intent.id || metadata.source_hash !== intent.source_hash ||
      value.expires_at !== Math.floor(Date.parse(intent.session_expires_at) / 1000) ||
      value.invoice !== null || value.recovered_from !== null) fail("reconcile");
  const paymentId = typeof value.payment_intent === "string" && /^pi_[A-Za-z0-9]+$/.test(value.payment_intent) ? value.payment_intent : null;
  let state: CheckoutEvidence["state"] = "reconciliation";
  if (value.status === "complete" && value.payment_status === "paid" && paymentId) state = "payment_succeeded";
  else if (value.status === "open" && value.payment_status === "unpaid") state = "session_open";
  else if (value.status === "expired" && value.payment_status === "unpaid") state = "session_expired";
  let clientUrl: string | null = null;
  if (state === "session_open") {
    if (typeof value.url !== "string" || value.url.length > 8192) fail("reconcile");
    let url: URL;
    try { url = new URL(value.url); } catch { fail("reconcile"); }
    if (url.origin !== "https://checkout.stripe.com" || url.username || url.password || !url.pathname.startsWith("/c/pay/")) fail("reconcile");
    clientUrl = value.url;
  }
  return { session_id: value.id, payment_id: paymentId, state, amount_cents: intent.amount_cents, currency: "usd", client_url: clientUrl };
}

export interface RefundEvidence {
  refund_id: string;
  provider_payment_id: string;
  amount_cents: string;
  currency: "usd";
  status: "pending" | "failed" | "succeeded";
}
export function refundEvidence(value: StripeObject, intent: RefundIntent): RefundEvidence {
  const metadata = record(value.metadata);
  // Refund objects do not carry livemode: account/mode are bound by the verified API credential.
  if (value.object !== "refund" || typeof value.id !== "string" || !/^re_[A-Za-z0-9]+$/.test(value.id) ||
      value.payment_intent !== intent.provider_payment_id || metadata.request_id !== intent.id ||
      !Number.isSafeInteger(value.amount) || String(value.amount) !== intent.amount_cents ||
      value.currency !== "usd" || value.currency !== intent.currency) fail("reconcile");
  let status: RefundEvidence["status"];
  if (value.status === "succeeded") status = "succeeded";
  else if (value.status === "failed" || value.status === "canceled") status = "failed";
  else if (value.status === "pending" || value.status === "requires_action") status = "pending";
  else fail("reconcile");
  return { refund_id: value.id, provider_payment_id: intent.provider_payment_id, amount_cents: intent.amount_cents, currency: "usd", status };
}
