import { z } from "zod";
import { reviewDigestSchema, reviewUuidSchema } from "./request.ts";
import { decodeExactJson, protocolInteger } from "./exact-json.ts";
import { verifyOwnedReviewOutcome } from "./owned-outcome.ts";

export const recordReviewPointerSchema = z.object({
  version: z.literal(3), actor_id: reviewUuidSchema, operation_id: reviewUuidSchema, transport_digest: reviewDigestSchema,
}).strict();
export interface RecordReviewPointer extends z.infer<typeof recordReviewPointerSchema> {}
export interface ReviewPointerStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export interface ReviewPointerLocks {
  request<T>(name: string, options: { mode: "exclusive" }, callback: () => T | PromiseLike<T>): Promise<T>;
}
const keyFor = (actor: string) => `lrv:record-review:v3:${reviewUuidSchema.parse(actor)}`;
const same = (a: RecordReviewPointer, b: RecordReviewPointer) => a.version === b.version && a.actor_id === b.actor_id &&
  a.operation_id === b.operation_id && a.transport_digest === b.transport_digest;

export function browserReviewPointerStore() {
  if (!globalThis.isSecureContext || !globalThis.navigator?.locks)
    throw new Error("Review preparation requires a secure browser with Web Locks");
  return createReviewPointerStore(globalThis.localStorage, globalThis.navigator.locks);
}

/** Instantiate in a secure supported browser. Never substitute an unlocked path. */
export function createReviewPointerStore(storage: ReviewPointerStorage, locks: ReviewPointerLocks) {
  if (!storage || !locks || typeof locks.request !== "function") throw new Error("Review preparation requires durable storage and Web Locks");
  function read(actor: string): RecordReviewPointer | null {
    const raw = storage.getItem(keyFor(actor));
    if (raw === null) return null;
    if (raw.length > 1024) throw new Error("Original review recovery details need attention");
    const decoded = decodeExactJson(new TextEncoder().encode(raw));
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded) || !("version" in decoded))
      throw new Error("Original review recovery details need attention");
    const pointer = recordReviewPointerSchema.parse({ ...decoded, version: protocolInteger(decoded.version, 3, 3) });
    if (pointer.actor_id !== actor) throw new Error("Original review belongs to another staff account");
    return pointer;
  }
  return {
    read,
    async reserve(input: unknown): Promise<{ pointer: RecordReviewPointer; reserved: boolean }> {
      const candidate = recordReviewPointerSchema.parse(input);
      return locks.request(keyFor(candidate.actor_id), { mode: "exclusive" }, () => {
        const existing = read(candidate.actor_id);
        if (existing) return { pointer: existing, reserved: false };
        storage.setItem(keyFor(candidate.actor_id), JSON.stringify(candidate));
        const saved = read(candidate.actor_id);
        if (!saved || !same(saved, candidate)) throw new Error("Review recovery details could not be saved");
        return { pointer: saved, reserved: true };
      });
    },
    /** Absence, timeout, close and expired states cannot authorize removal. */
    async resolve(input: unknown, outcome: unknown): Promise<void> {
      const resolved = recordReviewPointerSchema.parse(input);
      verifyOwnedReviewOutcome(resolved, outcome);
      await locks.request(keyFor(resolved.actor_id), { mode: "exclusive" }, () => {
        const existing = read(resolved.actor_id);
        if (!existing || !same(existing, resolved)) throw new Error("Original recovery details differ; retain them for checking");
        storage.removeItem(keyFor(resolved.actor_id));
        if (storage.getItem(keyFor(resolved.actor_id)) !== null) throw new Error("Saved result confirmed; recovery details still need cleanup");
      });
    },
  };
}
