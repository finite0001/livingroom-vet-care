import { ExactJsonNumber } from "./exact-json.ts";
import { reviewPreparedResponseSchema, type PreparedReviewPacket, type ReviewEvidenceAdmission } from "./prepared-packet.ts";
import { reviewDetailResponseSchema, type ReviewDetailResponse, type ReviewDetailEvidenceAdmission } from "./read-detail.ts";
import type { ReviewDetailRequest, ReviewReadRpc } from "./read-rpc.ts";
import type { ReviewIdentity } from "./raw-rpc.ts";
import type { ReviewStaffSessionSource } from "./staff-session.ts";
import { recordReviewRequestSchema, reviewTransportDigest, type RecordReviewRequest } from "./request.ts";
import { verifyProspectiveComponentConsistency } from "./prospective-component-consistency.ts";

function invalid(): never { throw new Error("The current backend could not admit this exact review evidence."); }
/** Complete value comparison only. Never serializes/hashes P or normalizes a
 * number, timestamp, Unicode string, array order or membership. */
export function sameLosslessReviewValue(first: unknown, second: unknown): boolean {
  let visits = 0, bytes = 0;
  const encoder = new TextEncoder(), ancestorsA = new WeakSet<object>(), ancestorsB = new WeakSet<object>();
  const textEqual = (a: string, b: string) => {
    if (a.length > 2 * 1024 * 1024 || b.length > 2 * 1024 * 1024) return false;
    bytes += encoder.encode(a).length + encoder.encode(b).length;
    return bytes <= 4 * 1024 * 1024 && a === b;
  };
  function numberToken(value: ExactJsonNumber): string | null {
    if (Object.getPrototypeOf(value) !== ExactJsonNumber.prototype || Reflect.ownKeys(value).length !== 1) return null;
    const property = Object.getOwnPropertyDescriptor(value, "token");
    return property?.enumerable && "value" in property && typeof property.value === "string" && property.value.length <= 1024 &&
      /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/.test(property.value) ? property.value : null;
  }
  function visit(a: unknown, b: unknown, depth: number): boolean {
    if (++visits > 100000 || depth > 64) return false;
    if (a === null || b === null) return a === b;
    if (typeof a === "string" && typeof b === "string") return textEqual(a, b);
    if (typeof a === "boolean" && typeof b === "boolean") return a === b;
    if (a instanceof ExactJsonNumber || b instanceof ExactJsonNumber) {
      if (!(a instanceof ExactJsonNumber) || !(b instanceof ExactJsonNumber)) return false;
      const left = numberToken(a), right = numberToken(b);
      return left !== null && right !== null && textEqual(left, right);
    }
    // Ordinary JS numbers cannot stand in for original numeric evidence.
    if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b) || ancestorsA.has(a) || ancestorsB.has(b)) return false;
    if (!Array.isArray(a) && (![Object.prototype, null].includes(Object.getPrototypeOf(a)) || ![Object.prototype, null].includes(Object.getPrototypeOf(b)))) return false;
    const keysA = Reflect.ownKeys(a), keysB = Reflect.ownKeys(b);
    if (keysA.length > 100000 || keysA.length !== keysB.length || keysA.some(key => typeof key !== "string") || keysB.some(key => typeof key !== "string")) return false;
    if (Array.isArray(a)) {
      if (Object.getPrototypeOf(a) !== Array.prototype || Object.getPrototypeOf(b) !== Array.prototype) return false;
      const lengthA = Object.getOwnPropertyDescriptor(a, "length")?.value, lengthB = Object.getOwnPropertyDescriptor(b, "length")?.value;
      if (!Number.isInteger(lengthA) || lengthA !== lengthB || keysA.length !== lengthA + 1) return false;
      // A sparse array plus an unrelated property is not a JSON array. Conversion
      // here is solely a bounded array index; source numeric tokens stay exact.
      const indexKey = (key: PropertyKey) => key === "length" ||
        typeof key === "string" && /^(0|[1-9][0-9]*)$/.test(key) && key.length <= 10 && Number(key) < lengthA;
      if (!keysA.every(indexKey) || !keysB.every(indexKey)) return false;
    }
    const leftKeys = (keysA as string[]).sort(), rightKeys = (keysB as string[]).sort();
    ancestorsA.add(a); ancestorsB.add(b);
    try {
      for (let index = 0; index < leftKeys.length; index++) {
        const key = leftKeys[index];
        if (!textEqual(key, rightKeys[index])) return false;
        const left = Object.getOwnPropertyDescriptor(a, key), right = Object.getOwnPropertyDescriptor(b, key);
        if (!left || !right || !("value" in left) || !("value" in right)) return false;
        if (Array.isArray(a) && key === "length") continue;
        if (!left.enumerable || !right.enumerable || !visit(left.value, right.value, depth + 1)) return false;
      }
      return true;
    } finally { ancestorsA.delete(a); ancestorsB.delete(b); }
  }
  try { return visit(first, second, 0); } catch { return false; }
}

export interface ReconstructedReviewEvidence {
  readonly prepared: ReviewEvidenceAdmission; readonly detail: ReviewDetailEvidenceAdmission;
}
/** Requires the separately reviewed, installed full-register source profile.
 * Its endpoint reconstructs full evidence under current Auth and module checks.
 * A missing/unsupported/mismatched backend always refuses. Local component
 * checks supplement this authenticated reconstruction; they are never a fallback.
 */
export function createReconstructedReviewEvidence(reads: ReviewReadRpc, sessions: ReviewStaffSessionSource): ReconstructedReviewEvidence {
  function capture(actorId: string): { identity: ReviewIdentity; check: () => void } {
    const value = sessions.getSnapshot();
    if (!value || value.actorId !== actorId || !sessions.isCurrent(value)) invalid();
    const identity = Object.freeze({ ...value });
    return { identity, check: () => { if (!sessions.isCurrent(identity)) invalid(); } };
  }
  return Object.freeze({
    prepared: Object.freeze({ async validate(packet: Readonly<PreparedReviewPacket>, requestInput: Readonly<RecordReviewRequest>) {
      const request = Object.freeze(recordReviewRequestSchema.parse(requestInput)), { identity, check } = capture(request.actor_id);
      check();
      const fresh = reviewPreparedResponseSchema.parse(await reads.call("get_controlled_record_review_admission_v1", {
        schema_version: 1, actor_id: request.actor_id, event_id: request.event_id, operation_id: request.operation_id, view: "prepared",
      }, identity, check));
      check();
      if (fresh.data.operation_id !== request.operation_id || !sameLosslessReviewValue(fresh.data.request, request) ||
        fresh.data.transport_digest !== await reviewTransportDigest(request)) invalid();
      check();
      if (!sameLosslessReviewValue(fresh.data.packet, packet)) invalid();
      await verifyProspectiveComponentConsistency(packet, { event_id: request.event_id }); check();
    } }),
    detail: Object.freeze({ async validate(responseInput: Readonly<ReviewDetailResponse>, request: Readonly<ReviewDetailRequest>) {
      const original = reviewDetailResponseSchema.parse(responseInput), { identity, check } = capture(request.actor_id);
      if (original.data.summary.event_id !== request.event_id) invalid();
      check();
      const fresh = reviewDetailResponseSchema.parse(await reads.call("get_controlled_record_review_admission_v1", {
        schema_version: 1, actor_id: request.actor_id, event_id: request.event_id, operation_id: null, view: "detail",
      }, identity, check));
      check();
      if (fresh.data.summary.event_id !== request.event_id || !sameLosslessReviewValue(fresh, original)) invalid();
    } }),
  });
}
