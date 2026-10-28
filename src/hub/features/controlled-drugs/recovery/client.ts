import { z } from "zod";
import { parseReviewIdentity, sameReviewIdentity, type ReviewIdentity, type ReviewRpcConfig, type ReviewSessionSource } from "../record-review/raw-rpc.ts";
import { registerId } from "../register/schema.ts";
import { recoveryIdentityRequest, recoveryPointer, recoveryRequest, type RecoveryPointer, type RecoveryPointerReply, type RecoveryPreflight, type RecoveryReceipt, type RecoveryStatus } from "./schema.ts";
import { decodeRecovery, verifyRecoveryDownload, verifyRecoveryPointer, verifyRecoveryPreflight, verifyRecoveryReceipt, verifyRecoveryStatus } from "./wire.ts";

const configSchema = z.object({ projectRef: z.string().regex(/^[a-z]{20}$/), url: z.string().url(),
  publishableKey: z.string().regex(/^sb_publishable_[A-Za-z0-9_-]+$/).max(4096) }).strict().refine(value => value.url === `https://${value.projectRef}.supabase.co`);
export interface RecoveryClient {
  status(identity: ReviewIdentity): Promise<RecoveryStatus>;
  preflight(identity: ReviewIdentity): Promise<RecoveryPreflight>;
  save(input: unknown, identity: ReviewIdentity): Promise<RecoveryReceipt>;
  recover(mode: "read" | "close", pointer: RecoveryPointer, identity: ReviewIdentity): Promise<RecoveryPointerReply>;
  download(evidenceId: string, identity: ReviewIdentity): ReturnType<typeof verifyRecoveryDownload>;
}
export class RecoveryUnconfirmedError extends Error {
  constructor() { super("The recovery result is unconfirmed. Check the original operation before continuing."); this.name = "RecoveryUnconfirmedError"; }
}
/** One fixed deadline covers session access, response streaming and verification. */
export function createRecoveryClient(input: ReviewRpcConfig, sessions: ReviewSessionSource, fetcher: typeof fetch = globalThis.fetch): RecoveryClient {
  const config = Object.freeze(configSchema.parse(input));
  async function call<T, Q extends { readonly actor_id?: string }>(name: string, request: Q, identityInput: ReviewIdentity, verify: (raw: Uint8Array) => T | Promise<T>): Promise<T> {
    const identity = parseReviewIdentity(identityInput), controller = new AbortController(), deadline = performance.now() + 30000;
    const check = () => { if (request.actor_id !== identity.actorId || !sessions.isCurrent(identity) || controller.signal.aborted || performance.now() >= deadline) throw new RecoveryUnconfirmedError(); };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const work = async () => {
      check(); const body = JSON.stringify({ p_request: request });
      if (new TextEncoder().encode(body).length > 3145728) throw new RecoveryUnconfirmedError();
      const session = await sessions.current(); check();
      if (!session || !sameReviewIdentity(session, identity) || !/^[A-Za-z0-9_.-]{1,16384}$/.test(session.accessToken)) throw new RecoveryUnconfirmedError();
      const response = await fetcher(`${config.url}/rest/v1/rpc/${name}`, { method: "POST", mode: "cors", credentials: "omit", redirect: "error", cache: "no-store", signal: controller.signal,
        headers: { apikey: config.publishableKey, Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json", Accept: "application/json" }, body });
      check();
      if (!response.ok || !/^application\/json(?:\s*;|\s*$)/i.test(response.headers.get("content-type") ?? "")) { void response.body?.cancel().catch(() => {}); throw new RecoveryUnconfirmedError(); }
      const reader = response.body?.getReader(); if (!reader) throw new RecoveryUnconfirmedError();
      const bytes = new Uint8Array(8388608); let length = 0;
      const abort = () => { void reader.cancel().catch(() => {}); }; controller.signal.addEventListener("abort", abort, { once: true });
      try {
        for (;;) {
          check(); const { value, done } = await reader.read(); check();
          if (done) break;
          if (length + value.byteLength > bytes.length) throw new RecoveryUnconfirmedError();
          bytes.set(value, length); length += value.byteLength;
        }
      } catch (error) { abort(); throw error; }
      finally { controller.signal.removeEventListener("abort", abort); reader.releaseLock(); }
      const verified = await verify(bytes.subarray(0, length)); check(); return verified;
    };
    try { return await Promise.race([work(), new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new RecoveryUnconfirmedError()); }, 30000); })]); }
    catch { controller.abort(); throw new RecoveryUnconfirmedError(); }
    finally { clearTimeout(timer); }
  }
  return Object.freeze({
    status(identity: ReviewIdentity) { return call("narcotics_recovery_status_v1", recoveryIdentityRequest.parse({ schema_version: 1, actor_id: identity.actorId }), identity, raw => verifyRecoveryStatus(raw, identity.actorId, identity.sessionId)); },
    preflight(identity: ReviewIdentity) { return call("narcotics_recovery_preflight_v1", recoveryIdentityRequest.parse({ schema_version: 1, actor_id: identity.actorId }), identity, verifyRecoveryPreflight); },
    save(input: unknown, identity: ReviewIdentity) {
      const request = recoveryRequest.parse(input), pointer = recoveryPointer.parse({ schema_version: 1, actor_id: request.actor_id, operation_id: request.operation_id, action: request.action });
      if (request.action === "start_count" && (request.data.request.actor_id !== request.actor_id || request.data.request.operation_id !== request.operation_id)) throw new RecoveryUnconfirmedError();
      return call(`narcotics_recovery_${request.action}_v1`, request, identity, raw => verifyRecoveryReceipt(decodeRecovery(raw), pointer, request));
    },
    recover(mode: "read" | "close", inputPointer: RecoveryPointer, identity: ReviewIdentity) {
      const pointer = recoveryPointer.parse(inputPointer);
      if (mode !== "read" && mode !== "close") throw new RecoveryUnconfirmedError();
      return call(mode === "read" ? "narcotics_recovery_read_operation_v1" : "narcotics_recovery_close_operation_v1", pointer, identity, raw => verifyRecoveryPointer(raw, pointer));
    },
    download(inputId: string, identity: ReviewIdentity) {
      const evidenceId = registerId.parse(inputId);
      return call("narcotics_recovery_read_evidence_v1", { schema_version: 1, actor_id: identity.actorId, evidence_id: evidenceId }, identity, raw => verifyRecoveryDownload(raw, evidenceId));
    },
  });
}
