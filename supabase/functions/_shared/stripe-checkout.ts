import { checkoutEvidence, StripeBoundaryError } from "./stripe-provider.ts";
import type { CheckoutIntent, CheckoutEvidence, StripeObject } from "./stripe-provider.ts";
export interface CheckoutContext extends CheckoutIntent {
  actor_id: string;
  state: "prepared" | "open" | "expired" | "paid" | "reconciliation";
  current_source_matches: boolean;
  session_id: string | null;
}
export interface CheckoutDependencies {
  origin: string;
  enabled: boolean;
  authenticate: (token: string) => Promise<string | null>;
  context: (requestId: string, actorId: string) => Promise<CheckoutContext>;
  provider: {
    createCheckout: (intent: CheckoutIntent) => Promise<StripeObject>;
    retrieveCheckout: (id: string) => Promise<StripeObject>;
    expireCheckout: (id: string, key: string) => Promise<StripeObject>;
  };
  apply: (intent: CheckoutIntent, evidence: CheckoutEvidence, eventId: string) => Promise<"accepted" | "quarantined">;
}
async function observationId(intent: CheckoutIntent, evidence: CheckoutEvidence) {
  const bytes = new TextEncoder().encode(JSON.stringify([intent.id, intent.account_id, intent.livemode, evidence.session_id, evidence.payment_id, evidence.state, evidence.amount_cents, evidence.currency, intent.source_hash]));
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return "observe:" + Array.from(hash, byte => byte.toString(16).padStart(2, "0")).join("");
}
export function createStripeCheckoutHandler(deps: CheckoutDependencies) {
  return async (request: Request): Promise<Response> => {
    const headers = {"Content-Type": "application/json", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "Access-Control-Allow-Origin": deps.origin, "Vary": "Origin"};
    const reply = (status: number, body: object) => new Response(JSON.stringify(body), {status, headers});
    if (request.headers.get("Origin") && request.headers.get("Origin") !== deps.origin) return reply(403, {error: "unavailable"});
    if (request.method === "OPTIONS") return new Response(null, {status: 204, headers: {...headers, "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "authorization,content-type,apikey,x-client-info"}});
    if (request.method !== "POST") return reply(405, {error: "unavailable"});
    if (!deps.enabled) return reply(503, {error: "payments_disabled"});
    const token = request.headers.get("Authorization")?.match(/^Bearer (\S+)$/)?.[1];
    if (!token) return reply(401, {error: "unauthorized"});
    let actor: string | null;
    try { actor = await deps.authenticate(token); } catch { return reply(503, {error: "unavailable"}); }
    if (!actor) return reply(401, {error: "unauthorized"});
    let body: {p_request_id: string; action: string};
    try {
      if (!request.body) return reply(400, {error: "invalid_request"});
      const reader = request.body.getReader(); let size = 0; const chunks: Uint8Array[] = [];
      try {
        for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length; if (size > 1024) {await reader.cancel(); return reply(413, {error: "invalid_request"});} chunks.push(chunk.value); }
      } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.length;}
      body = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes));
      if (!body || Object.keys(body).sort().join(",") !== "action,p_request_id" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.p_request_id) ||
          !["create", "recover", "expire"].includes(body.action)) return reply(400, {error: "invalid_request"});
    } catch { return reply(400, {error: "invalid_request"}); }
    let intent: CheckoutContext;
    try { intent = await deps.context(body.p_request_id, actor); }
    catch { return reply(404, {error: "checkout_unavailable"}); }
    if (intent.actor_id !== actor || intent.id !== body.p_request_id) return reply(404, {error: "checkout_unavailable"});
    if (intent.state === "reconciliation") return reply(409, {state: "reconciliation"});
    if (intent.state === "paid" || intent.state === "expired") return reply(200, {state: intent.state});
    try {
      let value: StripeObject;
      if (intent.session_id) {
        value = await deps.provider.retrieveCheckout(intent.session_id);
        let evidence = checkoutEvidence(value, intent);
        if (evidence.session_id !== intent.session_id) throw new StripeBoundaryError("reconcile");
        if (body.action === "expire" && evidence.state === "session_open") {
          // Expiry can race payment. Always retrieve after the attempt, including a failed expiry response.
          try { await deps.provider.expireCheckout(intent.session_id, `lrv-expire-${intent.id}`); } catch { /* Authoritative retrieval below decides the state. */ }
          value = await deps.provider.retrieveCheckout(intent.session_id);
          evidence = checkoutEvidence(value, intent);
          if (evidence.session_id !== intent.session_id) throw new StripeBoundaryError("reconcile");
        }
      } else {
        if (body.action === "expire" || !intent.current_source_matches || intent.state !== "prepared") return reply(409, {state: "reconciliation"});
        value = await deps.provider.createCheckout(intent);
      }
      const evidence = checkoutEvidence(value, intent);
      const disposition = await deps.apply(intent, evidence, await observationId(intent, evidence));
      if (disposition !== "accepted" || evidence.state === "reconciliation") return reply(409, {state: "reconciliation"});
      return reply(200, {state: evidence.state, client_url: body.action === "expire" ? null : evidence.client_url});
    } catch (error) {
      if (error instanceof StripeBoundaryError && error.code === "reconcile") return reply(409, {state: "reconciliation"});
      // Includes a lost DB acknowledgement after Stripe accepted creation. Stable request remains recoverable.
      return reply(202, {state: "uncertain", request_id: intent.id});
    }
  };
}
