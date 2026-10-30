import { z } from "zod";
import { readAdministrationResponse } from "../administration/response.ts";
import { entryRequestBody, sameEntryJson } from "../entry/codec.ts";
import { parseReviewIdentity, sameReviewIdentity, type ReviewIdentity, type ReviewRpcConfig, type ReviewSessionSource } from "../record-review/raw-rpc.ts";
import type { ExactJson } from "../record-review/exact-json.ts";
import { bindWitnessReceipt, parseWitnessList, parseWitnessReply, witnessListRequestSchema, witnessPointerSchema, witnessReceiptSchema,
  type WitnessList, type WitnessListRequest, type WitnessPointer, type WitnessReceipt, type WitnessReply } from "./schema.ts";
import { verifyWitnessReceipt } from "./wire.ts";

const configuration = z.object({ projectRef: z.string().regex(/^[a-z]{20}$/), url: z.string().url(),
  publishableKey: z.string().regex(/^sb_publishable_[A-Za-z0-9_-]+$/).max(4096) }).strict().refine(v => v.url === `https://${v.projectRef}.supabase.co`);
const routes = { list: "list_managed_stock_witness_tasks_v1", read: "read_managed_stock_witness_v1", attest: "attest_managed_stock_witness_v1",
  operation: "read_managed_stock_witness_operation_v1", close: "close_managed_stock_witness_operation_v1" } as const;
export class WitnessClientError extends Error {
  constructor() { super("The witness result is unconfirmed. Check or close the original witness operation before starting another."); this.name = "WitnessClientError"; }
}
export interface WitnessClient {
  list(request: WitnessListRequest, identity: Readonly<ReviewIdentity>): Promise<WitnessList>;
  read(pointer: WitnessPointer, identity: Readonly<ReviewIdentity>): Promise<WitnessReply>;
  operation(pointer: WitnessPointer, identity: Readonly<ReviewIdentity>): Promise<WitnessReply>;
  close(pointer: WitnessPointer, identity: Readonly<ReviewIdentity>): Promise<WitnessReply>;
  attest(pointer: WitnessPointer, displayed: WitnessReply, identity: Readonly<ReviewIdentity>, attestWitness: true): Promise<WitnessReceipt>;
}
export function createWitnessClient(configInput: ReviewRpcConfig, sessions: ReviewSessionSource, fetcher: typeof fetch = globalThis.fetch): WitnessClient {
  const config = Object.freeze(configuration.parse(configInput));
  async function transaction<T>(identityInput: Readonly<ReviewIdentity>, work: (request: (route: string, body: unknown, cap: number) => Promise<ExactJson>) => Promise<T>): Promise<T> {
    const identity = parseReviewIdentity(identityInput), deadline = performance.now() + 30000, abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => { if (abort.signal.aborted || performance.now() >= deadline || !sessions.isCurrent(identity)) throw new WitnessClientError(); };
    const request = async (route: string, body: unknown, cap: number) => {
      check(); const session = await sessions.current(); check();
      if (!session || !sameReviewIdentity(session, identity) || !/^[-A-Za-z0-9_]+\.[-A-Za-z0-9_]+\.[-A-Za-z0-9_]+$/.test(session.accessToken) || session.accessToken.length > 16384) throw new WitnessClientError();
      const response = await fetcher(`${config.url}/rest/v1/rpc/${route}`, { method: "POST", mode: "cors", credentials: "omit", redirect: "error", cache: "no-store", signal: abort.signal,
        headers: { apikey: config.publishableKey, Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json", Accept: "application/json" }, body: entryRequestBody(body, 8192) }); check();
      const raw = await readAdministrationResponse(response, abort.signal, deadline, { rawBytes: 16 * 1024 * 1024, parsedBytes: cap }); check();
      return raw;
    };
    try {
      const result = await Promise.race([work(request), new Promise<never>((_, reject) => { timer = setTimeout(() => { abort.abort(); reject(new WitnessClientError()); }, 30000); })]);
      check(); return result;
    } catch { abort.abort(); throw new WitnessClientError(); } finally { clearTimeout(timer); }
  }
  const pointerFor = (input: WitnessPointer, identity: Readonly<ReviewIdentity>) => {
    const pointer = witnessPointerSchema.parse(input); if (pointer.actor_id !== identity.actorId) throw new WitnessClientError(); return pointer;
  };
  async function operation(route: "read" | "operation" | "close", input: WitnessPointer, identity: Readonly<ReviewIdentity>): Promise<WitnessReply> {
    const pointer = pointerFor(input, identity);
    return transaction(identity, async request => {
      const raw = await request(routes[route], pointer, 2097152);
      const reply = parseWitnessReply(raw, pointer, route !== "read");
      if (route === "close" && reply.state === "not_found") throw new WitnessClientError();
      if (reply.data.receipt) await verifyWitnessReceipt(reply.data.receipt);
      return reply;
    });
  }
  const client: WitnessClient = {
    list(input, identity) {
      const request = witnessListRequestSchema.parse(input); if (request.actor_id !== identity.actorId) throw new WitnessClientError();
      return transaction(identity, async send => parseWitnessList(await send(routes.list, request, 262144), request));
    },
    read: (pointer, identity) => operation("read", pointer, identity), operation: (pointer, identity) => operation("operation", pointer, identity), close: (pointer, identity) => operation("close", pointer, identity),
    attest(input, displayed, identity, attestWitness) {
      const pointer = pointerFor(input, identity);
      if (attestWitness !== true || displayed.state !== "available" || !displayed.data.preparation || !displayed.data.preparation_digest || !sameEntryJson(displayed.data.pointer, pointer)) throw new WitnessClientError();
      // One captured identity, AbortController and original30s for fresh READ,
      // exact lossless comparison, explicit save and receipt admission.
      return transaction(identity, async request => {
        const fresh = parseWitnessReply(await request(routes.read, pointer, 2097152), pointer);
        if (fresh.state !== "available" || !sameEntryJson(fresh.data.preparation, displayed.data.preparation) ||
          fresh.data.preparation_digest !== displayed.data.preparation_digest || !sameEntryJson(fresh.data.recorder, displayed.data.recorder)) throw new WitnessClientError();
        const receipt = Object.freeze(witnessReceiptSchema.parse(await request(routes.attest, { ...pointer, preparation_digest: fresh.data.preparation_digest, attest_witness: true }, 8192)));
        bindWitnessReceipt(receipt, pointer, displayed.data.preparation_digest!); await verifyWitnessReceipt(receipt); return receipt;
      });
    },
  };
  return Object.freeze(client);
}
