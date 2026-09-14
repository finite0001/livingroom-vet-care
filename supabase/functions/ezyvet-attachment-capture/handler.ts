import { configuration, createAdapter, ImportError, type AdapterDependencies } from "../ezyvet-import/adapter.ts";
import { readAttachmentForCapture } from "../ezyvet-import/attachment-capture-read.ts";
import { readAttachmentBytes, type AttachmentBytes } from "../ezyvet-import/attachment-bytes.ts";
import { hash, uuid, object, same, parseRecovery, parseLease, parseIntent, parseCapture, type Identity, type Intent, type Lease, type Capture } from "./contract.ts";
export interface CaptureGateway {
  authenticate: (bearer: string) => Promise<{ id: string; activeAdmin: boolean } | null>;
  recover: (id: string, pet: string, bearer: string) => Promise<unknown>;
  claim: (identity: Identity) => Promise<unknown>;
  reserve: (args: Record<string, unknown>) => Promise<unknown>;
  complete: (args: Record<string, unknown>) => Promise<unknown>;
  fail: (args: Record<string, unknown>) => Promise<void>;
  read: (path: string, bearer: string, signal: AbortSignal) => Promise<Response | null>;
  upload: (path: string, bytes: Uint8Array<ArrayBuffer>, mime: string, bearer: string, signal: AbortSignal) => Promise<void>;
}
export interface CaptureDependencies extends AdapterDependencies { env: (name: string) => string | undefined; gateway: CaptureGateway; }
export async function requestBody(request: Request): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) throw new ImportError("INVALID_REQUEST");
  const chunks: Uint8Array[] = []; let length = 0;
  let abort!: () => void;
  const signal = AbortSignal.timeout(5000);
  const timeout = new Promise<never>((_, reject) => { abort = () => reject(new ImportError("INVALID_REQUEST")); signal.addEventListener("abort", abort, { once: true }); });
  try {
    while (true) {
      const chunk = await Promise.race([reader.read(), timeout]); if (chunk.done) break;
      length += chunk.value.length; if (length > 2048) throw new ImportError("INVALID_REQUEST"); chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  } catch { void reader.cancel().catch(() => {}); throw new ImportError("INVALID_REQUEST"); }
  finally { signal.removeEventListener("abort", abort); reader.releaseLock(); }
}
const permanent = new Set(["UPSTREAM_SCOPE_DENIED", "SOURCE_ATTACHMENT_STALE", "SOURCE_ATTACHMENT_PARENT_STALE", "SOURCE_ATTACHMENT_METADATA_CHANGED", "ATTACHMENT_UNSUPPORTED_TYPE", "ATTACHMENT_INVALID_CONTENT", "ATTACHMENT_TOO_LARGE"]);
export function createCaptureHandler(deps: CaptureDependencies) {
  return async (request: Request): Promise<Response> => {
    let origin: string; try { origin = new URL(deps.env("APP_URL") || "").origin; } catch { return new Response(null, { status: 503 }); }
    const headers = { "Content-Type": "application/json", "Cache-Control": "no-store", Vary: "Origin", "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
    const respond = (value: unknown, status: number) => new Response(JSON.stringify(value), { status, headers });
    if (request.headers.get("Origin") && request.headers.get("Origin") !== origin) return respond({ error: "ORIGIN_DENIED" }, 403);
    if (request.method === "OPTIONS") return new Response(null, { headers });
    if (request.method !== "POST") return respond({ error: "METHOD_NOT_ALLOWED" }, 405);
    const authorization = request.headers.get("Authorization"); if (!authorization?.startsWith("Bearer ")) return respond({ error: "UNAUTHORIZED" }, 401);
    const bearer = authorization.slice(7);
    if (!bearer.trim() || bearer.length > 16384) return respond({ error: "UNAUTHORIZED" }, 401);
    let identity: Identity | null = null, lease: Lease | null = null;
    let config: ReturnType<typeof configuration> | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const success = (capture: Capture) => respond({ request_id: capture.request_id, status: "captured", capture_hash: capture.capture_hash }, 200);
    try {
      const user = await deps.gateway.authenticate(bearer);
      if (!user) return respond({ error: "UNAUTHORIZED" }, 401);
      if (user.activeAdmin !== true || typeof user.id !== "string" || !uuid.test(user.id)) return respond({ error: "ACTIVE_ADMIN_REQUIRED" }, 403);
      if (deps.env("EZYVET_ATTACHMENT_CAPTURE_ENABLED") !== "true") throw new ImportError("CAPTURE_DISABLED");
      config = configuration(deps.env);
      if (!config.readResources.includes("attachment")) throw new ImportError("CAPTURE_DISABLED");
      const body = await requestBody(request);
      if (Object.keys(body).length !== 3 || Object.keys(body).some(k => !["request_id", "pet_id", "request_hash"].includes(k)) || typeof body.request_id !== "string" || !uuid.test(body.request_id) || typeof body.pet_id !== "string" || !uuid.test(body.pet_id) || typeof body.request_hash !== "string" || !hash.test(body.request_hash)) throw new ImportError("INVALID_REQUEST");
      identity = { id: body.request_id, pet: body.pet_id, requestHash: body.request_hash, actor: user.id };
      const recoveredRequest = await deps.gateway.recover(identity.id, identity.pet, bearer);
      if (recoveredRequest === null) return respond({ error: "REQUEST_NOT_FOUND" }, 404);
      const saved = parseRecovery(recoveredRequest, identity, config);
      if (saved.capture) return success(saved.capture);
      if (saved.status === "abandoned") return respond({ error: "REQUEST_ABANDONED", retry_safe: false }, 409);
      const claim = object(await deps.gateway.claim(identity));
      if (claim.status === "captured") {
        const completed = parseRecovery(await deps.gateway.recover(identity.id, identity.pet, bearer), identity, config);
        if (!completed.capture) throw new ImportError("CAPTURE_RESPONSE_INVALID");
        return success(completed.capture);
      }
      lease = parseLease(claim, identity, saved.source, deps.now());
      timer = setTimeout(() => controller.abort(), Math.max(1, Math.min(60_000, Date.parse(lease.lease_until) - deps.now() - 2000)));
      const adapter = createAdapter(config, { ...deps, fetch: (input, init) => deps.fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal }) });
      const source = lease.source;
      let intent = lease.intent;
      let file: AttachmentBytes | null = null;
      const readStored = async (reserved: Intent) => {
        const response = await deps.gateway.read(reserved.object_path, bearer, controller.signal);
        if (!response) return null;
        const result = await readAttachmentBytes(response, reserved.mime_type, controller.signal);
        if (result.sha256 !== reserved.content_sha256 || result.size !== reserved.file_size || result.mimeType !== reserved.mime_type) throw new ImportError("ATTACHMENT_INVALID_CONTENT");
        return result;
      };
      if (intent) file = await readStored(intent);
      if (!file) {
        const downloaded = await readAttachmentForCapture(adapter, source.attachment_external_id, source.parent, source.attachment_metadata);
        if (intent) {
          if (downloaded.file.sha256 !== intent.content_sha256 || downloaded.file.size !== intent.file_size || downloaded.file.mimeType !== intent.mime_type) throw new ImportError("SOURCE_ATTACHMENT_METADATA_CHANGED");
        } else {
          intent = parseIntent(await deps.gateway.reserve({ p_id: identity.id, p_actor: identity.actor, p_lease_id: lease.lease_id, p_request_hash: identity.requestHash,
            p_content_sha256: downloaded.file.sha256, p_file_size: downloaded.file.size, p_mime_type: downloaded.file.mimeType, p_before_metadata: downloaded.before, p_after_metadata: downloaded.after }), identity, source);
          if (intent.content_sha256 !== downloaded.file.sha256 || intent.file_size !== downloaded.file.size || intent.mime_type !== downloaded.file.mimeType) throw new ImportError("CAPTURE_RESPONSE_INVALID");
        }
        // A failed/unknown upload reply is resolved by reading the reserved object, never by overwriting it.
        try { await deps.gateway.upload(intent.object_path, downloaded.file.bytes, downloaded.file.mimeType, bearer, controller.signal); } catch { /* Readback is authoritative. */ }
        file = await readStored(intent);
        if (!file) throw new ImportError("STORAGE_UNAVAILABLE");
      }
      if (!intent || !file) throw new ImportError("CAPTURE_RESPONSE_INVALID");
      const final = await adapter.attachmentMetadata(source.attachment_external_id, source.parent);
      if (!same(final.payload, source.attachment_metadata)) throw new ImportError("SOURCE_ATTACHMENT_METADATA_CHANGED");
      if (controller.signal.aborted) throw new ImportError("UPSTREAM_UNAVAILABLE");
      const capture = parseCapture(await deps.gateway.complete({ p_id: identity.id, p_actor: identity.actor, p_lease_id: lease.lease_id, p_request_hash: identity.requestHash,
        p_intent_hash: intent.intent_hash, p_verified_sha256: file.sha256, p_verified_size: file.size, p_verified_mime: file.mimeType, p_final_metadata: final.payload }), identity, intent);
      return success(capture);
    } catch (error) {
      // Complete may have committed before its response was lost. Check the owned receipt before publishing failure.
      if (identity && lease && config) {
        try {
          const recovered = parseRecovery(await deps.gateway.recover(identity.id, identity.pet, bearer), identity, config);
          if (recovered.capture) return success(recovered.capture);
        } catch { /* Preserve the original failure without exposing transport details. */ }
      }
      const dbCode = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      let code = error instanceof ImportError ? error.code : dbCode === "42501" ? "ACCESS_DENIED" : dbCode === "55P03" ? "CAPTURE_BUSY" : dbCode === "40001" || dbCode === "23514" ? "CAPTURE_CONTEXT_CHANGED" : "STORAGE_UNAVAILABLE";
      const seconds = code === "RATE_LIMITED" && error instanceof ImportError ? Math.max(1, Math.min(3600, Math.ceil(error.retryAfter || 60))) : 30;
      if (identity && lease && !["ACCESS_DENIED", "CAPTURE_BUSY", "CAPTURE_CONTEXT_CHANGED"].includes(code)) {
        const failureCode = permanent.has(code) || ["RATE_LIMITED", "UPSTREAM_AUTH_FAILED", "UPSTREAM_UNAVAILABLE", "STORAGE_UNAVAILABLE"].includes(code) ? code : "STORAGE_UNAVAILABLE";
        try { await deps.gateway.fail({ p_id: identity.id, p_actor: identity.actor, p_lease_id: lease.lease_id, p_request_hash: identity.requestHash, p_code: failureCode, p_retry_seconds: permanent.has(failureCode) ? 0 : seconds }); } catch { /* Lost/stale failure acknowledgment remains recoverable through the durable request. */ }
      }
      if (!["INVALID_REQUEST", "CAPTURE_DISABLED", "IMPORT_DISABLED", "INVALID_API_HOST", "PRODUCTION_SOURCE_DISABLED", "CAPTURE_BUSY", "CAPTURE_CONTEXT_CHANGED", "ACCESS_DENIED", "RATE_LIMITED", "UPSTREAM_AUTH_FAILED", "UPSTREAM_UNAVAILABLE", "STORAGE_UNAVAILABLE", "CAPTURE_RESPONSE_INVALID", ...permanent].includes(code)) code = "CAPTURE_UNAVAILABLE";
      const status = code === "INVALID_REQUEST" ? 400 : code === "ACCESS_DENIED" ? 403 : code === "RATE_LIMITED" ? 429 : code === "CAPTURE_BUSY" || code === "CAPTURE_CONTEXT_CHANGED" || permanent.has(code) ? 409 : 503;
      return respond({ error: code, retry_safe: ["CAPTURE_BUSY", "RATE_LIMITED", "UPSTREAM_AUTH_FAILED", "UPSTREAM_UNAVAILABLE", "STORAGE_UNAVAILABLE", "CAPTURE_UNAVAILABLE"].includes(code), ...(code === "RATE_LIMITED" || code === "CAPTURE_BUSY" ? { retry_after: seconds } : {}) }, status);
    } finally { if (timer) clearTimeout(timer); controller.abort(); }
  };
}
