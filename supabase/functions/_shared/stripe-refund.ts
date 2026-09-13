import {refundEvidence, StripeBoundaryError} from "./stripe-provider.ts";
import type {RefundIntent, RefundEvidence, StripeObject} from "./stripe-provider.ts";
export interface RefundContext extends RefundIntent {
  actor_id: string;
  state: "pending" | "failed" | "succeeded" | "reconciliation";
  refund_id: string | null;
}
export interface RefundDependencies {
  origin: string;
  enabled: boolean;
  refundsEnabled: boolean;
  authenticate: (token: string) => Promise<string | null>;
  context: (requestId: string, actorId: string) => Promise<RefundContext>;
  create: (intent: RefundIntent) => Promise<StripeObject>;
  retrieve: (id: string) => Promise<StripeObject>;
  quarantine: (requestId: string, reason: "provider_context_mismatch" | "provider_reconciliation_required") => Promise<void>;
  apply: (intent: RefundIntent, evidence: RefundEvidence, eventId: string) => Promise<"accepted" | "quarantined">;
}
export function createStripeRefundHandler(deps: RefundDependencies) {
  return async (request: Request): Promise<Response> => {
    const headers = {"Content-Type": "application/json", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "Access-Control-Allow-Origin": deps.origin, Vary: "Origin"};
    const reply = (status: number, value: object) => new Response(JSON.stringify(value), {status, headers});
    if (request.headers.get("Origin") && request.headers.get("Origin") !== deps.origin) return reply(403, {error: "unavailable"});
    if (request.method === "OPTIONS") return new Response(null, {status: 204, headers: {...headers, "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "authorization,content-type,apikey,x-client-info"}});
    if (request.method !== "POST") return reply(405, {error: "unavailable"});
    if (!deps.enabled) return reply(503, {error: "payments_disabled"});
    const token = request.headers.get("Authorization")?.match(/^Bearer (\S+)$/)?.[1];
    if (!token) return reply(401, {error: "unauthorized"});
    let actor: string | null;
    try {actor = await deps.authenticate(token);} catch {return reply(503, {error: "unavailable"});}
    if (!actor) return reply(401, {error: "unauthorized"});
    let requestId: string;
    try {
      if (!request.body) throw new Error("body");
      const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      try {
        for (;;) {const chunk = await reader.read(); if(chunk.done) break; size += chunk.value.length; if(size>1024) {await reader.cancel(); return reply(413, {error: "invalid_request"});} chunks.push(chunk.value);}
      } finally {reader.releaseLock();}
      const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.length;}
      const body = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes));
      if (!body || Object.keys(body).sort().join(",") !== "action,p_request_id" || !["create", "recover"].includes(body.action) ||
          typeof body.p_request_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.p_request_id)) throw new Error("body");
      requestId = body.p_request_id;
    } catch {return reply(400, {error: "invalid_request"});}
    let intent: RefundContext;
    try {intent = await deps.context(requestId, actor);} catch {return reply(404, {error: "refund_unavailable"});}
    if (intent.id !== requestId || intent.actor_id !== actor) return reply(404, {error: "refund_unavailable"});
    if (intent.state === "reconciliation") return reply(409, {state: "reconciliation"});
    if (intent.state === "failed" || intent.state === "succeeded") return reply(200, {state: intent.state});
    if (!intent.refund_id && !deps.refundsEnabled) return reply(409, {state: "refunds_paused"});
    try {
      const value = intent.refund_id ? await deps.retrieve(intent.refund_id) : await deps.create(intent);
      let evidence: RefundEvidence;
      try {
        evidence = refundEvidence(value, intent);
        if (intent.refund_id && evidence.refund_id !== intent.refund_id) throw new Error("mismatch");
      } catch {
        await deps.quarantine(intent.id, "provider_context_mismatch");
        return reply(409, {state: "reconciliation", request_id: intent.id});
      }
      const bytes = new TextEncoder().encode(JSON.stringify([intent.id, intent.account_id, intent.livemode, evidence]));
      const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
      const eventId = "observe-refund:" + Array.from(hash, byte => byte.toString(16).padStart(2,"0")).join("");
      if (await deps.apply(intent, evidence, eventId) !== "accepted") return reply(409, {state: "reconciliation"});
      return reply(200, {state: evidence.status});
    } catch (error) {
      if (error instanceof StripeBoundaryError && error.code === "reconcile") {
        try {await deps.quarantine(intent.id, "provider_reconciliation_required");}
        catch {return reply(202, {state: "uncertain", request_id: intent.id});}
        return reply(409, {state: "reconciliation", request_id: intent.id});
      }
      return reply(202, {state: "uncertain", request_id: intent.id});
    }
  };
}
