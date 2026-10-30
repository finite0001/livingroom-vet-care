import type { ReviewIdentity } from "../record-review/raw-rpc.ts";
import type { ReviewStaffSessionSource } from "../record-review/staff-session.ts";
import { reviewUuidSchema } from "../record-review/request.ts";
import { sameEntryJson } from "../entry/codec.ts";
import type { EntryLock, EntryStorage } from "../entry/service.ts";
import type { WitnessClient } from "./client.ts";
import { witnessPointerSchema, witnessTaskSchema, type WitnessPointer, type WitnessReceipt, type WitnessReply, type WitnessTask } from "./schema.ts";

export interface WitnessService {
  pending(actorId: string): Readonly<WitnessPointer> | null;
  open(task: WitnessTask, identity: Readonly<ReviewIdentity>): Promise<WitnessReply>;
  inspect(identity: Readonly<ReviewIdentity>): Promise<WitnessReply>;
  attest(displayed: WitnessReply, identity: Readonly<ReviewIdentity>, attestWitness: true): Promise<WitnessReceipt>;
  recover(mode: "read" | "close", identity: Readonly<ReviewIdentity>): Promise<WitnessReply>;
}
function invalid(): never { throw new Error("Preserve the original witness operation. Check or close it before another attestation."); }
export function witnessStorageKey(actorId: string): string {
  reviewUuidSchema.parse(actorId);
  return "lrv:controlled-stock-witness:v1:" + actorId;
}
export function createWitnessService(client: WitnessClient, sessions: ReviewStaffSessionSource, storage: EntryStorage, locks: EntryLock,
  newId: () => string = () => crypto.randomUUID()): WitnessService {
  const remembered = new Map<string, Readonly<WitnessPointer>>();
  const check = (identity: Readonly<ReviewIdentity>) => { if (!sessions.isCurrent(identity)) invalid(); };
  function pending(actorId: string): Readonly<WitnessPointer> | null {
    const text = storage.getItem(witnessStorageKey(actorId));
    if (text === null) return remembered.get(actorId) ?? null;
    if (text.length > 8192) invalid();
    const pointer = witnessPointerSchema.parse(JSON.parse(text));
    if (pointer.actor_id !== actorId || JSON.stringify(pointer) !== text || remembered.has(actorId) && !sameEntryJson(remembered.get(actorId), pointer)) invalid();
    return Object.freeze(pointer);
  }
  function retain(pointer: WitnessPointer): void {
    if (pending(pointer.actor_id)) invalid();
    remembered.set(pointer.actor_id, pointer);
    const text = JSON.stringify(pointer); storage.setItem(witnessStorageKey(pointer.actor_id), text);
    if (storage.getItem(witnessStorageKey(pointer.actor_id)) !== text) invalid();
  }
  function clear(pointer: WitnessPointer): void {
    if (!sameEntryJson(pending(pointer.actor_id), pointer)) invalid();
    const key = witnessStorageKey(pointer.actor_id), text = JSON.stringify(pointer);
    try { storage.removeItem(key); if (storage.getItem(key) !== null) invalid(); }
    catch { try { storage.setItem(key, text); } catch { /* The same IDs remain in memory. */ } invalid(); }
    remembered.delete(pointer.actor_id);
  }
  const locked = <T,>(identity: Readonly<ReviewIdentity>, work: (pointer: Readonly<WitnessPointer>) => Promise<T>) =>
    locks.exclusive(witnessStorageKey(identity.actorId), async () => { check(identity); const pointer = pending(identity.actorId); if (!pointer) invalid(); return work(pointer); });
  const service: WitnessService = {
    pending,
    open(input, identity) {
      const task = witnessTaskSchema.parse(input); check(identity); if (task.recorder.id === identity.actorId) invalid();
      return locks.exclusive(witnessStorageKey(identity.actorId), async () => {
        check(identity); let pointer = pending(identity.actorId);
        if (pointer) {
          if (pointer.parent_action_id !== task.parent_action_id || pointer.writer !== task.writer || pointer.product_id !== task.product_id || pointer.event_kind !== task.event_kind) invalid();
        } else {
          pointer = Object.freeze(witnessPointerSchema.parse({ schema_version: 1, actor_id: identity.actorId, operation_id: newId(),
            parent_action_id: task.parent_action_id, writer: task.writer, product_id: task.product_id, event_kind: task.event_kind }));
          // ID-only persistence is verified before the first asynchronous read.
          retain(pointer);
        }
        const reply = await client.read(pointer, identity); check(identity); return reply;
      });
    },
    inspect(identity) { return locked(identity, async pointer => { const reply = await client.read(pointer, identity); check(identity); return reply; }); },
    attest(displayed, identity, attestWitness) {
      if (attestWitness !== true) invalid();
      return locked(identity, async pointer => {
        if (!sameEntryJson(pointer, displayed.data.pointer)) invalid();
        const receipt = await client.attest(pointer, displayed, identity, attestWitness); check(identity); clear(pointer); check(identity); return receipt;
      });
    },
    recover(mode, identity) {
      return locked(identity, async pointer => {
        const reply = await (mode === "close" ? client.close(pointer, identity) : client.operation(pointer, identity)); check(identity);
        if (reply.state === "saved" || reply.state === "abandoned") { clear(pointer); check(identity); }
        // not_found is not evidence that an in-flight save cannot arrive.
        return reply;
      });
    },
  };
  return Object.freeze(service);
}
