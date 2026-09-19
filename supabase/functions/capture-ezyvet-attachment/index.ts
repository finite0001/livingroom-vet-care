import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHandler } from "./handler.ts";
import { ImportError } from "../ezyvet-import/adapter.ts";
import type { CaptureContext, CaptureIntent } from "./types.ts";
const url = Deno.env.get("SUPABASE_URL")!;
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
async function rpc(name: string, args: Record<string, unknown>): Promise<CaptureContext> {
  const { data, error } = await admin.rpc(name, args);
  if (error) throw error;
  return data as CaptureContext;
}
const objectPath = (intent: CaptureIntent) => `${encodeURIComponent(intent.bucket_id)}/${intent.object_path.split("/").map(encodeURIComponent).join("/")}`;
const storageFetch = (path: string, init: RequestInit) => fetch(`${url}/storage/v1/${path}`, { ...init, redirect: "error", signal: AbortSignal.timeout(20_000) });
Deno.serve(createHandler({
  env: key => Deno.env.get(key), fetch, now: Date.now, sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  gateway: {
    async authenticate(bearer) {
      const { data, error } = await admin.auth.getUser(bearer);
      if (error || !data.user) return null;
      const { data: active, error: roleError } = await admin.rpc("ezyvet_is_active_admin", { p_actor: data.user.id });
      if (roleError) throw roleError;
      return { id: data.user.id, activeAdmin: active === true };
    },
    context: (id, actor) => rpc("get_ezyvet_attachment_capture_context", { p_id: id, p_actor: actor }),
    claim: (id, actor) => rpc("claim_ezyvet_attachment_capture", { p_id: id, p_actor: actor }),
    reserve: (id, actor, leaseId, file, beforeRaw, afterRaw) => rpc("reserve_ezyvet_attachment_original", { p_id: id, p_actor: actor, p_lease_id: leaseId, p_content_sha256: file.sha256, p_mime_type: file.mimeType, p_file_size: file.size, p_before_raw_sha256: beforeRaw, p_after_raw_sha256: afterRaw }),
    complete: (id, actor, leaseId, intent, file) => rpc("complete_ezyvet_attachment_capture", { p_id: id, p_actor: actor, p_lease_id: leaseId, p_intent_id: intent.id, p_content_sha256: file.sha256, p_mime_type: file.mimeType, p_file_size: file.size }),
    fail: (id, actor, leaseId, code, seconds, terminal) => rpc("fail_ezyvet_attachment_capture", { p_id: id, p_actor: actor, p_lease_id: leaseId, p_code: code, p_retry_seconds: seconds, p_terminal: terminal }),
    beginDiscard: (id, actor) => rpc("begin_discard_ezyvet_attachment_capture", { p_id: id, p_actor: actor }),
    completeDiscard: (id, actor) => rpc("complete_discard_ezyvet_attachment_capture", { p_id: id, p_actor: actor }),
    async readObject(intent) {
      const response = await storageFetch(`object/authenticated/${objectPath(intent)}`, { headers: { Authorization: `Bearer ${key}`, apikey: anonKey, "Accept-Encoding": "identity" } });
      if (response.ok) return response;
      if (response.status === 400 || response.status === 404) {
        // Storage commonly wraps a missing object in HTTP400/statusCode404. Anything else is a failure.
        const reader = response.body?.getReader(); let text = "", size = 0;
        if (reader) { try { while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length; if (size > 4096) { void reader.cancel().catch(() => {}); throw new ImportError("STORAGE_UNAVAILABLE"); } text += new TextDecoder().decode(chunk.value); } } finally { reader.releaseLock(); } }
        try { const error = JSON.parse(text); if (String(error.statusCode) === "404" && (error.error === "not_found" || error.message === "Object not found")) return null; } catch { /* Unknown errors never become absence. */ }
      } else { void response.body?.cancel().catch(() => {}); }
      throw new ImportError("STORAGE_UNAVAILABLE");
    },
    async uploadObject(intent, bytes, bearer) {
      const response = await storageFetch(`object/${objectPath(intent)}`, { method: "POST", headers: { Authorization: `Bearer ${bearer}`, apikey: anonKey, "Content-Type": intent.mime_type, "x-upsert": "false" }, body: new Uint8Array(bytes).buffer });
      void response.body?.cancel().catch(() => {});
      if (!response.ok) throw new ImportError("STORAGE_UNAVAILABLE");
    },
    async deleteObject(intent) {
      // Called only after handler obtains/rechecks the owned, fenced discarding context.
      const response = await storageFetch(`object/${encodeURIComponent(intent.bucket_id)}`, { method: "DELETE", headers: { Authorization: `Bearer ${key}`, apikey: anonKey, "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: [intent.object_path] }) });
      void response.body?.cancel().catch(() => {});
      if (!response.ok) throw new ImportError("STORAGE_UNAVAILABLE");
    },
  },
}));
