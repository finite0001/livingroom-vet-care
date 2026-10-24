import { z } from "zod";
import { readExactReviewResponse, type ExactJson } from "./exact-json.ts";
import { reviewQueueRequestSchema, type ReviewQueueRequest } from "./queue-model.ts";
import { reviewUuidSchema } from "./request.ts";
import { parseReviewIdentity, sameReviewIdentity, type ReviewIdentity, type ReviewRpcConfig, type ReviewSessionSource } from "./raw-rpc.ts";

export const reviewReadRpcSchema = z.enum(["get_controlled_record_review_event_v3", "list_controlled_record_reviews_v3"]);
export type ReviewReadMethod = z.infer<typeof reviewReadRpcSchema>;
export const reviewDetailRequestSchema = z.object({ actor_id: reviewUuidSchema, event_id: reviewUuidSchema }).strict();
export interface ReviewDetailRequest extends z.infer<typeof reviewDetailRequestSchema> {}
export interface ReviewReadRpc {
  /** The consuming controller must recheck identity at its own state commit. */
  call(method: ReviewReadMethod, request: unknown, identity: ReviewIdentity, check: () => void): Promise<ExactJson>;
}
const publicConfig = z.object({ projectRef: z.string().regex(/^[a-z]{20}$/), url: z.string().url(),
  publishableKey: z.string().regex(/^sb_publishable_[A-Za-z0-9_-]+$/).max(4096) }).strict()
  .refine(config => config.url === `https://${config.projectRef}.supabase.co`);

export class ReviewReadTransportError extends Error {
  readonly kind: "identity_changed" | "unavailable";
  constructor(kind: "identity_changed" | "unavailable") {
    super(kind === "identity_changed" ? "Staff session changed. Reopen the record after signing in." :
      "Review records could not be loaded. Refresh after confirming your staff session.");
    this.name = "ReviewReadTransportError";
    this.kind = kind;
  }
}

/** One-shot read transport with a separate literal allowlist from signing.
 * No SDK parsing, cache, redirect, logging, implicit retry or mutation method.
 * Decoded data still requires exact page/detail and source-evidence admission.
 */
export function createReviewReadRpc(configInput: ReviewRpcConfig, sessions: ReviewSessionSource,
  fetcher: typeof fetch = globalThis.fetch): ReviewReadRpc {
  let config: Readonly<ReviewRpcConfig>;
  try { config = Object.freeze(publicConfig.parse(configInput)); }
  catch { throw new Error("Review public connection configuration is invalid"); }
  return { async call(methodInput, requestInput, identityInput, check) {
    let method: ReviewReadMethod;
    try { method = reviewReadRpcSchema.parse(methodInput); }
    catch { throw new ReviewReadTransportError("unavailable"); }
    let identity: Readonly<ReviewIdentity>;
    try { identity = parseReviewIdentity(identityInput); } catch { throw new ReviewReadTransportError("identity_changed"); }
    let request: ReviewDetailRequest | ReviewQueueRequest, body: string;
    try {
      request = method === "get_controlled_record_review_event_v3"
        ? reviewDetailRequestSchema.parse(requestInput) : reviewQueueRequestSchema.parse(requestInput);
      body = JSON.stringify({ p_request: request });
      if (new TextEncoder().encode(body).byteLength > 128 * 1024) throw new Error("Read request exceeds limit");
    } catch { throw new ReviewReadTransportError("unavailable"); }
    if (request.actor_id !== identity.actorId) throw new ReviewReadTransportError("identity_changed");
    const controller = new AbortController(), deadline = performance.now() + 30000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const assertCurrent = () => {
      check();
      if (controller.signal.aborted || performance.now() >= deadline) throw new ReviewReadTransportError("unavailable");
      if (!sessions.isCurrent(identity)) throw new ReviewReadTransportError("identity_changed");
    };
    const work = async () => {
      assertCurrent();
      const session = await sessions.current(); assertCurrent();
      if (!session || !sameReviewIdentity(identity, session) || typeof session.accessToken !== "string" ||
        !/^[A-Za-z0-9_.-]{1,16384}$/.test(session.accessToken)) throw new ReviewReadTransportError("identity_changed");
      const response = await fetcher(`${config.url}/rest/v1/rpc/${method}`, { method: "POST", mode: "cors",
        credentials: "omit", redirect: "error", cache: "no-store", signal: controller.signal,
        headers: { apikey: config.publishableKey, Authorization: `Bearer ${session.accessToken}`,
          "Content-Type": "application/json", Accept: "application/json" }, body });
      assertCurrent();
      const result = await readExactReviewResponse(response); assertCurrent();
      return result;
    };
    try {
      const result = await Promise.race([work(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new ReviewReadTransportError("unavailable")); }, 30000);
      })]);
      assertCurrent();
      return result;
    } catch (error) {
      controller.abort();
      let kind: "identity_changed" | "unavailable" = "unavailable";
      try { if (error instanceof ReviewReadTransportError && error.kind === "identity_changed") kind = "identity_changed"; }
      catch { /* A hostile thrown object's accessors are not error authority. */ }
      throw new ReviewReadTransportError(kind);
    } finally { if (timer !== undefined) clearTimeout(timer); }
  } };
}
