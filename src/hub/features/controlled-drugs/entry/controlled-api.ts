import type { ReviewIdentity } from "../record-review/raw-rpc.ts";
import type { ExactJson } from "../record-review/exact-json.ts";
import { ControlledStockWriteError, invokeControlledStockWriter, type ControlledStockWriter } from "./gateway.ts";

/** Explicit dependency for offline adapter tests; production always uses the
 * shared entry host. Missing/stale actor identity never falls back to SDK RPC. */
export type ControlledWriterInvoker = typeof invokeControlledStockWriter;
export function invokeCapturedControlledWriter<T>(writer: ControlledStockWriter, args: unknown, actor: string,
  identity: Readonly<ReviewIdentity> | null | undefined, admitResult: (raw: ExactJson) => T,
  invoke: ControlledWriterInvoker = invokeControlledStockWriter): Promise<T> {
  if (!identity || identity.actorId !== actor) return Promise.reject(new ControlledStockWriteError("CONTROLLED_ENTRY_UNAVAILABLE", true));
  return invoke(writer, args, identity, admitResult);
}
