import { configuration, createAdapter, ImportError } from "../ezyvet-import/adapter.ts";
import { attachmentMime, readAttachmentBytes, type AttachmentBytes } from "../ezyvet-import/attachment-bytes.ts";
import type { AttachmentObservation } from "../ezyvet-import/attachment-metadata.ts";
import type { CaptureContext, CaptureDependencies, CaptureIntent } from "./types.ts";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digest = /^[a-f0-9]{64}$/;
const terminalCodes = new Set(["SOURCE_ATTACHMENT_METADATA_CHANGED", "SOURCE_ATTACHMENT_PARENT_STALE", "SOURCE_ATTACHMENT_STALE", "ATTACHMENT_UNSUPPORTED_TYPE", "ATTACHMENT_TOO_LARGE", "ATTACHMENT_INVALID_CONTENT", "STORAGE_OBJECT_CHANGED"]);
function checked(value: CaptureContext, id: string, actor: string): CaptureContext {
  if (!value?.request || value.request.id !== id || value.request.requested_by !== actor) throw new ImportError("CAPTURE_CONTEXT_MISMATCH");
  const r = value.request, p = r.parent_context;
  if (!p || p.parent_type !== "Animal" || p.animal_link_id !== r.animal_link_id || p.pet_id !== r.pet_id || p.client_id !== r.client_id || p.parent_external_id !== p.animal_external_id ||
    r.metadata?.id !== r.external_id || r.metadata.file_id !== r.file_id || r.metadata.record_type !== "Animal" || r.metadata.record_id !== p.animal_external_id || !digest.test(r.stable_metadata_sha256)) throw new ImportError("CAPTURE_CONTEXT_MISMATCH");
  if (value.intent) {
    const segments = value.intent.object_path?.split("/") ?? [];
    if (value.intent.bucket_id !== "ezyvet-attachment-originals" || segments.length !== 5 || segments[0] !== actor || segments[1] !== r.pet_id || segments[2] !== id || !uuid.test(segments[3]) || segments[4] !== "original" || !digest.test(value.intent.content_sha256)) throw new ImportError("CAPTURE_CONTEXT_MISMATCH");
  }
  if (r.status === "ready" && (!value.intent || !r.capture || r.capture.request_id !== id || r.capture.entry_method !== "ezyvet_api_attachment_original_v1" || r.capture.content_sha256 !== value.intent.content_sha256 || r.capture.mime_type !== value.intent.mime_type || r.capture.file_size !== value.intent.file_size)) throw new ImportError("CAPTURE_CONTEXT_MISMATCH");
  return value;
}
function sameFile(file: AttachmentBytes, intent: CaptureIntent) {
  if (file.sha256 !== intent.content_sha256 || file.size !== intent.file_size || file.mimeType !== intent.mime_type) throw new ImportError("STORAGE_OBJECT_CHANGED");
}
function sameObservation(observed: AttachmentObservation, context: CaptureContext) {
  const r = context.request;
  // Raw hashes may change when a temporary URL rotates. They are retained separately.
  if (observed.external_id !== r.external_id || observed.file_id !== r.file_id || observed.metadata.record_type !== "Animal" || observed.metadata.record_id !== r.parent_context.animal_external_id || observed.stable_metadata_sha256 !== r.stable_metadata_sha256) throw new ImportError("SOURCE_ATTACHMENT_METADATA_CHANGED");
}
export function createHandler(dependencies: CaptureDependencies) {
  return async (request: Request): Promise<Response> => {
    let origin: string;
    try { origin = new URL(dependencies.env("APP_URL") || "").origin; } catch { return new Response(null, { status: 503 }); }
    const headers = { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS", "Cache-Control": "no-store", Vary: "Origin", "X-Content-Type-Options": "nosniff" };
    const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });
    if (request.headers.get("Origin") && request.headers.get("Origin") !== origin) return respond({ error: "ORIGIN_DENIED" }, 403);
    if (request.method === "OPTIONS") return new Response(null, { headers });
    if (request.method !== "POST") return respond({ error: "METHOD_NOT_ALLOWED" }, 405);
    const authorization = request.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer ")) return respond({ error: "UNAUTHORIZED" }, 401);
    const bearer = authorization.slice(7);
    let actor = "", id = "", context: CaptureContext | null = null, action = "";
    const owned = (value: CaptureContext) => checked(value, id, actor);
    const readStored = async (intent: CaptureIntent): Promise<AttachmentBytes | null> => {
      const response = await dependencies.gateway.readObject(intent);
      if (response === null) return null;
      const file = await readAttachmentBytes(response, intent.mime_type, AbortSignal.timeout(20_000));
      sameFile(file, intent); return file;
    };
    try {
      const user = await dependencies.gateway.authenticate(bearer);
      if (!user) return respond({ error: "UNAUTHORIZED" }, 401);
      if (!user.activeAdmin) return respond({ error: "ACTIVE_ADMIN_REQUIRED" }, 403);
      actor = user.id;
      const reader = request.body?.getReader(); if (!reader) return respond({ error: "INVALID_REQUEST" }, 400);
      const chunks: Uint8Array[] = []; let length = 0;
      try { while (true) { const c = await reader.read(); if (c.done) break; length += c.value.byteLength; if (length > 2048) { void reader.cancel().catch(() => {}); return respond({ error: "INVALID_REQUEST" }, 400); } chunks.push(c.value); } } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(length); let offset = 0; for (const c of chunks) { bytes.set(c, offset); offset += c.length; }
      let body: Record<string, unknown>;
      try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { return respond({ error: "INVALID_REQUEST" }, 400); }
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 2 || typeof body.action !== "string" || !["capture", "retrieve", "discard"].includes(String(body.action)) || typeof body.request_id !== "string" || !uuid.test(body.request_id)) return respond({ error: "INVALID_REQUEST" }, 400);
      id = body.request_id; action = String(body.action);
      context = owned(await dependencies.gateway.context(id, actor));
      const summary = () => ({ request_id: id, status: context!.request.status });
      if (action === "retrieve") {
        if (context.request.status !== "ready" || !context.intent) throw new ImportError("CAPTURE_NOT_READY");
        const file = await readStored(context.intent); if (!file) throw new ImportError("CAPTURE_OBJECT_MISSING");
        const extension = file.mimeType === "application/pdf" ? "pdf" : file.mimeType === "image/png" ? "png" : "jpg";
        return new Response(file.bytes, { headers: { ...headers, "Content-Type": file.mimeType, "Content-Length": String(file.size), "Content-Disposition": `attachment; filename="ezyvet-original-${id}.${extension}"` } });
      }
      if (action === "discard") {
        context = owned(await dependencies.gateway.beginDiscard(id, actor));
        if (context.request.status === "abandoned") return respond(summary());
        if (context.request.status !== "discarding") throw new ImportError("CAPTURE_NOT_DISCARDABLE");
        if (context.intent) {
          const intent = context.intent;
          context = owned(await dependencies.gateway.context(id, actor));
          if (context.request.status !== "discarding" || context.intent?.id !== intent.id || context.intent.object_path !== intent.object_path) throw new ImportError("CAPTURE_CONTEXT_MISMATCH");
          try { await dependencies.gateway.deleteObject(intent, bearer); }
          catch { const remaining = await dependencies.gateway.readObject(intent); if (remaining !== null) { void remaining.body?.cancel().catch(() => {}); throw new ImportError("STORAGE_UNAVAILABLE"); } }
          const remaining = await dependencies.gateway.readObject(intent);
          if (remaining !== null) { void remaining.body?.cancel().catch(() => {}); throw new ImportError("STORAGE_UNAVAILABLE"); }
        }
        context = owned(await dependencies.gateway.completeDiscard(id, actor));
        return respond(summary());
      }
      if (context.request.status === "ready") return respond(summary());
      context = owned(await dependencies.gateway.claim(id, actor));
      if (context.request.status === "ready") return respond(summary());
      if (!context.lease_id || !["prepared", "reserved"].includes(context.request.status)) throw new ImportError("CAPTURE_NOT_RETRYABLE");
      const lease = context.lease_id;
      let file = context.intent ? await readStored(context.intent) : null;
      if (!file) {
        const config = configuration(dependencies.env), r = context.request;
        if (!config.readResources.includes("attachment") || config.baseUrl !== r.parent_context.source_origin || config.siteUid !== r.parent_context.source_site_uid) throw new ImportError("CAPTURE_SOURCE_NOT_CONFIGURED");
        const adapter = createAdapter(config, dependencies);
        attachmentMime(r.metadata.mime_type ?? null);
        const before = await adapter.attachmentMetadata(r.parent_context.animal_external_id, r.external_id); sameObservation(before, context);
        file = await adapter.downloadAttachment(r.parent_context.animal_external_id, r.external_id, r.metadata.mime_type ?? null);
        const after = await adapter.attachmentMetadata(r.parent_context.animal_external_id, r.external_id); sameObservation(after, context);
        if (context.intent) sameFile(file, context.intent);
        else context = owned(await dependencies.gateway.reserve(id, actor, lease, file, before.raw_record_sha256, after.raw_record_sha256));
        if (!context.intent) throw new ImportError("CAPTURE_CONTEXT_MISMATCH");
        sameFile(file, context.intent);
        try { await dependencies.gateway.uploadObject(context.intent, file.bytes, bearer); }
        catch { /* A lost upload acknowledgement is resolved by reading the immutable reserved object. */ }
        file = await readStored(context.intent);
        if (!file) throw new ImportError("STORAGE_UNAVAILABLE");
      }
      if (!context.intent) throw new ImportError("CAPTURE_CONTEXT_MISMATCH");
      context = owned(await dependencies.gateway.complete(id, actor, lease, context.intent, file));
      if (context.request.status !== "ready") throw new ImportError("CAPTURE_NOT_READY");
      return respond(summary());
    } catch (error) {
      // Never forward provider, database or Storage error bodies.
      const named = error && typeof error === "object" && "message" in error && typeof error.message === "string" && terminalCodes.has(error.message) ? error.message : null;
      const denied = error && typeof error === "object" && "code" in error && error.code === "42501";
      const busy = error && typeof error === "object" && "code" in error && error.code === "55P03";
      let code = error instanceof ImportError ? error.code : named ?? (denied ? "CAPTURE_ACCESS_DENIED" : busy ? "CAPTURE_BUSY" : "CAPTURE_FAILED");
      const failureCodes = new Set([...terminalCodes, "UPSTREAM_UNAVAILABLE", "RATE_LIMITED", "UPSTREAM_AUTH_FAILED", "UPSTREAM_SCOPE_DENIED", "STORAGE_UNAVAILABLE", "CAPTURE_UNAVAILABLE"]);
      if (action === "capture" && context?.lease_id && !failureCodes.has(code)) code = "CAPTURE_UNAVAILABLE";
      const seconds = error instanceof ImportError ? Math.max(2, Math.min(3600, Math.ceil(error.retryAfter || 5))) : 5;
      if (action === "capture" && context?.lease_id) {
        try { await dependencies.gateway.fail(id, actor, context.lease_id, code, terminalCodes.has(code) ? 0 : seconds, terminalCodes.has(code)); } catch { /* Owned lease expiry remains recoverable. */ }
      }
      return respond({ error: code, retry_after_seconds: seconds, retry_safe: !terminalCodes.has(code) }, denied ? 403 : busy || terminalCodes.has(code) || ["CAPTURE_NOT_READY", "CAPTURE_NOT_RETRYABLE", "CAPTURE_NOT_DISCARDABLE"].includes(code) ? 409 : 503);
    }
  };
}
