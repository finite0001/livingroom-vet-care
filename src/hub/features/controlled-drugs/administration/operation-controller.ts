import type { ReviewIdentity } from "../record-review/raw-rpc.ts";
import { administrationPointerSchema, administrationRequestSchema, type AdministrationPointer, type AdministrationPreparation, type AdministrationReply } from "./schema.ts";
import { administrationRequestBytes } from "./wire.ts";
import { ControlledOperationNotSentError } from "../operation-errors.ts";

export interface AdministrationOperationTransport {
  prepare(input: unknown, identity: ReviewIdentity): Promise<Readonly<AdministrationReply>>;
  read(pointer: AdministrationPointer, identity: ReviewIdentity): Promise<Readonly<AdministrationReply>>;
  execute(preparation: AdministrationPreparation, identity: ReviewIdentity): Promise<Readonly<AdministrationReply>>;
  close(pointer: AdministrationPointer, identity: ReviewIdentity): Promise<Readonly<AdministrationReply>>;
}
export interface AdministrationPointerStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
export interface AdministrationOperationLocks { exclusive<T>(key: string, work: () => Promise<T>): Promise<T> }
export interface AdministrationOperationResult { readonly reply: Readonly<AdministrationReply>; readonly cleanup_pending: boolean }
export function administrationPointerKey(actorId: string): string {
  // Reuse the closed pointer grammar to admit the actor spelling without a cast.
  const pointer = administrationPointerSchema.parse({ schema_version: 1, actor_id: actorId, operation_id: actorId, action: "site_register", product_id: null, site_id: actorId });
  return `lrv:controlled-stock-administration:v1:${pointer.actor_id}`;
}
function blocked(): never { throw new Error("Check the original administrator operation before starting another."); }
function preflight<T>(work: () => T): T { try { return work(); } catch { throw new ControlledOperationNotSentError(); } }
const same = (a: AdministrationPointer, b: AdministrationPointer) => JSON.stringify(a) === JSON.stringify(b);
export function createAdministrationOperations(transport: AdministrationOperationTransport, storage: AdministrationPointerStorage, locks: AdministrationOperationLocks) {
  async function send<T>(identity: ReviewIdentity, work: (sent: () => void) => Promise<T>): Promise<T> {
    let entered = false;
    try { return await locks.exclusive(administrationPointerKey(identity.actorId), () => work(() => { entered = true; })); }
    catch (cause) {
      if (!entered) throw new ControlledOperationNotSentError();
      // A downstream exception cannot assert that an entered request was absent.
      if (cause instanceof ControlledOperationNotSentError) throw new Error("Check the original administrator operation.");
      throw cause;
    }
  }
  function pending(actorId: string): AdministrationPointer | null {
    try {
      const text = storage.getItem(administrationPointerKey(actorId));
      if (text === null) return null;
      if (typeof text !== "string" || text.length > 4096) blocked();
      const value = administrationPointerSchema.parse(JSON.parse(text));
      if (value.actor_id !== actorId || JSON.stringify(value) !== text) blocked();
      return Object.freeze(value);
    } catch { return blocked(); }
  }
  function original(identity: ReviewIdentity): AdministrationPointer {
    const value = pending(identity.actorId); if (!value) blocked(); return value;
  }
  function retain(pointer: AdministrationPointer) {
    if (pending(pointer.actor_id)) blocked();
    const bytes = JSON.stringify(pointer); storage.setItem(administrationPointerKey(pointer.actor_id), bytes);
    if (storage.getItem(administrationPointerKey(pointer.actor_id)) !== bytes) blocked();
  }
  function settle(pointer: AdministrationPointer, reply: Readonly<AdministrationReply>): AdministrationOperationResult {
    if (!same(pointer, reply.data.pointer)) blocked();
    if (reply.state !== "saved" && reply.state !== "abandoned") return Object.freeze({ reply, cleanup_pending: false });
    let cleanup = false;
    try {
      const value = pending(pointer.actor_id);
      // Absence only finishes local cleanup after a verified owned closure.
      if (value !== null) {
        if (!same(value, pointer)) blocked();
        storage.removeItem(administrationPointerKey(pointer.actor_id));
        if (storage.getItem(administrationPointerKey(pointer.actor_id)) !== null) blocked();
      }
    } catch { cleanup = true; }
    return Object.freeze({ reply, cleanup_pending: cleanup });
  }
  return Object.freeze({
    pending,
    prepare(input: unknown, identity: ReviewIdentity) {
      const request = preflight(() => administrationRequestSchema.parse(input)); preflight(() => administrationRequestBytes(request));
      const pointer = preflight(() => administrationPointerSchema.parse({ schema_version: request.schema_version, actor_id: request.actor_id, operation_id: request.operation_id,
        action: request.action, product_id: request.product_id, site_id: request.site_id }));
      if (pointer.actor_id !== identity.actorId) throw new ControlledOperationNotSentError();
      return send(identity, async sent => {
        retain(pointer); sent(); return settle(pointer, await transport.prepare(request, identity));
      });
    },
    execute(preparation: AdministrationPreparation, identity: ReviewIdentity) {
      const request = preflight(() => administrationRequestSchema.parse(preparation.request));
      if (request.actor_id !== identity.actorId || preparation.source_state !== "current") throw new ControlledOperationNotSentError();
      return send(identity, async sent => {
        const pointer = original(identity);
        if (pointer.operation_id !== request.operation_id || pointer.action !== request.action || pointer.product_id !== request.product_id || pointer.site_id !== request.site_id) blocked();
        sent(); return settle(pointer, await transport.execute(preparation, identity));
      });
    },
    recover(mode: "read" | "close", identity: ReviewIdentity) {
      if (mode !== "read" && mode !== "close") blocked();
      return send(identity, async sent => {
        const pointer = original(identity);
        sent();
        return settle(pointer, await (mode === "read" ? transport.read(pointer, identity) : transport.close(pointer, identity)));
      });
    },
    readOwned(pointerInput: AdministrationPointer, identity: ReviewIdentity) {
      const pointer = administrationPointerSchema.parse(pointerInput);
      if (pointer.actor_id !== identity.actorId) blocked();
      return send(identity, async sent => {
        const current = pending(identity.actorId);
        if (current !== null && !same(current, pointer)) blocked();
        if (current === null) retain(pointer);
        sent(); return settle(pointer, await transport.read(pointer, identity));
      });
    },
  });
}
export function browserAdministrationLocks(): AdministrationOperationLocks {
  return { async exclusive<T>(key: string, work: () => Promise<T>): Promise<T> {
    if (!globalThis.isSecureContext || !navigator.locks) throw new Error("Administrator setup requires a secure browser with Web Locks.");
    return navigator.locks.request(key, { mode: "exclusive", ifAvailable: true }, async lock => { if (!lock) blocked(); return work(); });
  } };
}
