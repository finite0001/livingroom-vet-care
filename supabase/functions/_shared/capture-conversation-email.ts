import { boundedBody } from "./inbound/verification.ts";
import { buildConversationEmailPayload, type ConversationEmailCapture, type ConversationEmailSender } from "./conversation-email-payload.ts";

export interface ConversationEmailCaptureContext extends ConversationEmailCapture {
  request_id: string;
  captured: boolean;
}
export interface ConversationEmailCaptureDependencies {
  authenticate(token: string): Promise<{
    actorId: string;
    download(path: string): Promise<Blob>;
    readReview(requestId: string): Promise<unknown>;
  } | null>;
  context(requestId: string, actorId: string): Promise<ConversationEmailCaptureContext | null>;
  capture(requestId: string, actorId: string, payloadText: string): Promise<void>;
  sender(): ConversationEmailSender;
}
const headers = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization,apikey,content-type,x-client-info",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Captures a previously prepared request; it never queues or sends a message. */
export function createCaptureConversationEmailHandler(deps: ConversationEmailCaptureDependencies) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response(null, { headers });
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const authorization = req.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer ")) return json({ error: "Staff authorization required" }, 401);
    try {
      const auth = await deps.authenticate(authorization.slice(7));
      if (!auth) return json({ error: "Staff authorization required" }, 401);
      let input: unknown;
      try { input = JSON.parse(await boundedBody(req, 1024)); }
      catch { return json({ error: "Exact prepared request ID required" }, 400); }
      if (!isRecord(input) || Object.keys(input).length !== 1 || typeof input.id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.id))
        return json({ error: "Exact prepared request ID required" }, 400);
      const context = await deps.context(input.id, auth.actorId);
      if (!context || context.request_id !== input.id || context.actor_id !== auth.actorId ||
        typeof context.captured !== "boolean") return json({ error: "Owned prepared email required" }, 403);
      let expectedHash: string | undefined;
      if (!context.captured) {
        const frozen = await buildConversationEmailPayload(context, deps.sender(), auth.download);
        expectedHash = frozen.payload_hash;
        await deps.capture(input.id, auth.actorId, frozen.payload_text);
      }
      // This authenticated read rechecks ownership/staff status after privileged capture.
      const review = await auth.readReview(input.id);
      if (!isRecord(review) || review.request_id !== input.id || review.captured !== true ||
        (review.status !== "prepared" && review.status !== "acknowledged") ||
        typeof review.payload_hash !== "string" || !/^[a-f0-9]{64}$/.test(review.payload_hash) ||
        (expectedHash !== undefined && review.payload_hash !== expectedHash))
        return json({ error: "Capture unconfirmed; recover this same request" }, 503);
      return json(review);
    } catch {
      // Missing bytes, changed staff access and uncertain capture all preserve request identity.
      return json({ error: "Capture unconfirmed; recover this same request" }, 503);
    }
  };
}
