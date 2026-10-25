import { createReviewQueueReader, type ReviewQueueReaderState } from "./queue-reader.ts";
import { reviewQueueRequestSchema, type ReviewQueueRequest } from "./queue-model.ts";
import { sameReviewIdentity, type ReviewIdentity } from "./raw-rpc.ts";
import type { ReviewReadRpc } from "./read-rpc.ts";
import { verifyReviewDetail, type AdmittedReviewDetail, type ReviewDetailEvidenceAdmission } from "./read-detail.ts";
import type { ReviewStaffSessionSource } from "./staff-session.ts";
import type { createReviewLifecycle } from "./lifecycle.ts";

export interface ReviewWorkspaceState {
  readonly identity: Readonly<ReviewIdentity> | null;
  readonly queue: Readonly<ReviewQueueReaderState>;
  readonly detailPhase: "idle" | "loading" | "ready" | "unavailable";
  readonly detail?: AdmittedReviewDetail;
  readonly message?: string;
}
export interface ReviewWorkspaceDependencies {
  sessions: ReviewStaffSessionSource;
  reads: ReviewReadRpc;
  model: ReturnType<typeof createReviewLifecycle>;
  /** Complete source-specific admission is mandatory. No default is supplied. */
  evidence: ReviewDetailEvidenceAdmission;
}

const signedOut: Readonly<ReviewWorkspaceState> = Object.freeze({ identity: null,
  queue: Object.freeze({ phase: "signed_out" }), detailPhase: "idle" });

/** Explicit reads only. connect() owns the Auth subscription; construction and
 * rendering cannot read or sign. Disconnect invalidates every pending commit.
 * This composition confers no backend installation or evidence authority.
 */
export function createReviewWorkspace(deps: ReviewWorkspaceDependencies) {
  const queue = createReviewQueueReader({ rpc: deps.reads, isCurrent: identity => deps.sessions.isCurrent(identity) });
  const listeners = new Set<() => void>();
  let identity: Readonly<ReviewIdentity> | null = null, epoch = 0, transitioning = false;
  let state = signedOut, connected = false, disconnect: (() => void) | null = null;
  function notify() {
    for (const listener of listeners) { try { listener(); } catch { /* Observers do not authorize actions. */ } }
  }
  function publish(next: ReviewWorkspaceState) { state = Object.freeze(next); notify(); }
  function current(): boolean {
    if (!connected || transitioning || !identity) return false;
    const captured = identity, revision = epoch;
    try { return deps.sessions.isCurrent(captured) && revision === epoch && sameReviewIdentity(captured, identity); }
    catch { return false; }
  }
  function syncIdentity() {
    let next: Readonly<ReviewIdentity> | null = null;
    try { next = connected ? deps.sessions.getSnapshot() : null; } catch { /* Fail closed. */ }
    if (!transitioning && ((next === null && identity === null) || sameReviewIdentity(next, identity))) return;
    const revision = ++epoch;
    transitioning = true; identity = null; state = signedOut;
    // Clear signing evidence before queue observers or a new actor can publish.
    deps.model.setIdentity(null);
    if (revision !== epoch) return;
    queue.setIdentity(null);
    if (revision !== epoch) return;
    let accepted = false;
    try { accepted = connected && next !== null && deps.sessions.isCurrent(next); } catch { /* Unavailable Auth stays masked. */ }
    if (accepted && next) {
      queue.setIdentity(next);
      if (revision !== epoch) return;
      deps.model.setIdentity(next);
      if (revision !== epoch) return;
      identity = next;
    }
    transitioning = false;
    publish(identity ? { identity, queue: queue.getSnapshot(), detailPhase: "idle" } : signedOut);
  }
  function clearDetail() {
    const revision = ++epoch;
    publish({ identity, queue: queue.getSnapshot(), detailPhase: "idle" });
    return revision;
  }
  return {
    model: deps.model,
    getSnapshot: (): Readonly<ReviewWorkspaceState> => current() ? state : signedOut,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    connect() {
      if (connected) throw new Error("This review workspace is already connected");
      connected = true;
      const offSession = deps.sessions.subscribe(syncIdentity);
      const offQueue = queue.subscribe(() => {
        if (!current()) return;
        publish({ ...state, identity, queue: queue.getSnapshot() });
      });
      let active = true;
      const stop = () => {
        if (!active) return;
        active = false;
        if (disconnect === stop) disconnect = null;
        connected = false; offSession(); offQueue(); syncIdentity();
      };
      disconnect = stop;
      syncIdentity();
      return stop;
    },
    disconnect() { disconnect?.(); },
    async refresh(input: ReviewQueueRequest): Promise<boolean> {
      if (!current()) { syncIdentity(); return false; }
      const actor = identity, intent = epoch;
      let request: Readonly<ReviewQueueRequest>;
      try {
        // Read caller getters before clearing/publishing. Parsing can itself
        // trigger a new workspace intent, which the queue's epoch cannot see.
        const parsed = reviewQueueRequestSchema.parse(input);
        if (parsed.cursor) Object.freeze(parsed.cursor);
        request = Object.freeze(parsed);
      } catch { return false; }
      if (epoch !== intent || !sameReviewIdentity(actor, identity) || !current()) return false;
      const revision = clearDetail();
      if (epoch !== revision || !sameReviewIdentity(actor, identity) || !current()) return false;
      return queue.refresh(request);
    },
    async nextPage(): Promise<boolean> {
      if (!current()) { syncIdentity(); return false; }
      if (!queue.getSnapshot().page?.data.next_cursor) return false;
      const actor = identity, revision = clearDetail();
      if (epoch !== revision || !sameReviewIdentity(actor, identity) || !current()) return false;
      return queue.nextPage();
    },
    async openRecord(eventId: string): Promise<boolean> {
      if (!current() || !identity || state.detailPhase === "loading") { if (!current()) syncIdentity(); return false; }
      const page = queue.getSnapshot(), row = page.page?.data.items.find(item => item.event_id === eventId);
      if (page.phase !== "ready" || !page.request || !row) return false;
      const actor = identity, scope = page.request, revision = ++epoch;
      const check = () => {
        if (epoch !== revision || !sameReviewIdentity(actor, identity) || !current()) throw new Error("Obsolete review detail");
      };
      try {
        publish({ identity: actor, queue: page, detailPhase: "loading" }); check();
        const request = { actor_id: actor.actorId, event_id: row.event_id };
        const raw = await deps.reads.call("get_controlled_record_review_event_v3", request, actor, check); check();
        const detail = await verifyReviewDetail(request, raw, deps.evidence, check); check();
        const summary = detail.response.data.summary;
        // A fresh detail must still describe the opened row and exact page scope.
        if (Object.keys(row).some(key => row[key as keyof typeof row] !== summary[key as keyof typeof summary]) ||
          (scope.view === "site" && (summary.site_id !== scope.site_id || summary.event_kind !== scope.event_kind)) ||
          (scope.view === "exceptions" && summary.site_id !== null) ||
          (detail.response.state === "detail" && detail.response.data.packet.target.product_id !== scope.product_id))
          throw new Error("Review detail scope differs");
        check(); publish({ identity: actor, queue: page, detailPhase: "ready", detail }); check();
        return true;
      } catch {
        try { check(); publish({ identity: actor, queue: page, detailPhase: "unavailable",
          message: "This record could not be opened for the current staff session. Refresh the records and try again." }); }
        catch { /* Never overwrite another session or a newer read. */ }
        return false;
      }
    },
  };
}
