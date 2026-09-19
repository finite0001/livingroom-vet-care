import { STRIPE_API_VERSION, StripeBoundaryError, verifyStripeSignature } from "./stripe-provider.ts";
export interface StripeWebhookReceipt {
  event_id: string;
  event_type: string;
  provider_created_at: number;
  account_id: string;
  livemode: boolean;
  object_id: string | null;
  request_id: string | null;
  raw_sha256: string;
  disposition: "queued" | "quarantined" | "ignored";
  reason: string;
}
export interface StripeWebhookDependencies {
  enabled: boolean;
  signingSecret: string;
  accountId: string;
  livemode: boolean;
  now?: () => number;
  receive: (receipt: StripeWebhookReceipt) => Promise<void>;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function response(status: number) {
  return new Response(null, {status, headers: {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}});
}
async function rawBody(request: Request): Promise<Uint8Array> {
  if (!request.body) throw new Error("body");
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.length;
      if (size > 256 * 1024) { await reader.cancel(); throw new Error("body"); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
/** No database/provider work happens before signature verification. */
export function createStripeWebhookHandler(deps: StripeWebhookDependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return response(405);
    if (!deps.enabled || !/^acct_[A-Za-z0-9]+$/.test(deps.accountId) || !/^whsec_[A-Za-z0-9]+$/.test(deps.signingSecret)) return response(503);
    let raw: Uint8Array;
    try { raw = await rawBody(request); } catch { return response(413); }
    try { await verifyStripeSignature(raw, request.headers.get("stripe-signature"), deps.signingSecret, deps.now?.()); }
    catch (error) { return response(error instanceof StripeBoundaryError ? 400 : 503); }
    let event: Record<string, unknown> | null;
    try { event = object(JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(raw))); } catch { return response(400); }
    if (!event || event.object !== "event" || typeof event.id !== "string" || !/^evt_[A-Za-z0-9]{1,196}$/.test(event.id) ||
        typeof event.type !== "string" || !/^[a-z][a-z0-9_.]{0,99}$/.test(event.type) || typeof event.livemode !== "boolean" ||
        !Number.isSafeInteger(event.created) || (event.created as number) < 0) return response(400);
    const resource = object(object(event.data)?.object);
    const metadata = object(resource?.metadata);
    const requestId = typeof metadata?.request_id === "string" && uuid.test(metadata.request_id) ? metadata.request_id : null;
    const objectId = typeof resource?.id === "string" && /^(cs_|re_|pi_|ch_|dp_)[A-Za-z0-9_]{1,190}$/.test(resource.id) ? resource.id : null;
    const session = ["checkout.session.completed", "checkout.session.expired", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed"].includes(event.type);
    const refund = ["refund.created", "refund.updated", "refund.failed"].includes(event.type);
    let disposition: StripeWebhookReceipt["disposition"] = "queued"; let reason = "";
    if ((event.account !== undefined && event.account !== deps.accountId) || event.livemode !== deps.livemode) {
      disposition = "quarantined"; reason = "account_or_mode_mismatch";
    } else if (event.api_version !== STRIPE_API_VERSION) {
      disposition = "quarantined"; reason = "api_version_mismatch";
    } else if (session || refund) {
      if (!requestId || !objectId || resource?.object !== (session ? "checkout.session" : "refund") || !objectId.startsWith(session ? "cs_" : "re_")) {
        disposition = "quarantined"; reason = "unattributed_provider_object";
      }
    } else if (event.type.startsWith("charge.dispute.") || event.type === "charge.refunded" || event.type === "payment_intent.succeeded") {
      disposition = "quarantined"; reason = "external_adjustment_review";
    } else { disposition = "ignored"; reason = "unsupported_event"; }
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(raw)));
    const receipt: StripeWebhookReceipt = {
      event_id: event.id, event_type: event.type, provider_created_at: event.created as number,
      account_id: deps.accountId, livemode: deps.livemode, object_id: objectId, request_id: requestId,
      raw_sha256: Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join(""), disposition, reason,
    };
    try { await deps.receive(receipt); } catch { return response(503); }
    return response(200);
  };
}
