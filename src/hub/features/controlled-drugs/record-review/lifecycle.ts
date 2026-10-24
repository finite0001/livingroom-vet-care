import { z } from "zod";
import { ExactJsonNumber, protocolInteger } from "./exact-json.ts";
import { verifyOwnedReviewOutcome } from "./owned-outcome.ts";
import { reviewProtocolInstantSchema, verifyPreparedReview, type PreparedReview, type ReviewEvidenceAdmission } from "./prepared-packet.ts";
import { recordReviewRequestSchema, reviewDigestSchema, reviewTransportDigest, reviewUuidSchema, type RecordReviewRequest } from "./request.ts";
import { parseReviewIdentity, sameReviewIdentity, type ReviewIdentity, type ReviewRawRpc } from "./raw-rpc.ts";
import type { createReviewPointerStore, RecordReviewPointer } from "./recovery-pointer.ts";

const version = z.instanceof(ExactJsonNumber).refine(value => {
  try { return protocolInteger(value, 3, 3) === 3; } catch { return false; }
});
const owned = { operation_id: reviewUuidSchema, transport_digest: reviewDigestSchema };
const unavailable = z.discriminatedUnion("state", [
  z.object({ version, state: z.literal("not_found"), data: z.object({ operation_id: reviewUuidSchema }).strict() }).strict(),
  z.object({ version, state: z.literal("expired"), data: z.object({ ...owned, created_at: reviewProtocolInstantSchema, expires_at: reviewProtocolInstantSchema }).strict() }).strict(),
  z.object({ version, state: z.literal("stale"), data: z.object({ ...owned, reason: z.enum(["policy_changed", "read_eligibility_changed", "review_eligibility_changed"]) }).strict() }).strict(),
  z.object({ version, state: z.literal("blocked"), data: z.object({ ...owned, reason: z.enum(["own_record", "no_current_policy", "disabled_current_policy", "no_read_eligibility", "no_review_eligibility", "unsupported_provenance", "evidence_limit_exceeded"]) }).strict() }).strict(),
  z.object({ version, state: z.literal("superseded"), data: z.object(owned).strict() }).strict(),
]);
export type OwnedReviewOutcome = ReturnType<typeof verifyOwnedReviewOutcome>;
export interface ReviewLifecycleState {
  readonly phase: "signed_out" | "idle" | "preparing" | "recoverable" | "recovering" | "review" | "confirming" | "cancelling" | "unknown" | "attention" | "resolved";
  readonly pointer?: Readonly<RecordReviewPointer>;
  readonly request?: Readonly<RecordReviewRequest>;
  readonly prepared?: PreparedReview;
  readonly reviewed?: boolean;
  readonly outcome?: OwnedReviewOutcome;
  readonly cleanupPending?: boolean;
  readonly cleanupBusy?: boolean;
  readonly operationState?: z.infer<typeof unavailable>["state"];
  /** Fixed safe copy only, never arbitrary server/validation errors. */
  readonly message?: string;
}
export interface ReviewLifecycleDependencies {
  pointers: ReturnType<typeof createReviewPointerStore>;
  rpc: ReviewRawRpc;
  /** Mandatory, reviewed complete source admission; no permissive fallback. */
  evidence: ReviewEvidenceAdmission;
  digest?: typeof reviewTransportDigest;
}
const busy = new Set(["preparing", "recovering", "confirming", "cancelling"]);

/** Unmounted imperative model. Only explicit method calls perform RPCs. No effect,
 * mount callback, network retry, timer, subscription or recovery can sign a review.
 */
export function createReviewLifecycle(deps: ReviewLifecycleDependencies) {
  let identity: Readonly<ReviewIdentity> | null = null, epoch = 0;
  let state: Readonly<ReviewLifecycleState> = Object.freeze({ phase: "signed_out" });
  const listeners = new Set<() => void>();
  const publish = (next: ReviewLifecycleState) => {
    state = Object.freeze(next);
    for (const listener of listeners) { try { listener(); } catch { /* Observers have no mutation authority. */ } }
  };
  function capture() {
    if (!identity) throw new Error("Sign in before reviewing records");
    const current = identity, generation = epoch;
    const check = () => {
      if (epoch !== generation || !sameReviewIdentity(identity, current)) throw new Error("Staff session changed");
    };
    return { identity: current, check };
  }
  function requireAvailable() {
    if (busy.has(state.phase) || state.cleanupBusy) throw new Error("Wait for the current review request");
  }
  const pointerCopy = (p: RecordReviewPointer): Readonly<RecordReviewPointer> => Object.freeze({ ...p });
  function failed(check: () => void, pointer?: Readonly<RecordReviewPointer>, request?: Readonly<RecordReviewRequest>) {
    try {
      check();
      publish(pointer ? { phase: "unknown", pointer, request, message: "Outcome unconfirmed. Recover or cancel the original operation before starting another review." } :
        { phase: "attention", message: "Preparation could not start. Check recovery storage before continuing." });
    } catch { /* An obsolete session must not publish packet or operation state. */ }
  }
  async function clearResolvedPointer(p: Readonly<RecordReviewPointer>, outcome: OwnedReviewOutcome, check: () => void) {
    // Permanent owned closure has already been independently checked. Another
    // tab may have removed this exact pointer first. Read-only absence can finish
    // cleanup here; absence can never establish closure for an unresolved UUID.
    check();
    try { await deps.pointers.resolve(p, outcome); check(); }
    catch {
      check();
      const remaining = deps.pointers.read(p.actor_id); check();
      if (remaining !== null) throw new Error("Recovery storage still needs cleanup");
    }
  }
  async function accept(raw: unknown, p: Readonly<RecordReviewPointer>, check: () => void,
    request?: Readonly<RecordReviewRequest>, from?: "prepare" | "read" | "execute" | "cancel") {
    check();
    // A saved result always wins cancellation, including a lost execute response.
    const resolved = (() => { try { return verifyOwnedReviewOutcome(p, raw); } catch { return null; } })();
    if (resolved) {
      if (resolved.state === "saved") {
        reviewProtocolInstantSchema.parse(resolved.data.receipt.recorded_at);
        if (request && resolved.data.receipt.decision !== request.decision) throw new Error("Saved decision differs");
        Object.freeze(resolved.data.receipt);
      } else reviewProtocolInstantSchema.parse(resolved.data.cancelled_at);
      Object.freeze(resolved.data); Object.freeze(resolved);
      check();
      publish({ phase: "resolved", pointer: p, outcome: resolved, cleanupPending: true, cleanupBusy: true });
      try {
        check(); await clearResolvedPointer(p, resolved, check); check();
        publish({ phase: "resolved", outcome: resolved, cleanupPending: false });
      } catch {
        check();
        // A proven saved decision stays visible even when storage is unavailable.
        publish({ phase: "resolved", pointer: p, outcome: resolved, cleanupPending: true,
          message: "The outcome is confirmed. Recovery storage still needs cleanup; do not submit it again." });
      }
      return;
    }
    if (raw && typeof raw === "object" && "state" in raw && raw.state === "prepared") {
      if (from !== "prepare" && from !== "read") throw new Error("Unexpected prepared response");
      const prepared = await verifyPreparedReview(p, raw, deps.evidence, check, request); check();
      publish({ phase: "review", pointer: p, request: prepared.data.request, prepared, reviewed: false });
      return;
    }
    if (from !== "read") throw new Error("Mutation outcome is unconfirmed");
    const result = unavailable.parse(raw);
    if (result.data.operation_id !== p.operation_id || ("transport_digest" in result.data && result.data.transport_digest !== p.transport_digest))
      throw new Error("Recovery operation differs");
    check();
    publish({ phase: "attention", pointer: p, request, operationState: result.state,
      message: result.state === "not_found" ? "No preparation is visible yet. This does not close the original operation; recover again or explicitly cancel it." :
        "This preparation cannot be signed. Keep the original operation until its cancellation or saved outcome is confirmed." });
  }
  async function ownedCall(method: "read" | "execute" | "cancel") {
    requireAvailable();
    const c = capture(), old = state;
    const p = old.pointer ?? (method === "read" ? deps.pointers.read(c.identity.actorId) : null);
    if (!p || p.actor_id !== c.identity.actorId) throw new Error("Recover the original review first");
    if (method === "execute" && (old.phase !== "review" || !old.reviewed || !old.prepared))
      throw new Error("Review the prepared packet before confirming");
    if (method !== "read" && old.phase === "resolved") throw new Error("This outcome is already confirmed");
    publish({ phase: method === "read" ? "recovering" : method === "execute" ? "confirming" : "cancelling", pointer: p, request: old.request });
    try {
      c.check();
      const response = await deps.rpc.call(`${method}_controlled_record_review_v3`, { actor_id: p.actor_id, operation_id: p.operation_id }, c.identity, c.check);
      c.check(); await accept(response, p, c.check, old.request, method); c.check();
    } catch { failed(c.check, p, old.request); }
  }
  return {
    getSnapshot: () => state,
    getIdentityRevision: () => epoch,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    /** Call synchronously from the owning Auth boundary on actor/session changes.
     * Same actor with a new session may recover the minimal saved commitment.
     */
    setIdentity(input: ReviewIdentity | null) {
      const next = input === null ? null : parseReviewIdentity(input);
      if (sameReviewIdentity(identity, next)) return;
      epoch++; identity = next;
      if (!next) { publish({ phase: "signed_out" }); return; }
      try {
        const pointer = deps.pointers.read(next.actorId);
        publish(pointer ? { phase: "recoverable", pointer: pointerCopy(pointer) } : { phase: "idle" });
      } catch { publish({ phase: "attention", message: "Original recovery details need attention; preparation is unavailable." }); }
    },
    async prepare(input: unknown) {
      requireAvailable();
      const c = capture();
      if (state.phase !== "idle") throw new Error("Resolve the original operation before preparing another review");
      const parsed = recordReviewRequestSchema.safeParse(input);
      if (!parsed.success) throw new Error("The review request is invalid");
      const request = Object.freeze(parsed.data);
      if (request.actor_id !== c.identity.actorId) throw new Error("Review belongs to another staff account");
      publish({ phase: "preparing" });
      let pointer: Readonly<RecordReviewPointer> | undefined;
      try {
        const digest = await (deps.digest ?? reviewTransportDigest)(request); c.check();
        // No mutation before the exact actor-scoped durable reservation succeeds.
        const reservation = await deps.pointers.reserve({ version: 3, actor_id: request.actor_id,
          operation_id: request.operation_id, transport_digest: digest }); c.check();
        pointer = pointerCopy(reservation.pointer);
        if (!reservation.reserved) { publish({ phase: "recoverable", pointer }); return; }
        const response = await deps.rpc.call("prepare_controlled_record_review_v3", request, c.identity, c.check); c.check();
        await accept(response, pointer, c.check, request, "prepare"); c.check();
      } catch { failed(c.check, pointer, request); }
    },
    /** Separate staff review action. This alone never invokes an RPC. */
    acknowledgeReview(prepared: PreparedReview) {
      capture().check();
      if (state.phase !== "review" || state.prepared !== prepared) throw new Error("Review the currently displayed preparation");
      publish({ ...state, reviewed: true });
    },
    confirm: () => ownedCall("execute"),
    recover: () => ownedCall("read"),
    cancel: () => ownedCall("cancel"),
    /** A failed local reservation sent no mutation. Re-read durable storage
     * explicitly; never use this to discard an already known operation. */
    reloadRecovery() {
      capture().check(); requireAvailable();
      if (state.pointer || state.phase !== "attention") throw new Error("Keep the original operation until confirmed closure");
      try {
        const p = deps.pointers.read(identity!.actorId);
        publish(p ? { phase: "recoverable", pointer: pointerCopy(p) } : { phase: "idle" });
      } catch { publish({ phase: "attention", message: "Original recovery details need attention; preparation is unavailable." }); }
    },
    /** Only already proven owned closure can clear storage. Never executes. */
    async cleanup() {
      requireAvailable(); const c = capture(), old = state;
      if (old.phase !== "resolved" || !old.pointer || !old.outcome) throw new Error("No confirmed outcome needs cleanup");
      publish({ ...old, cleanupBusy: true });
      try {
        c.check(); await clearResolvedPointer(old.pointer, old.outcome, c.check); c.check();
        publish({ phase: "resolved", outcome: old.outcome, cleanupPending: false });
      } catch { c.check(); publish({ ...old, cleanupBusy: false, cleanupPending: true, message: "The outcome is confirmed. Recovery storage still needs cleanup." }); }
    },
    /** New work is possible only after permanent owned closure and local cleanup. */
    startAnother() {
      capture().check(); requireAvailable();
      if (state.phase !== "resolved" || state.cleanupPending) throw new Error("Resolve the original operation first");
      publish({ phase: "idle" });
    },
  };
}
