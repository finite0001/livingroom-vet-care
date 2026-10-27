import { z } from "zod";
import { decodeExactJson, type ExactJson } from "../record-review/exact-json.ts";
import { controlledStockWriterSchema, type ControlledStockWriter } from "./gateway.ts";

const uuid = z.string().uuid();
const request = z.record(z.unknown());
// Original BridgeV3 public signatures have no argument defaults. Null is a
// supplied SQL value; an absent/undefined argument is never silently invented.
const schemas = {
  receive_inventory: z.object({ p_id: uuid, p_lot_id: uuid.nullable(), p_product_id: uuid.nullable(),
    p_lot_number: z.string().nullable(), p_expires_on: z.string().nullable(), p_location: z.string().nullable(),
    p_quantity: z.number().finite().nullable(), p_reason: z.string().nullable() }).strict(),
  adjust_inventory: z.object({ p_id: uuid, p_lot_id: uuid, p_quantity: z.number().finite().nullable(), p_reason: z.string().nullable() }).strict(),
  record_patient_treatment: z.object({ p_id: uuid, p_request: request }).strict(),
  record_anesthesia_drug_administration: z.object({ p_id: uuid, p_record_id: uuid, p_pet_id: uuid, p_request: request }).strict(),
  record_native_dispense: z.object({ p_id: uuid, p_request: request }).strict(),
  record_native_pickup: z.object({ p_id: uuid, p_request: request }).strict(),
  record_native_dispense_return: z.object({ p_id: uuid, p_request: request }).strict(),
  record_native_dispense_return_v2: z.object({ p_id: uuid, p_request: request }).strict(),
  record_native_return_discrepancy: z.object({ p_id: uuid, p_request: request }).strict(),
  append_native_dispense_correction: z.object({ p_id: uuid, p_request: request }).strict(),
} satisfies Record<ControlledStockWriter, z.ZodTypeAny>;

export interface ControlledLegacyIntent {
  readonly writer: ControlledStockWriter;
  readonly operationId: string;
  readonly legacyArguments: ExactJson;
  /** Original named-argument RPC body, with no added envelope. */
  readonly requestBody: string;
}

const requestByteLimit = 131072;
interface SnapshotBudget { nodes: number; bytes: number }
function oversized(): never { throw new Error("Controlled entry exceeds its request bound."); }
function charge(budget: SnapshotBudget, bytes: number): void {
  if (bytes > requestByteLimit - budget.bytes) oversized();
  budget.bytes += bytes;
}
/** Exact UTF8 size of JSON.stringify(text), without allocating that string or
 * an encoded buffer. Check UTF16 length first, then validate/count in one pass. */
function chargeString(text: string, budget: SnapshotBudget): void {
  if (text.length > requestByteLimit) oversized();
  const remaining = requestByteLimit - budget.bytes;
  let bytes = 2;
  if (bytes > remaining) oversized();
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 0) throw new Error("Controlled entry contains invalid text.");
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error("Controlled entry contains invalid text.");
      bytes += 4;
    } else if (code >= 0xdc00 && code <= 0xdfff) throw new Error("Controlled entry contains invalid text.");
    else if (code === 34 || code === 92 || code === 8 || code === 9 || code === 10 || code === 12 || code === 13) bytes += 2;
    else if (code < 32) bytes += 6;
    else bytes += code < 128 ? 1 : code < 2048 ? 2 : 3;
    if (bytes > remaining) oversized();
  }
  charge(budget, bytes);
}

/** Read each own data property once. Never invoke JSON hooks, getters, custom
 * iterators or inherited properties. Account the complete JSON wire size before
 * adding each child to its clone; never allocate the full descriptor object. */
function plainSnapshot(value: unknown, ancestors: Set<object>, depth: number, budget: SnapshotBudget): unknown {
  if (depth > 64 || ++budget.nodes > 100000) throw new Error("Controlled entry is too large.");
  if (value === null) { charge(budget, 4); return value; }
  if (typeof value === "boolean") { charge(budget, value ? 4 : 5); return value; }
  if (typeof value === "string") { chargeString(value, budget); return value; }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Controlled entry requires finite numbers.");
    charge(budget, JSON.stringify(value).length);
    return value;
  }
  if (typeof value !== "object" || ancestors.has(value)) throw new Error("Controlled entry requires plain JSON.");
  const array = Array.isArray(value), proto = Object.getPrototypeOf(value);
  if (proto !== (array ? Array.prototype : Object.prototype) && !(proto === null && !array))
    throw new Error("Controlled entry requires plain JSON.");
  const remaining = requestByteLimit - budget.bytes;
  let length = 0;
  if (array) {
    length = Object.getOwnPropertyDescriptor(value, "length")?.value;
    if (!Number.isSafeInteger(length) || length < 0) throw new Error("Controlled entry requires a dense bounded array.");
    if (length > 0 && 2 * length + 1 > remaining) oversized();
  }
  // Reflect returns names only; descriptor/value copies occur one at a time
  // after this finite member bound. Symbols/nonenumerables still refuse.
  const keys = Reflect.ownKeys(value);
  if (keys.length > requestByteLimit) oversized();
  if (keys.some(key => typeof key !== "string")) throw new Error("Controlled entry requires string keys.");
  ancestors.add(value);
  try {
    if (array) {
      if (keys.length !== length + 1)
        throw new Error("Controlled entry requires a dense bounded array.");
      charge(budget, 2 + Math.max(0, length - 1));
      const result: unknown[] = [];
      for (let i = 0; i < length; i++) {
        const d = Object.getOwnPropertyDescriptor(value, String(i));
        if (!d || !d.enumerable || !("value" in d)) throw new Error("Controlled entry requires data properties.");
        result.push(plainSnapshot(d.value, ancestors, depth + 1, budget));
      }
      return result;
    }
    // Minimum member is an empty key, colon, one-byte value and separator.
    if (keys.length > 0 && 5 * keys.length + 1 > remaining) oversized();
    charge(budget, 2 + Math.max(0, keys.length - 1));
    const result: Record<string, unknown> = Object.create(null);
    for (const key of keys as string[]) {
      if (key === "toJSON") throw new Error("Controlled entry requires data properties.");
      chargeString(key, budget); charge(budget, 1);
      const d = Object.getOwnPropertyDescriptor(value, key);
      if (!d || !d.enumerable || !("value" in d)) throw new Error("Controlled entry requires data properties.");
      result[key] = plainSnapshot(d.value, ancestors, depth + 1, budget);
    }
    return result;
  } finally { ancestors.delete(value); }
}

export function snapshotControlledLegacyIntent(writerInput: ControlledStockWriter, args: unknown): Readonly<ControlledLegacyIntent> {
  const writer = controlledStockWriterSchema.parse(writerInput);
  const budget: SnapshotBudget = { nodes: 0, bytes: 0 };
  const snapshot = plainSnapshot(args, new Set(), 0, budget);
  // Validate without using Zod's reconstructed object as the actual submitted
  // request: nested JSON spelling/case and complete caller intent stay intact.
  const checked = schemas[writer].parse(snapshot);
  const requestBody = JSON.stringify(snapshot);
  const bytes = new TextEncoder().encode(requestBody);
  if (bytes.byteLength > requestByteLimit || bytes.byteLength !== budget.bytes) throw new Error("Controlled entry exceeds its request bound.");
  return Object.freeze({ writer, operationId: checked.p_id, requestBody, legacyArguments: decodeExactJson(bytes) });
}
