export type PaymentAccessKind = "collection" | "status" | "neutral";
export interface PaymentAccess {
  kind: PaymentAccessKind;
  grantId: string;
  token: string;
  returnKind: "return" | "cancel" | null;
}
export interface PaymentStatus {
  state:
    | "ready"
    | "confirmation_pending"
    | "paid"
    | "partially_refunded"
    | "refunded"
    | "reconciliation"
    | "checkout_ready";
  amount_cents: string;
  currency: "usd";
  expires_at: string;
  status_expires_at: string;
  confirmed_paid_cents: string;
  confirmed_refunded_cents: string;
  collection_available?: boolean;
  checkout_url?: string;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const unavailable = () => new Error("Payment information unavailable");
export function paymentRoute(
  pathname: string,
  hash: string,
): PaymentAccess | null {
  if (pathname === "/payment/return" || pathname === "/payment/cancel")
    return {
      kind: "neutral",
      grantId: "",
      token: "",
      returnKind: pathname.endsWith("cancel") ? "cancel" : "return",
    };
  if (pathname === "/pay" || pathname.startsWith("/pay/"))
    return {
      kind: "collection",
      grantId: pathname.slice("/pay/".length),
      token: hash.slice(1),
      returnKind: null,
    };
  for (const kind of ["return", "cancel"] as const)
    if (pathname.startsWith(`/payment/${kind}/`))
      return {
        kind: "status",
        grantId: pathname.slice(`/payment/${kind}/`.length),
        token: hash.slice(1),
        returnKind: kind,
      };
  return null;
}
export function validPaymentAccess(access: PaymentAccess): boolean {
  return (
    uuid.test(access.grantId) &&
    (access.kind === "collection"
      ? /^p1\.[A-Za-z0-9_-]{43}$/
      : /^s1\.[A-Za-z0-9_-]{43}$/
    ).test(access.token) &&
    access.kind !== "neutral"
  );
}
export function paymentCents(value: unknown): bigint {
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,29})$/.test(value))
    throw unavailable();
  return BigInt(value);
}
export function paymentMoney(value: string): string {
  const amount = paymentCents(value);
  return `$${(amount / 100n).toLocaleString("en-US")}.${String(amount % 100n).padStart(2, "0")}`;
}
export function safeCheckoutUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 4096) throw unavailable();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw unavailable();
  }
  if (
    url.origin !== "https://checkout.stripe.com" ||
    !url.pathname.startsWith("/c/pay/") ||
    url.username ||
    url.password
  )
    throw unavailable();
  return url.href;
}
export function parsePaymentStatus(
  value: unknown,
  action: "inspect" | "activate" | "status",
): PaymentStatus {
  const p = value as PaymentStatus;
  if (
    !p ||
    typeof p !== "object" ||
    Array.isArray(p) ||
    p.currency !== "usd" ||
    ![
      "ready",
      "confirmation_pending",
      "paid",
      "partially_refunded",
      "refunded",
      "reconciliation",
      ...(action === "activate" ? ["checkout_ready"] : []),
    ].includes(p.state)
  )
    throw unavailable();
  const allowed = new Set([
    "state",
    "amount_cents",
    "currency",
    "expires_at",
    "status_expires_at",
    "confirmed_paid_cents",
    "confirmed_refunded_cents",
    ...(action === "status" ? [] : ["collection_available"]),
    ...(action === "activate" ? ["checkout_url"] : []),
  ]);
  if (Object.keys(p).some((key) => !allowed.has(key))) throw unavailable();
  const requested = paymentCents(p.amount_cents);
  if (requested < 50n || requested > 99999999n) throw unavailable();
  const paid = paymentCents(p.confirmed_paid_cents),
    refunded = paymentCents(p.confirmed_refunded_cents);
  if (refunded > paid) throw unavailable();
  if (
    typeof p.expires_at !== "string" ||
    typeof p.status_expires_at !== "string" ||
    !Number.isFinite(Date.parse(p.expires_at)) ||
    !Number.isFinite(Date.parse(p.status_expires_at)) ||
    Date.parse(p.status_expires_at) < Date.parse(p.expires_at)
  )
    throw unavailable();
  if (action !== "status" && typeof p.collection_available !== "boolean")
    throw unavailable();
  if (
    (p.state === "paid" && (paid < requested || refunded !== 0n)) ||
    (p.state === "partially_refunded" &&
      (paid < requested || refunded === 0n || refunded >= paid)) ||
    (p.state === "refunded" && (paid < requested || refunded !== paid))
  )
    throw unavailable();
  if (p.state === "checkout_ready") {
    if (
      action !== "activate" ||
      p.collection_available !== true ||
      paid !== 0n ||
      refunded !== 0n
    )
      throw unavailable();
    p.checkout_url = safeCheckoutUrl(p.checkout_url);
  } else if ("checkout_url" in p) throw unavailable();
  return p;
}
async function limitedJson(response: Response): Promise<unknown> {
  const limit = 16 * 1024;
  const length = response.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > limit))
    throw unavailable();
  if (
    response.headers.get("content-type")?.split(";")[0].trim() !==
      "application/json" ||
    !response.body
  )
    throw unavailable();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > limit) throw unavailable();
      chunks.push(chunk.value);
    }
  } catch (e) {
    await reader.cancel().catch(() => {});
    throw e;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw unavailable();
  }
}
export async function fetchPayment(
  access: PaymentAccess,
  action: "inspect" | "activate" | "status",
  signal: AbortSignal,
  base = import.meta.env?.VITE_SUPABASE_URL,
): Promise<PaymentStatus> {
  if (
    !validPaymentAccess(access) ||
    (access.kind === "collection" && action === "status") ||
    (access.kind === "status" && action !== "status")
  )
    throw unavailable();
  let origin: URL;
  try {
    origin = new URL(base);
  } catch {
    throw unavailable();
  }
  if (
    origin.origin !== base ||
    (origin.protocol !== "https:" &&
      !(
        origin.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(origin.hostname)
      ))
  )
    throw unavailable();
  const endpoint =
    access.kind === "collection" ? "payment-collection" : "payment-status";
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) controller.abort();
  const deadline = setTimeout(abort, 15000);
  try {
    const response = await fetch(`${origin.origin}/functions/v1/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_id: access.grantId,
        token: access.token,
        ...(access.kind === "collection" ? { action } : {}),
      }),
      signal: controller.signal,
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    if (!response.ok || response.redirected) throw unavailable();
    return parsePaymentStatus(await limitedJson(response), action);
  } finally {
    controller.abort();
    clearTimeout(deadline);
    signal.removeEventListener("abort", abort);
  }
}
