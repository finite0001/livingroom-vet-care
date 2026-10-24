import { reviewQueueRequestSchema, verifyReviewQueuePage, type ReviewQueuePage, type ReviewQueueRequest } from "./queue-model.ts";
import { parseReviewIdentity, sameReviewIdentity, type ReviewIdentity } from "./raw-rpc.ts";
import type { ReviewReadRpc } from "./read-rpc.ts";

export interface ReviewQueueReaderState {
  readonly phase: "signed_out" | "idle" | "loading" | "ready" | "unavailable";
  readonly request?: Readonly<ReviewQueueRequest>;
  readonly page?: ReviewQueuePage;
  readonly message?: string;
}
export interface ReviewQueueReaderDependencies {
  rpc: ReviewReadRpc;
  /** Current Auth generation, not a server authorization decision. */
  isCurrent(identity: ReviewIdentity): boolean;
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

/** Unmounted queue-only controller. No selection, signature or pointer storage.
 * Identity changes clear data synchronously; only explicit refresh/next reads.
 * Mounting still requires the accepted backend read/source/Auth integration.
 */
export function createReviewQueueReader(deps: ReviewQueueReaderDependencies) {
  let identity: Readonly<ReviewIdentity> | null = null, epoch = 0;
  const signedOut: Readonly<ReviewQueueReaderState> = Object.freeze({ phase: "signed_out" });
  let state = signedOut;
  const listeners = new Set<() => void>();
  function publish(next: ReviewQueueReaderState) {
    state = Object.freeze(next);
    for (const listener of listeners) { try { listener(); } catch { /* Observers cannot authorize a read. */ } }
  }
  function liveIdentity(): boolean {
    if (!identity) return false;
    const current = identity, generation = epoch;
    let valid = false;
    try { valid = deps.isCurrent(current); } catch { /* Unavailable Auth fails closed. */ }
    if (epoch !== generation || !sameReviewIdentity(identity, current)) return false;
    if (valid) return true;
    identity = null; epoch++; publish({ phase: "signed_out" });
    return false;
  }
  async function load(input: unknown, firstPage: boolean): Promise<boolean> {
    if (!liveIdentity() || !identity || state.phase === "loading") return false;
    const current = identity, generation = ++epoch;
    const check = () => {
      if (epoch !== generation || !sameReviewIdentity(identity, current) || !deps.isCurrent(current)) throw new Error("Obsolete queue read");
    };
    try {
      check();
      const request = freeze(reviewQueueRequestSchema.parse(input));
      if (request.actor_id !== current.actorId || (firstPage && request.cursor !== null)) throw new Error("Queue scope differs");
      check();
      // Clear the prior page before requesting current authorization again.
      publish({ phase: "loading", request }); check();
      const raw = await deps.rpc.call("list_controlled_record_reviews_v3", request, current, check); check();
      const page = freeze(verifyReviewQueuePage(request, raw)); check();
      publish({ phase: "ready", request, page }); check();
      return true;
    } catch {
      try {
        check();
        publish({ phase: "unavailable", message: "Review records could not be loaded. Refresh from the first page after confirming your staff session." });
      } catch {
        // An Auth generation can become stale before its UI notification arrives.
        // Clear that stale identity without overwriting a newer model generation.
        if (epoch === generation && sameReviewIdentity(identity, current)) {
          identity = null; epoch++; publish({ phase: "signed_out" });
        }
      }
      return false;
    }
  }
  return {
    // Pure visibility fence: no publication or render-side effect. Auth must
    // still advance generation and notify/setIdentity synchronously on change.
    getSnapshot: () => {
      if (!identity) return state;
      const current = identity;
      try { return deps.isCurrent(current) && sameReviewIdentity(identity, current) ? state : signedOut; }
      catch { return signedOut; }
    },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setIdentity(input: ReviewIdentity | null) {
      let next: Readonly<ReviewIdentity> | null = null;
      try { next = input === null ? null : parseReviewIdentity(input); } catch { /* Invalid identity clears the page. */ }
      if (sameReviewIdentity(identity, next) || (identity === null && next === null)) return;
      identity = next; epoch++;
      publish({ phase: identity ? "idle" : "signed_out" });
    },
    /** A refresh cannot resume a caller-supplied continuation. */
    refresh(input: unknown): Promise<boolean> { return load(input, true); },
    /** Only the currently verified page can supply the next cursor. */
    async nextPage(): Promise<boolean> {
      if (!liveIdentity() || state.phase !== "ready" || !state.request || !state.page?.data.next_cursor) return false;
      return load({ ...state.request, cursor: state.page.data.next_cursor }, false);
    },
    clear() { if (!liveIdentity()) return; epoch++; publish({ phase: "idle" }); },
  };
}
