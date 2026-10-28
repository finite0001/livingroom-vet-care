import { z } from "zod";
import { parseReviewIdentity, sameReviewIdentity, type ReviewIdentity, type ReviewRpcConfig, type ReviewSessionSource } from "../record-review/raw-rpc.ts";
import { registerFormRequest, registerId, registerListRequest, parseRegisterPointer, registerReportRequest, type RegisterListReply, type RegisterPointer, type RegisterReply } from "./schema.ts";
import { verifyRegisterDownload, verifyRegisterList, verifyRegisterReply } from "./wire.ts";

const configSchema = z.object({ projectRef: z.string().regex(/^[a-z]{20}$/), url: z.string().url(),
  publishableKey: z.string().regex(/^sb_publishable_[A-Za-z0-9_-]+$/).max(4096) }).strict().refine(value => value.url === `https://${value.projectRef}.supabase.co`);
export interface RegisterClient {
  list(input: unknown, identity: ReviewIdentity): Promise<RegisterListReply>;
  save(kind: "report" | "form", input: unknown, identity: ReviewIdentity): Promise<RegisterReply>;
  recover(mode: "read" | "close", pointer: RegisterPointer, identity: ReviewIdentity): Promise<RegisterReply>;
  download(formId: string, identity: ReviewIdentity): ReturnType<typeof verifyRegisterDownload>;
}
export class RegisterUnconfirmedError extends Error {
  constructor() { super("The result could not be confirmed. Recover the original operation before continuing."); this.name = "RegisterUnconfirmedError"; }
}
/** One fixed deadline covers login, HTTP streaming, and evidence verification. */
export function createRegisterClient(input: ReviewRpcConfig, sessions: ReviewSessionSource, fetcher: typeof fetch = globalThis.fetch): RegisterClient {
  const config = Object.freeze(configSchema.parse(input));
  async function call<T, Q extends { readonly actor_id?: string }>(name: string, request: Q, identityInput: ReviewIdentity, verify: (raw: Uint8Array) => Promise<T>): Promise<T> {
    const identity = parseReviewIdentity(identityInput), controller = new AbortController(), deadline = performance.now() + 30000;
    const check = () => { if (request.actor_id !== identity.actorId || !sessions.isCurrent(identity) || controller.signal.aborted || performance.now() >= deadline) throw new RegisterUnconfirmedError(); };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const work = async () => {
      check(); const body = JSON.stringify({ p_request: request });
      if (new TextEncoder().encode(body).length > 3145728) throw new RegisterUnconfirmedError();
      const session = await sessions.current(); check();
      if (!session || !sameReviewIdentity(session, identity) || !/^[A-Za-z0-9_.-]{1,16384}$/.test(session.accessToken)) throw new RegisterUnconfirmedError();
      const response = await fetcher(`${config.url}/rest/v1/rpc/${name}`, { method: "POST", mode: "cors", credentials: "omit", redirect: "error", cache: "no-store", signal: controller.signal,
        headers: { apikey: config.publishableKey, Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json", Accept: "application/json" }, body });
      check();
      if (!response.ok || !/^application\/json(?:\s*;|\s*$)/i.test(response.headers.get("content-type") ?? "")) { void response.body?.cancel().catch(() => {}); throw new RegisterUnconfirmedError(); }
      const reader = response.body?.getReader(); if (!reader) throw new RegisterUnconfirmedError();
      const bytes = new Uint8Array(8388608); let length = 0;
      const abort = () => { void reader.cancel().catch(() => {}); }; controller.signal.addEventListener("abort", abort, { once: true });
      try {
        for (;;) {
          check(); const { value, done } = await reader.read(); check();
          if (done) break;
          if (length + value.byteLength > bytes.length) throw new RegisterUnconfirmedError();
          bytes.set(value, length); length += value.byteLength;
        }
      } catch (error) { abort(); throw error; }
      finally { controller.signal.removeEventListener("abort", abort); reader.releaseLock(); }
      const verified = await verify(bytes.subarray(0, length)); check(); return verified;
    };
    try { return await Promise.race([work(), new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new RegisterUnconfirmedError()); }, 30000); })]); }
    catch { controller.abort(); throw new RegisterUnconfirmedError(); }
    finally { clearTimeout(timer); }
  }
  const client: RegisterClient = {
    list(input, identity) {
      const request = registerListRequest.parse(input);
      return call("list_narcotics_registers_v1", request, identity, async raw => verifyRegisterList(raw, request));
    },
    save(kind, value, identity) {
      const request = kind === "report" ? registerReportRequest.parse(value) : registerFormRequest.parse(value);
      const pointer = parseRegisterPointer({ schema_version: 1, actor_id: request.actor_id, operation_id: request.operation_id, product_id: request.product_id, site_id: request.site_id, kind });
      return call(kind === "report" ? "create_narcotics_register_v1" : "preserve_narcotics_form_v1", request, identity, raw => verifyRegisterReply(raw, pointer, request));
    },
    recover(mode, inputPointer, identity) {
      const pointer = parseRegisterPointer(inputPointer);
      const request = mode === "close" ? pointer : { schema_version: 1, actor_id: pointer.actor_id, operation_id: pointer.operation_id };
      const name = mode === "close" ? "close_narcotics_register_operation_v1" : pointer.kind === "report" ? "read_narcotics_register_v1" : "read_narcotics_form_operation_v1";
      return call(name, request, identity, raw => verifyRegisterReply(raw, pointer));
    },
    download(inputId, identity) {
      const formId = registerId.parse(inputId);
      return call("download_narcotics_form_v1", { schema_version: 1, actor_id: identity.actorId, form_id: formId }, identity, raw => verifyRegisterDownload(raw, formId));
    },
  };
  return Object.freeze(client);
}
