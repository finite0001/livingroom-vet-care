import { z } from "zod";
import { readExactReviewResponse, type ExactJson } from "./exact-json.ts";
import { recordReviewRequestSchema, reviewUuidSchema } from "./request.ts";

const identitySchema = z.object({ actorId: reviewUuidSchema, sessionId: reviewUuidSchema,
  generation: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict();
export interface ReviewIdentity extends z.infer<typeof identitySchema> {}
export interface ReviewSession extends ReviewIdentity { accessToken: string }
export interface ReviewSessionSource {
  /** Existing Auth supplies this; the frontend snapshot is not server authority. */
  current(): Promise<ReviewSession | null>;
  isCurrent(identity: ReviewIdentity): boolean;
}
export const reviewRpcSchema = z.enum(["prepare_controlled_record_review_v3", "execute_controlled_record_review_v3",
  "read_controlled_record_review_v3", "cancel_controlled_record_review_v3"]);
export type ReviewRpc = z.infer<typeof reviewRpcSchema>;
const ownedRequest = z.object({ actor_id: reviewUuidSchema, operation_id: reviewUuidSchema }).strict();
const configSchema = z.object({ projectRef: z.string().regex(/^[a-z]{20}$/), url: z.string().url(),
  publishableKey: z.string().regex(/^sb_publishable_[A-Za-z0-9_-]+$/).max(4096) }).strict()
  .refine(config => config.url === `https://${config.projectRef}.supabase.co`);
export interface ReviewRpcConfig extends z.infer<typeof configSchema> {}
export interface ReviewRawRpc {
  call(rpc: ReviewRpc, request: unknown, identity: ReviewIdentity, check: () => void): Promise<ExactJson>;
}
export class ReviewTransportError extends Error {
  readonly kind: "identity_changed" | "unconfirmed";
  constructor(kind: "identity_changed" | "unconfirmed") {
    super(kind === "identity_changed" ? "Staff session changed; recover the original operation after signing in." :
      "The review outcome is unconfirmed. Recover the original operation before continuing.");
    this.name = "ReviewTransportError";
    this.kind = kind;
  }
}
export function sameReviewIdentity(a: ReviewIdentity | null, b: ReviewIdentity | null): boolean {
  return !!a && !!b && a.actorId === b.actorId && a.sessionId === b.sessionId && a.generation === b.generation;
}
export function parseReviewIdentity(value: unknown): Readonly<ReviewIdentity> { return Object.freeze(identitySchema.parse(value)); }

/** Raw one-shot POST. No SDK .rpc/.json, mutation retry, logging, caching, redirect
 * or secret key. Abort/deadline does not imply server rollback. The owning Auth
 * integration must advance its generation for every actor/session invalidation.
 */
export function createReviewRawRpc(configInput: ReviewRpcConfig, sessions: ReviewSessionSource,
  fetcher: typeof fetch = globalThis.fetch): ReviewRawRpc {
  const parsedConfig = configSchema.safeParse(configInput);
  if (!parsedConfig.success) throw new Error("Review public connection configuration is invalid");
  const config = parsedConfig.data;
  return { async call(rpcInput, requestInput, identityInput, check) {
    const rpcResult = reviewRpcSchema.safeParse(rpcInput), identityResult = identitySchema.safeParse(identityInput);
    if (!rpcResult.success || !identityResult.success) throw new ReviewTransportError("identity_changed");
    const rpc = rpcResult.data, identity = Object.freeze(identityResult.data);
    const requestResult = rpc === "prepare_controlled_record_review_v3" ? recordReviewRequestSchema.safeParse(requestInput) : ownedRequest.safeParse(requestInput);
    if (!requestResult.success) throw new ReviewTransportError("unconfirmed");
    const request = requestResult.data;
    if (request.actor_id !== identity.actorId) throw new ReviewTransportError("identity_changed");
    const body = JSON.stringify({ p_request: request });
    if (new TextEncoder().encode(body).byteLength > 128 * 1024) throw new ReviewTransportError("unconfirmed");
    const controller = new AbortController();
    const deadline = performance.now() + 30000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const assertCurrent = () => {
      check();
      if (controller.signal.aborted || performance.now() >= deadline) throw new ReviewTransportError("unconfirmed");
      if (!sessions.isCurrent(identity)) throw new ReviewTransportError("identity_changed");
    };
    // One original deadline includes session acquisition, fetch and body decode.
    const work = async () => {
      assertCurrent();
      const session = await sessions.current(); assertCurrent();
      if (!session || !sameReviewIdentity(identity, session) || typeof session.accessToken !== "string" ||
        !/^[A-Za-z0-9_.-]{1,16384}$/.test(session.accessToken)) throw new ReviewTransportError("identity_changed");
      const response = await fetcher(`${config.url}/rest/v1/rpc/${rpc}`, { method: "POST", mode: "cors",
        credentials: "omit", redirect: "error", cache: "no-store", signal: controller.signal,
        headers: { apikey: config.publishableKey, Authorization: `Bearer ${session.accessToken}`,
          "Content-Type": "application/json", Accept: "application/json" }, body });
      assertCurrent();
      const decoded = await readExactReviewResponse(response); assertCurrent();
      return decoded;
    };
    try {
      return await Promise.race([work(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new ReviewTransportError("unconfirmed")); }, 30000);
      })]);
    } catch (error) {
      controller.abort();
      // Never expose SDK/server bodies, Zod paths, tokens or clinical values.
      if (error instanceof ReviewTransportError) throw error;
      throw new ReviewTransportError("unconfirmed");
    } finally { if (timer !== undefined) clearTimeout(timer); }
  } };
}
