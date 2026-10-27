import { z } from "zod";
import { parseReviewIdentity, type ReviewIdentity } from "../record-review/raw-rpc.ts";
import type { ExactJson } from "../record-review/exact-json.ts";
export const controlledStockWriterSchema = z.enum(["receive_inventory", "adjust_inventory", "record_patient_treatment", "record_anesthesia_drug_administration",
  "record_native_dispense", "record_native_pickup", "record_native_dispense_return", "record_native_dispense_return_v2", "record_native_return_discrepancy", "append_native_dispense_correction"]);
export type ControlledStockWriter = z.infer<typeof controlledStockWriterSchema>;
export type ControlledStockWriteErrorCode = "CONTROLLED_ENTRY_CANCELLED" | "CONTROLLED_ENTRY_UNAVAILABLE" | "CONTROLLED_ENTRY_PENDING";
const copy = { CONTROLLED_ENTRY_CANCELLED: "The controlled-drug entry was closed without a save.", CONTROLLED_ENTRY_UNAVAILABLE: "The controlled-drug workflow is unavailable for this staff session. Confirm your login and try again.",
  CONTROLLED_ENTRY_PENDING: "Check the original controlled-drug entry before recording another." };
export class ControlledStockWriteError extends Error {
  readonly code: ControlledStockWriteErrorCode; readonly definitive: boolean;
  constructor(code: ControlledStockWriteErrorCode, definitive: boolean) { super(copy[code]); this.name = "ControlledStockWriteError"; this.code = code; this.definitive = definitive; }
}
export interface ControlledStockWriteHandler {
  /** Admission must be synchronous and pure. It runs only after exact caller
   * intent/result binding, before managed recovery storage can be cleaned up. */
  invoke<T>(writer: ControlledStockWriter, args: unknown, identity: Readonly<ReviewIdentity>, admitResult: (raw: ExactJson) => T): Promise<T>;
}
interface Registration { readonly handler: ControlledStockWriteHandler }
let current: Registration | null = null;
/** Installed once by the authenticated hub host. No SDK or direct-write fallback. */
export function installControlledStockWriteHandler(handler: ControlledStockWriteHandler): () => void {
  if (!handler || typeof handler.invoke !== "function" || current) throw new Error("A controlled-drug entry host is already active or unavailable.");
  const registration = Object.freeze({ handler }); current = registration;
  return () => { if (current === registration) current = null; };
}
export async function invokeControlledStockWriter<T = ExactJson>(writerInput: ControlledStockWriter, args: unknown,
  expectedIdentity: Readonly<ReviewIdentity>, admitResult?: (raw: ExactJson) => T): Promise<T> {
  let writer: ControlledStockWriter, identity: Readonly<ReviewIdentity>;
  try { writer = controlledStockWriterSchema.parse(writerInput); identity = Object.freeze(parseReviewIdentity(expectedIdentity)); }
  catch { throw new ControlledStockWriteError("CONTROLLED_ENTRY_UNAVAILABLE", true); }
  const registration = current;
  if (!registration) throw new ControlledStockWriteError("CONTROLLED_ENTRY_UNAVAILABLE", true);
  try { return await registration.handler.invoke(writer, args, identity, admitResult ?? (value => value as T)); }
  catch (error) {
    if (error instanceof ControlledStockWriteError) throw error;
    throw new ControlledStockWriteError("CONTROLLED_ENTRY_PENDING", false);
  }
}
