import { z } from "zod";
import type { ReviewIdentity } from "../record-review/raw-rpc.ts";
import type { CountOperationLock, CountPointerStorage } from "../count/count-operation-controller.ts";
import type { RegisterClient } from "./client.ts";
import { registerFormRequest, registerId, registerPointer, registerReportRequest, type RegisterPointer, type RegisterReply } from "./schema.ts";

export interface RegisterOperations {
  pending(actorId: string): RegisterPointer | null;
  save(kind: "report" | "form", input: unknown, identity: ReviewIdentity): Promise<RegisterReply>;
  recover(mode: "read" | "close", identity: ReviewIdentity): Promise<RegisterReply>;
}
function blocked(): never { throw new Error("Recover the previous register operation before saving another."); }
export function registerStorageKey(project: string, actorId: string): string {
  return `lrv:narcotics-register:v1:${z.string().regex(/^[a-z]{20}$/).parse(project)}:${registerId.parse(actorId)}`;
}
/** IDs only survive reload. A not_found result never authorizes a replacement save. */
export function createRegisterOperations(project: string, client: RegisterClient, storage: CountPointerStorage, locks: CountOperationLock): RegisterOperations {
  function pending(actorId: string): RegisterPointer | null {
    try {
      const raw = storage.getItem(registerStorageKey(project, actorId));
      if (raw === null) return null;
      if (raw.length > 1024) blocked();
      const pointer = registerPointer.parse(JSON.parse(raw));
      if (pointer.actor_id !== actorId || JSON.stringify(pointer) !== raw) blocked();
      return Object.freeze(pointer) as RegisterPointer;
    } catch { return blocked(); }
  }
  function clear(pointer: RegisterPointer) {
    if (JSON.stringify(pending(pointer.actor_id)) !== JSON.stringify(pointer)) blocked();
    const key = registerStorageKey(project, pointer.actor_id); storage.removeItem(key);
    if (storage.getItem(key) !== null) blocked();
  }
  function matched(pointer: RegisterPointer, result: RegisterReply) {
    if (result.operation_id !== pointer.operation_id || result.kind !== pointer.kind || result.state === "saved" &&
      (result.actor_id !== pointer.actor_id || result.request_metadata.actor_id !== pointer.actor_id || result.request_metadata.operation_id !== pointer.operation_id ||
       result.request_metadata.product_id !== pointer.product_id || result.request_metadata.site_id !== pointer.site_id)) blocked();
  }
  const operations: RegisterOperations = {
    pending,
    save(kind, input, identity) {
      const request = kind === "report" ? registerReportRequest.parse(input) : registerFormRequest.parse(input);
      const pointer = registerPointer.parse({ schema_version: 1, actor_id: request.actor_id, operation_id: request.operation_id, product_id: request.product_id, site_id: request.site_id, kind }) as RegisterPointer;
      if (pointer.actor_id !== identity.actorId) blocked();
      return locks.exclusive(registerStorageKey(project, identity.actorId), async () => {
        if (pending(identity.actorId)) blocked();
        const key = registerStorageKey(project, identity.actorId), serialized = JSON.stringify(pointer);
        storage.setItem(key, serialized);
        if (storage.getItem(key) !== serialized) blocked();
        const result = await client.save(kind, request, identity);
        matched(pointer, result); if (result.state !== "saved") blocked();
        clear(pointer); return result;
      });
    },
    recover(mode, identity) {
      return locks.exclusive(registerStorageKey(project, identity.actorId), async () => {
        const pointer = pending(identity.actorId); if (!pointer) blocked();
        const result = await client.recover(mode, pointer, identity); matched(pointer, result);
        if (result.state === "saved" || result.state === "abandoned") clear(pointer);
        return result;
      });
    },
  };
  return Object.freeze(operations);
}
