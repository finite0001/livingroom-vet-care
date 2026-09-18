import { boundedBody } from "./verification.ts";
import type { InboundAttachmentMetadata } from "./attachment-metadata.ts";
import type { CapturedInboundAttachment } from "./resend-attachment.ts";
export interface InboundCaptureReceipt {
  id: string;
  inbound_id: string;
  attachment_id: string;
  message_id: string;
  inbound_version: number;
  status: "ready";
  sha256: string;
  byte_length: number;
  mime_type: string;
}
export interface InboundCaptureLease {
  id: string;
  inbound_id: string;
  attachment_id: string;
  message_id: string;
  inbound_version: number;
  actor_id: string;
  email_id: string;
  token: string;
  storage_path: string;
  metadata: InboundAttachmentMetadata;
}
export interface InboundCaptureDependencies {
  authenticate(token: string): Promise<string | null>;
  claim(input: { inboundId: string; attachmentId: string; version: number; actorId: string }): Promise<{
    ready: InboundCaptureReceipt | null;
    lease: InboundCaptureLease | null;
  }>;
  retrieve(emailId: string, metadata: InboundAttachmentMetadata): Promise<CapturedInboundAttachment>;
  store(path: string, captured: CapturedInboundAttachment): Promise<void>;
  finalize(lease: InboundCaptureLease, captured: CapturedInboundAttachment): Promise<unknown>;
}
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const headers = { "Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization,apikey,content-type,x-client-info" };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers });
function receipt(value: unknown, inboundId: string, attachmentId: string, version: number): InboundCaptureReceipt {
  if (!record(value) || !uuid(value.id) || value.inbound_id !== inboundId || value.attachment_id !== attachmentId ||
    value.inbound_version !== version || !uuid(value.message_id) || value.status !== "ready" || !hash(value.sha256) ||
    typeof value.byte_length !== "number" || !Number.isSafeInteger(value.byte_length) || value.byte_length < 1 || value.byte_length > 10485760 ||
    typeof value.mime_type !== "string" || !["application/pdf", "image/png", "image/jpeg"].includes(value.mime_type))
    throw new Error("Unconfirmed capture receipt");
  return { id: value.id, inbound_id: inboundId, attachment_id: attachmentId, message_id: value.message_id,
    inbound_version: version, status: "ready", sha256: value.sha256, byte_length: value.byte_length, mime_type: value.mime_type };
}
/** Database claim/finalize must enforce current staff access, inbound association and exact lease. */
export function createInboundAttachmentCaptureHandler(deps: InboundCaptureDependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method === "OPTIONS") return new Response(null, { headers });
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const authorization = request.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer ")) return json({ error: "Staff authorization required" }, 401);
    try {
      const actor = await deps.authenticate(authorization.slice(7));
      if (!actor) return json({ error: "Staff authorization required" }, 401);
      let input: unknown;
      try { input = JSON.parse(await boundedBody(request, 1024)); } catch { return json({ error: "Exact incoming attachment identity required" }, 400); }
      if (!record(input) || Object.keys(input).length !== 3 || !uuid(input.inbound_id) || !uuid(input.attachment_id) ||
        typeof input.version !== "number" || !Number.isSafeInteger(input.version) || input.version < 1)
        return json({ error: "Exact incoming attachment identity required" }, 400);
      const result = await deps.claim({ inboundId: input.inbound_id, attachmentId: input.attachment_id, version: input.version, actorId: actor });
      if (result.ready) {
        if (result.lease) throw new Error("Ambiguous capture state");
        return json(receipt(result.ready, input.inbound_id, input.attachment_id, input.version));
      }
      const lease = result.lease;
      if (!lease || !uuid(lease.id) || !uuid(lease.token) || !uuid(lease.email_id) || !uuid(lease.message_id) ||
        lease.actor_id !== actor || lease.inbound_id !== input.inbound_id || lease.attachment_id !== input.attachment_id ||
        lease.inbound_version !== input.version || lease.metadata.id !== input.attachment_id ||
        lease.storage_path !== `${input.inbound_id}/${input.attachment_id}/${lease.token}/original`)
        throw new Error("Capture lease unavailable");
      const captured = await deps.retrieve(lease.email_id, lease.metadata);
      if (!hash(captured.sha256) || captured.bytes.length !== lease.metadata.size || captured.mimeType !== lease.metadata.content_type || captured.filename !== lease.metadata.filename)
        throw new Error("Retrieved file differs from saved metadata");
      await deps.store(lease.storage_path, captured);
      const finalized = receipt(await deps.finalize(lease, captured), input.inbound_id, input.attachment_id, input.version);
      if (finalized.id !== lease.id || finalized.message_id !== lease.message_id || finalized.sha256 !== captured.sha256 ||
        finalized.byte_length !== captured.bytes.length || finalized.mime_type !== captured.mimeType)
        throw new Error("Capture acknowledgment differs");
      return json(finalized);
    } catch { return json({ error: "Incoming file capture is unconfirmed. Recover this same attachment." }, 503); }
  };
}
