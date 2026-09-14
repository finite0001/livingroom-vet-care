import { createCaptureHandler } from "./handler.ts";
import { ImportError } from "../ezyvet-import/import-error.ts";
import { uuid } from "./contract.ts";

export function attachmentCaptureRuntime(env: (name: string) => string | undefined, transport: typeof fetch = fetch) {
  function base(): string {
    const url = new URL(env("SUPABASE_URL") || "");
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/" || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))) throw new ImportError("CAPTURE_UNAVAILABLE");
    return url.origin;
  }
  const authHeaders = (bearer?: string) => {
    const key = env("SUPABASE_ANON_KEY"), token = bearer === undefined ? env("SUPABASE_SERVICE_ROLE_KEY") : bearer;
    if (!key || !token) throw new ImportError("CAPTURE_UNAVAILABLE");
    return { apikey: key, Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  };
  async function json(response: Response): Promise<unknown> {
    const reader = response.body?.getReader(); if (!reader) throw new ImportError("CAPTURE_RESPONSE_INVALID");
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length; if (size > 8 * 1024 * 1024) throw new ImportError("CAPTURE_RESPONSE_INVALID"); chunks.push(chunk.value); }
      const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch { void reader.cancel().catch(() => {}); throw new ImportError("CAPTURE_RESPONSE_INVALID"); }
    finally { reader.releaseLock(); }
  }
  async function rpc(name: string, args: Record<string, unknown>, bearer?: string): Promise<unknown> {
    const response = await transport(`${base()}/rest/v1/rpc/${name}`, { method: "POST", headers: authHeaders(bearer), body: JSON.stringify(args), redirect: "error", signal: AbortSignal.timeout(10_000) });
    const result = await json(response);
    if (!response.ok) throw { code: result && typeof result === "object" && "code" in result ? String(result.code) : "RPC_UNAVAILABLE" };
    return result;
  }
  function storagePath(path: string): string {
    const parts = path.split("/"); if (parts.length !== 5 || parts[4] !== "original" || parts.slice(0, 4).some(p => !uuid.test(p))) throw new ImportError("CAPTURE_RESPONSE_INVALID");
    return path;
  }
  return createCaptureHandler({ env, fetch: transport, now: Date.now, sleep: milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)), gateway: {
    authenticate: async bearer => {
      const response = await transport(`${base()}/auth/v1/user`, { headers: authHeaders(bearer), redirect: "error", signal: AbortSignal.timeout(10_000) });
      if (response.status === 401 || response.status === 403) { void response.body?.cancel().catch(() => {}); return null; }
      const user = await json(response);
      if (!response.ok || !user || typeof user !== "object" || !("id" in user) || typeof user.id !== "string" || !uuid.test(user.id)) throw new ImportError("CAPTURE_RESPONSE_INVALID");
      return { id: user.id, activeAdmin: await rpc("ezyvet_is_active_admin", { p_actor: user.id }) === true };
    },
    recover: (id, pet, bearer) => rpc("recover_ezyvet_attachment_download", { p_id: id, p_pet_id: pet }, bearer),
    claim: identity => rpc("claim_ezyvet_attachment_download", { p_id: identity.id, p_actor: identity.actor, p_pet_id: identity.pet, p_request_hash: identity.requestHash }),
    reserve: args => rpc("prepare_ezyvet_attachment_capture", args),
    complete: args => rpc("complete_ezyvet_attachment_capture", args),
    fail: async args => { await rpc("fail_ezyvet_attachment_download", args); },
    read: async (path, bearer, signal) => {
      const response = await transport(`${base()}/storage/v1/object/authenticated/ezyvet-attachments/${storagePath(path)}`, { headers: { ...authHeaders(bearer), "Accept-Encoding": "identity" }, redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]) });
      if (response.ok) return response;
      if (response.status === 404) { void response.body?.cancel().catch(() => {}); return null; }
      const problem = await json(response);
      if (response.status === 400 && problem && typeof problem === "object" && "statusCode" in problem && String(problem.statusCode) === "404") return null;
      throw new ImportError("STORAGE_UNAVAILABLE");
    },
    upload: async (path, bytes, mime, bearer, signal) => {
      const response = await transport(`${base()}/storage/v1/object/ezyvet-attachments/${storagePath(path)}`, { method: "POST", headers: { ...authHeaders(bearer), "Content-Type": mime, "x-upsert": "false" }, body: bytes, redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]) });
      void response.body?.cancel().catch(() => {});
      if (!response.ok) throw new ImportError("STORAGE_UNAVAILABLE");
    },
  } });
}
