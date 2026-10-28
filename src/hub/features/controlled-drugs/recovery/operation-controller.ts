import { z } from "zod";
import type { ReviewIdentity } from "../record-review/raw-rpc.ts";
import type { CountOperationLock, CountPointerStorage } from "../count/count-operation-controller.ts";
import { registerId } from "../register/schema.ts";
import type { RecoveryClient } from "./client.ts";
import { recoveryPointer, recoveryRequest, type RecoveryPointer, type RecoveryPointerReply, type RecoveryReceipt } from "./schema.ts";

export interface RecoveryOperations {
  pending(actorId: string): RecoveryPointer | null;
  save(input: unknown, identity: ReviewIdentity): Promise<RecoveryReceipt>;
  recover(mode: "read" | "close", identity: ReviewIdentity): Promise<RecoveryPointerReply>;
}
function blocked(): never { throw new Error("Check or permanently close the previous recovery operation before starting another."); }
export function recoveryStorageKey(project: string, actorId: string): string {
  return `lrv:narcotics-recovery:v1:${z.string().regex(/^[a-z]{20}$/).parse(project)}:${registerId.parse(actorId)}`;
}
/** Only four identifying fields survive reload; files and request bodies do not. */
export function createRecoveryOperations(project: string, client: RecoveryClient, storage: CountPointerStorage, locks: CountOperationLock): RecoveryOperations {
  function pending(actorId: string): RecoveryPointer | null {
    try {
      const raw = storage.getItem(recoveryStorageKey(project, actorId));
      if (raw === null) return null;
      if (raw.length > 1024) blocked();
      const pointer = recoveryPointer.parse(JSON.parse(raw));
      if (pointer.actor_id !== actorId || JSON.stringify(pointer) !== raw) blocked();
      return Object.freeze(pointer);
    } catch { return blocked(); }
  }
  function clear(pointer: RecoveryPointer) {
    if (JSON.stringify(pending(pointer.actor_id)) !== JSON.stringify(pointer)) blocked();
    const key = recoveryStorageKey(project, pointer.actor_id); storage.removeItem(key);
    if (storage.getItem(key) !== null) blocked();
  }
  return Object.freeze({
    pending,
    save(input: unknown, identity: ReviewIdentity) {
      const request = recoveryRequest.parse(input), pointer = recoveryPointer.parse({ schema_version: 1, actor_id: request.actor_id, operation_id: request.operation_id, action: request.action });
      if (pointer.actor_id !== identity.actorId || request.action === "start_count" &&
        (request.data.request.actor_id !== request.actor_id || request.data.request.operation_id !== request.operation_id)) blocked();
      return locks.exclusive(recoveryStorageKey(project, identity.actorId), async () => {
        if (pending(identity.actorId)) blocked();
        const key = recoveryStorageKey(project, identity.actorId), serialized = JSON.stringify(pointer);
        storage.setItem(key, serialized); if (storage.getItem(key) !== serialized) blocked();
        const result = await client.save(request, identity);
        if (result.actor_id !== pointer.actor_id || result.operation_id !== pointer.operation_id || result.action !== pointer.action || result.state !== "saved") blocked();
        clear(pointer); return result;
      });
    },
    recover(mode: "read" | "close", identity: ReviewIdentity) {
      return locks.exclusive(recoveryStorageKey(project, identity.actorId), async () => {
        const pointer = pending(identity.actorId); if (!pointer) blocked();
        const result = await client.recover(mode, pointer, identity);
        if (result.actor_id !== pointer.actor_id || result.operation_id !== pointer.operation_id || result.action !== pointer.action ||
          (result.state === "saved") !== (result.receipt !== null)) blocked();
        if (result.state === "saved" || result.state === "abandoned") clear(pointer);
        return result;
      });
    },
  });
}
