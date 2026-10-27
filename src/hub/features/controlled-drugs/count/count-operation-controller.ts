import { z } from "zod";
import { ControlledOperationNotSentError } from "../operation-errors.ts";
import type { ReviewIdentity } from "../record-review/raw-rpc.ts";
import type { CountClient } from "./count-client.ts";
import { parseCountRequest, type CountMutationAction, type CountSavedReply } from "./count-request-schema.ts";
import { parseCountOperationClosureRequest, type CountOperationClosureReply, type CountOperationClosureRequest } from "./count-operation-closure.ts";
import { parseCountPolicyClosureRequest, parseCountPolicyPublishRequest, type CountPolicyClosureRequest, type CountPolicyClosureReply, type CountPolicyPublishReceipt } from "./count-admin-schema.ts";
import { parseCountManagementReply, parseCountManagementRequest, type CountManagementMutationAction, type CountManagementSavedReply } from "./count-management-schema.ts";

export type CountRecoveryPointer = CountOperationClosureRequest | CountPolicyClosureRequest;

export interface CountPointerStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export interface CountOperationLock {
  exclusive<T>(name: string, task: () => Promise<T>): Promise<T>;
}
export interface CountOperationController {
  pending(actorId: string): CountRecoveryPointer | null;
  mutate(action: CountMutationAction, input: unknown, scope: { readonly product_id: string; readonly site_id: string }, identity: ReviewIdentity): Promise<CountSavedReply>;
  publishPolicy(input: unknown, identity: ReviewIdentity): Promise<CountPolicyPublishReceipt>;
  manage(action: CountManagementMutationAction, input: unknown, anchor: unknown, identity: ReviewIdentity): Promise<CountManagementSavedReply>;
  recover(mode: "read" | "close", identity: ReviewIdentity): Promise<CountOperationClosureReply | CountPolicyClosureReply>;
}
const actorSchema = z.string().regex(/^(?!00000000-0000-0000-0000-000000000000$)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
function blocked(): never { throw new Error("A previous count save needs recovery before you continue."); }
export function countOperationStorageKey(actorId: string): string {
  const parsed = actorSchema.safeParse(actorId); if (!parsed.success) blocked();
  return `lrv:controlled-count-operation:v1:${parsed.data}`;
}
/** Cross-tab serialization is mandatory for saving; no unsafe fallback lock. */
export function browserCountOperationLock(): CountOperationLock {
  return { async exclusive<T>(name: string, task: () => Promise<T>): Promise<T> {
    if (!globalThis.navigator?.locks) throw new Error("This browser cannot safely coordinate count saves. Use a current supported browser.");
    return navigator.locks.request(name, { mode: "exclusive", ifAvailable: true }, async lock => {
      if (!lock) blocked();
      return task();
    });
  } };
}
/** Persist only IDs before sending. Observations and the original body stay in memory.
 * A missing result never authorizes resending or deleting this recovery pointer.
 */
export function createCountOperationController(client: CountClient, storage: CountPointerStorage, locks: CountOperationLock): CountOperationController {
  function pending(actorId: string): CountRecoveryPointer | null {
    try {
      const text = storage.getItem(countOperationStorageKey(actorId));
      if (text === null) return null;
      if (typeof text !== "string" || text.length > 4096) blocked();
      const input = JSON.parse(text);
      // Existing V1 pointers retain their original bytes and closure endpoint.
      const pointer = input?.schema_version === 2 ? parseCountPolicyClosureRequest(input) : parseCountOperationClosureRequest(input);
      // Our own canonical serialization also refuses duplicate JSON keys/corrupt values.
      if (pointer.actor_id !== actorId || JSON.stringify(pointer) !== text) blocked();
      return pointer;
    } catch { return blocked(); }
  }
  function retain(pointer: CountRecoveryPointer): void {
    if (pending(pointer.actor_id)) blocked();
    const key = countOperationStorageKey(pointer.actor_id), serialized = JSON.stringify(pointer);
    storage.setItem(key, serialized);
    if (storage.getItem(key) !== serialized) blocked();
  }
  function clear(pointer: CountRecoveryPointer): void {
    const stored = pending(pointer.actor_id);
    if (!stored || JSON.stringify(stored) !== JSON.stringify(pointer)) blocked();
    const key = countOperationStorageKey(pointer.actor_id);
    storage.removeItem(key);
    if (storage.getItem(key) !== null) blocked();
  }
  async function send<T>(actorId: string, work: (invoked: () => void) => Promise<T>): Promise<T> {
    let invoked = false;
    try { return await locks.exclusive(countOperationStorageKey(actorId), () => work(() => { invoked = true; })); }
    catch (error) {
      if (!invoked) throw new ControlledOperationNotSentError();
      // A downstream error cannot forge the coordinator's pre-client boundary.
      if (error instanceof ControlledOperationNotSentError) throw new Error("The count outcome remains unconfirmed.");
      throw error;
    }
  }
  return Object.freeze({
    pending,
    mutate(action: CountMutationAction, input: unknown, scope: { readonly product_id: string; readonly site_id: string }, identity: ReviewIdentity) {
      const request = parseCountRequest(action, input);
      const pointer = parseCountOperationClosureRequest({ schema_version: 1, actor_id: request.actor_id, operation_id: request.operation_id,
        original_action: action, scope_id: request.count_id, product_id: scope.product_id, site_id: scope.site_id });
      if (pointer.actor_id !== identity.actorId || (action === "start" && "product_id" in request &&
        (request.product_id !== pointer.product_id || request.site_id !== pointer.site_id))) blocked();
      return send(identity.actorId, async invoked => {
        retain(pointer);
        invoked();
        // The client admits the exact original request and verifies the saved receipt.
        const saved = await client.mutate(action, request, identity);
        clear(pointer);
        return saved;
      });
    },
    publishPolicy(input: unknown, identity: ReviewIdentity) {
      const request = parseCountPolicyPublishRequest(input);
      const pointer = parseCountPolicyClosureRequest({ schema_version: 2, actor_id: request.actor_id, operation_id: request.operation_id,
        original_action: "policy_publish", scope_id: request.operation_id, product_id: request.product_id, site_id: request.site_id });
      if (request.actor_id !== identity.actorId) blocked();
      return send(identity.actorId, async invoked => {
        retain(pointer);
        invoked();
        const receipt = await client.publishPolicy(request, identity);
        clear(pointer); return receipt;
      });
    },
    manage(action: CountManagementMutationAction, input: unknown, anchorInput: unknown, identity: ReviewIdentity) {
      const request = parseCountManagementRequest(action, input);
      let scopeId: string;
      if (action === "reconciliation_prepare" && "reconciliation_id" in request) scopeId = request.reconciliation_id;
      else if (action === "cause_resolve" && "cause_id" in request) scopeId = request.cause_id;
      else {
        const anchor = parseCountManagementReply(anchorInput);
        if (anchor.state !== "available" || anchor.data.product_id !== request.product_id || anchor.data.site_id !== request.site_id) blocked();
        if ((action === "reconciliation_approve" || action === "reconciliation_execute") && (! ("preparation_id" in request) || request.preparation_id !== anchor.data.preparation_id)) blocked();
        if (action === "reconciliation_execute" && (!("approval_id" in request) || request.approval_id !== anchor.data.approval_id)) blocked();
        if (action === "reconciliation_confirm" && (!("execution_id" in request) || request.execution_id !== anchor.data.execution_id)) blocked();
        scopeId = anchor.data.reconciliation_id;
      }
      const pointer = parseCountOperationClosureRequest({ schema_version: 1, actor_id: request.actor_id, operation_id: request.operation_id,
        original_action: action, scope_id: scopeId, product_id: request.product_id, site_id: request.site_id });
      if (request.actor_id !== identity.actorId) blocked();
      return send(identity.actorId, async invoked => {
        retain(pointer);
        invoked();
        const receipt = await client.manage(action, request, identity);
        clear(pointer); return receipt;
      });
    },
    recover(mode: "read" | "close", identity: ReviewIdentity) {
      if (mode !== "read" && mode !== "close") blocked();
      return locks.exclusive(countOperationStorageKey(identity.actorId), async () => {
        const pointer = pending(identity.actorId); if (!pointer) blocked();
        const result = pointer.schema_version === 2 ? await client.policyClosure(mode, pointer, identity) : await client.closure(mode, pointer, identity);
        if (result.state !== "pending") clear(pointer);
        return result;
      });
    },
  });
}
