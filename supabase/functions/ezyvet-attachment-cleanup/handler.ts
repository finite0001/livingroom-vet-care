import { requestBody } from "../ezyvet-attachment-capture/handler.ts";
import { object, uuid, hash, parseIntent, type Identity, type Intent, type Source } from "../ezyvet-attachment-capture/contract.ts";
import { ImportError } from "../ezyvet-import/import-error.ts";

export interface CleanupGateway {
  authenticate: (bearer: string) => Promise<{ id: string; activeAdmin: boolean } | null>;
  rpc: (name: string, args: Record<string, unknown>, bearer?: string) => Promise<unknown>;
  remove: (path: string, bearer: string, signal: AbortSignal) => Promise<void>;
  read: (path: string, bearer: string, signal: AbortSignal) => Promise<Response | null>;
}
export interface CleanupDependencies { env: (name: string) => string | undefined; now: () => number; gateway: CleanupGateway; }
interface CleanupIdentity extends Identity { cleanup: string; }
interface Receipt { cleanup_id: string; request_id: string; verified_absent_at: string; }
const invalid = (): never => { throw new ImportError("CLEANUP_RESPONSE_INVALID"); };
function timestamp(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return invalid();
  return value;
}
function receipt(value: unknown, identity: CleanupIdentity, intent: Intent): Receipt | null {
  if (value === null) return null;
  const r = object(value);
  if (r.cleanup_id !== identity.cleanup || r.request_id !== identity.id || r.actor_id !== identity.actor || r.intent_hash !== intent.intent_hash) return invalid();
  return { cleanup_id: identity.cleanup, request_id: identity.id, verified_absent_at: timestamp(r.verified_absent_at) };
}
function attempt(value: unknown, identity: CleanupIdentity, intent: Intent) {
  const a = object(value);
  if (a.id !== identity.cleanup || a.request_id !== identity.id || a.actor_id !== identity.actor || a.pet_id !== identity.pet || a.request_hash !== identity.requestHash || a.intent_hash !== intent.intent_hash) return invalid();
  timestamp(a.created_at); timestamp(a.lease_until);
  return a;
}
export function createCleanupHandler(deps: CleanupDependencies) {
  return async (request: Request): Promise<Response> => {
    let origin: string;
    try { const url = new URL(deps.env("APP_URL") || ""); if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error(); origin = url.origin; }
    catch { return new Response(null, { status: 503 }); }
    const headers = { "Content-Type": "application/json", "Cache-Control": "no-store", Vary: "Origin", "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
    const respond = (value: unknown, status: number) => new Response(JSON.stringify(value), { status, headers });
    if (request.headers.get("Origin") && request.headers.get("Origin") !== origin) return respond({ error: "ORIGIN_DENIED" }, 403);
    if (request.method === "OPTIONS") return new Response(null, { headers });
    if (request.method !== "POST") return respond({ error: "METHOD_NOT_ALLOWED" }, 405);
    const authorization = request.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer ") || !authorization.slice(7).trim() || authorization.length > 16391) return respond({ error: "UNAUTHORIZED" }, 401);
    const bearer = authorization.slice(7), controller = new AbortController();
    let identity: CleanupIdentity | null = null, intent: Intent | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const success = (saved: Receipt) => respond({ ...saved, status: "cleanup_recorded" }, 200);
    const recover = async (owned: CleanupIdentity, reserved: Intent) => {
      const value = await deps.gateway.rpc("recover_ezyvet_attachment_cleanup", { p_cleanup_id: owned.cleanup, p_id: owned.id, p_pet_id: owned.pet }, bearer);
      if (value === null) return null;
      const result = object(value); attempt(result.attempt, owned, reserved);
      return receipt(result.receipt, owned, reserved);
    };
    try {
      const user = await deps.gateway.authenticate(bearer);
      if (!user) return respond({ error: "UNAUTHORIZED" }, 401);
      if (user.activeAdmin !== true || typeof user.id !== "string" || !uuid.test(user.id)) return respond({ error: "ACTIVE_ADMIN_REQUIRED" }, 403);
      if (deps.env("APP_ENV") !== "staging" || deps.env("EZYVET_ATTACHMENT_CLEANUP_ENABLED") !== "true") throw new ImportError("CLEANUP_DISABLED");
      const body = await requestBody(request);
      if (Object.keys(body).length !== 4 || Object.keys(body).some(k => !["cleanup_id", "request_id", "pet_id", "request_hash"].includes(k)) ||
        typeof body.cleanup_id !== "string" || !uuid.test(body.cleanup_id) || typeof body.request_id !== "string" || !uuid.test(body.request_id) || typeof body.pet_id !== "string" || !uuid.test(body.pet_id) || typeof body.request_hash !== "string" || !hash.test(body.request_hash)) throw new ImportError("INVALID_REQUEST");
      identity = { cleanup: body.cleanup_id, id: body.request_id, pet: body.pet_id, requestHash: body.request_hash, actor: user.id };
      const value = await deps.gateway.rpc("recover_ezyvet_attachment_download", { p_id: identity.id, p_pet_id: identity.pet }, bearer);
      if (value === null) return respond({ error: "REQUEST_NOT_FOUND" }, 404);
      const saved = object(value), r = object(saved.request);
      if (r.id !== identity.id || r.actor_id !== identity.actor || r.pet_id !== identity.pet || r.request_hash !== identity.requestHash) invalid();
      if (r.status !== "abandoned" || saved.capture !== null || saved.capture_intent === null) throw new ImportError("CLEANUP_NOT_ELIGIBLE");
      // Cleanup uses retained evidence, never current provider credentials or source reads.
      intent = parseIntent(saved.capture_intent, identity, object(r.source_context) as Source);
      const previous = await recover(identity, intent); if (previous) return success(previous);
      const claim = object(await deps.gateway.rpc("claim_ezyvet_attachment_cleanup", { p_cleanup_id: identity.cleanup, p_id: identity.id, p_actor: identity.actor, p_pet_id: identity.pet, p_request_hash: identity.requestHash }));
      const lease = attempt(claim.attempt, identity, intent);
      if (claim.bucket !== intent.bucket || claim.object_path !== intent.object_path || typeof lease.lease_id !== "string" || !uuid.test(lease.lease_id)) invalid();
      const claimedReceipt = receipt(claim.receipt, identity, intent); if (claimedReceipt) return success(claimedReceipt);
      const remaining = Date.parse(String(lease.lease_until)) - deps.now() - 2000;
      if (remaining <= 0) throw new ImportError("CLEANUP_LEASE_EXPIRED");
      timer = setTimeout(() => controller.abort(), Math.min(45_000, remaining));
      // An unknown DELETE acknowledgment is resolved through Storage, not by assuming failure.
      try { await deps.gateway.remove(intent.object_path, bearer, controller.signal); } catch { /* Readback and SQL remain authoritative. */ }
      const present = await deps.gateway.read(intent.object_path, bearer, controller.signal);
      if (present) { void present.body?.cancel().catch(() => {}); throw new ImportError("STORAGE_UNAVAILABLE"); }
      if (controller.signal.aborted) throw new ImportError("STORAGE_UNAVAILABLE");
      const completed = receipt(await deps.gateway.rpc("complete_ezyvet_attachment_cleanup", { p_cleanup_id: identity.cleanup, p_id: identity.id, p_actor: identity.actor, p_lease_id: lease.lease_id, p_request_hash: identity.requestHash, p_intent_hash: intent.intent_hash, p_verified_absent: true }), identity, intent);
      if (!completed) return invalid();
      return success(completed);
    } catch (error) {
      if (identity && intent) { try { const saved = await recover(identity, intent); if (saved) return success(saved); } catch { /* Do not expose transport details. */ } }
      const db = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      const raw = error instanceof ImportError ? error.code : db === "42501" ? "ACCESS_DENIED" : db === "55P03" ? "CLEANUP_BUSY" : db === "40001" ? "CLEANUP_LEASE_EXPIRED" : db === "23514" ? "CLEANUP_NOT_ELIGIBLE" : "STORAGE_UNAVAILABLE";
      const allowed = ["INVALID_REQUEST", "CLEANUP_DISABLED", "CLEANUP_NOT_ELIGIBLE", "CLEANUP_RESPONSE_INVALID", "CLEANUP_LEASE_EXPIRED", "CLEANUP_BUSY", "ACCESS_DENIED", "STORAGE_UNAVAILABLE"];
      const code = allowed.includes(raw) ? raw : "CLEANUP_UNAVAILABLE";
      return respond({ error: code, retry_safe: ["CLEANUP_BUSY", "STORAGE_UNAVAILABLE", "CLEANUP_UNAVAILABLE"].includes(code) }, code === "INVALID_REQUEST" ? 400 : code === "ACCESS_DENIED" ? 403 : ["CLEANUP_NOT_ELIGIBLE", "CLEANUP_LEASE_EXPIRED", "CLEANUP_BUSY"].includes(code) ? 409 : 503);
    } finally { if (timer) clearTimeout(timer); controller.abort(); }
  };
}
