import { boundedBody } from "./verification.ts";
import { verifyConversationAttachmentBytes } from "../verify-conversation-attachment.ts";

export interface IncomingReadContext {
  id: string;
  message_id: string;
  storage_path: string;
  sha256: string;
  byte_length: number;
  mime_type: string;
  filename: string | null;
}
export interface IncomingReadDependencies {
  authenticate(token: string): Promise<string | null>;
  /** Must require active staff and the current saved inbound/message association. */
  authorize(actorId: string, captureId: string, messageId: string): Promise<IncomingReadContext>;
  download(path: string): Promise<Blob>;
}
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const headers = { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization,apikey,content-type,x-client-info", "X-Content-Type-Options": "nosniff" };
const failure = (status: number) => Response.json({ error: "Incoming file is unavailable" }, { status, headers });
function validate(context: IncomingReadContext, captureId: string, messageId: string): void {
  const parts = context.storage_path?.split("/");
  if (context.id !== captureId || context.message_id !== messageId ||
    parts?.length !== 4 || parts[3] !== "original" || !parts.slice(0, 3).every(uuid) ||
    !/^[a-f0-9]{64}$/.test(context.sha256) || !Number.isSafeInteger(context.byte_length) || context.byte_length < 1 || context.byte_length > 10485760 ||
    !["application/pdf", "image/png", "image/jpeg"].includes(context.mime_type) ||
    (context.filename !== null && (typeof context.filename !== "string" || context.filename.length < 1 || context.filename.length > 255 || [...context.filename].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127))))
    throw new Error("Invalid private original context");
}
/** No signed Storage capability escapes this handler; return verified bytes only. */
export function createIncomingAttachmentReadHandler(deps: IncomingReadDependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method === "OPTIONS") return new Response(null, { headers });
    if (request.method !== "POST") return failure(405);
    const token = request.headers.get("Authorization")?.match(/^Bearer (.+)$/)?.[1];
    if (!token) return failure(401);
    try {
      const actor = await deps.authenticate(token);
      if (!actor) return failure(401);
      let input: unknown;
      try { input = JSON.parse(await boundedBody(request, 1024)); } catch { return failure(400); }
      if (!input || typeof input !== "object" || Array.isArray(input)) return failure(400);
      const body = input as Record<string, unknown>;
      if (Object.keys(body).length !== 2 || !uuid(body.capture_id) || !uuid(body.message_id)) return failure(400);
      const context = await deps.authorize(actor, body.capture_id, body.message_id);
      validate(context, body.capture_id, body.message_id);
      const blob = await deps.download(context.storage_path);
      const digest = await verifyConversationAttachmentBytes(blob, context);
      if (digest !== context.sha256) throw new Error("Original bytes changed");
      const current = await deps.authorize(actor, body.capture_id, body.message_id);
      validate(current, body.capture_id, body.message_id);
      for (const key of ["id", "message_id", "storage_path", "sha256", "byte_length", "mime_type", "filename"] as const) {
        if (current[key] !== context[key]) throw new Error("Original association changed");
      }
      const filename = (context.filename || "attachment").replace(/[\\/]/g, "_");
      // RFC 5987 encoding keeps quotes and non-ASCII names out of raw headers.
      const encoded = encodeURIComponent(filename).replace(/['()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
      return new Response(blob, { headers: { ...headers, "Content-Type": context.mime_type, "Content-Length": String(context.byte_length), "Content-Disposition": `attachment; filename*=UTF-8''${encoded}`, "Access-Control-Expose-Headers": "Content-Disposition" } });
    } catch { return failure(404); }
  };
}
