import { z } from "zod";
import { parseReviewIdentity, sameReviewIdentity, type ReviewIdentity, type ReviewRpcConfig, type ReviewSessionSource } from "../record-review/raw-rpc.ts";
import { administrationPointerSchema, administrationPreparationSchema, administrationRequestSchema, type AdministrationPointer, type AdministrationRequest } from "./schema.ts";
import type { AdministrationOperationTransport } from "./operation-controller.ts";
import { freezeAdministration } from "./primitives.ts";
import { administrationRequestBytes, verifyAdministrationReply } from "./wire.ts";
import { readAdministrationResponse } from "./response.ts";
const configSchema = z.object({ projectRef: z.string().regex(/^[a-z]{20}$/), url: z.string().url(),
  publishableKey: z.string().regex(/^sb_publishable_[A-Za-z0-9_-]+$/).max(4096) }).strict()
  .refine(value => value.url === `https://${value.projectRef}.supabase.co`);
const methods = Object.freeze({ prepare: "prepare_controlled_stock_administration_v1", read: "read_controlled_stock_administration_operation_v1",
  execute: "execute_controlled_stock_administration_v1", close: "close_controlled_stock_administration_operation_v1" });
export class AdministrationTransportError extends Error {
  constructor() { super("The administrator operation could not be confirmed. Check the original operation before trying again."); this.name = "AdministrationTransportError"; }
}
function admit<T>(parse: () => T): T { try { return parse(); } catch { throw new AdministrationTransportError(); } }
export function createAdministrationOperationClient(configInput: ReviewRpcConfig, sessions: ReviewSessionSource, fetcher: typeof fetch = globalThis.fetch): AdministrationOperationTransport {
  const config = Object.freeze(admit(() => configSchema.parse(configInput)));
  async function call(method: keyof typeof methods, input: AdministrationPointer | AdministrationRequest, identityInput: ReviewIdentity, original?: AdministrationRequest) {
    const identity = Object.freeze(admit(() => parseReviewIdentity(identityInput))), deadline = performance.now() + 30000, controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const request = freezeAdministration(admit(() => method === "prepare" ? administrationRequestSchema.parse(input) : administrationPointerSchema.parse(input)));
    const pointer = admit(() => administrationPointerSchema.parse({ schema_version: request.schema_version, actor_id: request.actor_id, operation_id: request.operation_id,
      action: request.action, product_id: request.product_id, site_id: request.site_id }));
    const check = () => {
      if (request.actor_id !== identity.actorId || !sessions.isCurrent(identity) || controller.signal.aborted || performance.now() >= deadline) throw new AdministrationTransportError();
    };
    const work = async () => {
      check(); if (method === "prepare") administrationRequestBytes(request);
      const body = JSON.stringify({ p_request: request });
      if (new TextEncoder().encode(body).length > 2 * 1024 * 1024) throw new AdministrationTransportError();
      const session = await sessions.current(); check();
      if (!session || !sameReviewIdentity(session, identity) || typeof session.accessToken !== "string" || !/^[A-Za-z0-9_.-]{1,16384}$/.test(session.accessToken)) throw new AdministrationTransportError();
      const response = await fetcher(`${config.url}/rest/v1/rpc/${methods[method]}`, { method: "POST", mode: "cors", credentials: "omit", redirect: "error", cache: "no-store", signal: controller.signal,
        headers: { apikey: config.publishableKey, Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json", Accept: "application/json" }, body }); check();
      const raw = await readAdministrationResponse(response, controller.signal, deadline); check();
      const result = await verifyAdministrationReply(raw, pointer, original ?? (method === "prepare" ? request as AdministrationRequest : undefined)); check(); return result;
    };
    try {
      const result = await Promise.race([work(), new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new AdministrationTransportError()); }, 30000); })]);
      check(); return result;
    } catch { controller.abort(); throw new AdministrationTransportError(); }
    finally { clearTimeout(timer); }
  }
  return Object.freeze({
    prepare(input, identity) { const request = freezeAdministration(admit(() => administrationRequestSchema.parse(input))); return call("prepare", request, identity, request); },
    read(pointer, identity) { return call("read", pointer, identity); },
    execute(input, identity) {
      const preparation = freezeAdministration(admit(() => administrationPreparationSchema.parse(input)));
      const request = preparation.request, pointer = admit(() => administrationPointerSchema.parse({ schema_version: request.schema_version, actor_id: request.actor_id, operation_id: request.operation_id,
        action: request.action, product_id: request.product_id, site_id: request.site_id }));
      if (preparation.source_state !== "current") throw new AdministrationTransportError();
      return call("execute", pointer, identity, request);
    },
    close(pointer, identity) { return call("close", pointer, identity); },
  });
}
