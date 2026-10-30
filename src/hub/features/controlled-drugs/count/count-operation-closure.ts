import { z } from "zod";
import { decodeExactJson, ExactJsonNumber, protocolInteger, type ExactJson } from "../record-review/exact-json.ts";
import { parseCountPublicReceipt, type CountMutationAction, type CountPublicReceipt } from "./count-request-schema.ts";
import { parseCountManagementReceipt, type CountManagementMutationAction, type CountManagementPublicReceipt } from "./count-management-schema.ts";
import { digestCountReceipt } from "./count-wire.ts";
import { digestCountManagementReceipt } from "./count-management-wire.ts";

export type CountOperationAction = CountMutationAction | CountManagementMutationAction;
/** ID-only recovery pointer; contains no physical observations or notes. */
export interface CountOperationClosureRequest {
  readonly schema_version: 1; readonly actor_id: string; readonly operation_id: string;
  readonly original_action: CountOperationAction; readonly scope_id: string;
  readonly product_id: string; readonly site_id: string;
}
export interface CountOperationClosureReply extends CountOperationClosureRequest {
  readonly action: "operation_closure"; readonly state: "pending" | "saved" | "abandoned";
  readonly receipt: CountPublicReceipt | CountManagementPublicReceipt | null;
  readonly receipt_digest: string;
}

const encoder = new TextEncoder();
const DOMAIN = "lrv-controlled-count-operation-closure-receipt-v1";
const actions = ["start", "statement", "finalize", "cancel", "reconciliation_prepare", "reconciliation_approve", "reconciliation_execute", "reconciliation_confirm", "cause_resolve"] as const;
const countActions: readonly string[] = ["start", "statement", "finalize", "cancel"];
const uuid = z.string().length(36).regex(/^(?!00000000-0000-0000-0000-000000000000$)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const fields = { schema_version: z.literal(1), actor_id: uuid, operation_id: uuid, original_action: z.enum(actions), scope_id: uuid, product_id: uuid, site_id: uuid };
const requestSchema = z.object(fields).strict();
const replySchema = z.object({ ...fields, action: z.literal("operation_closure"), state: z.enum(["pending", "saved", "abandoned"]), receipt: z.unknown(), receipt_digest: z.string().length(64).regex(/^[0-9a-f]{64}$/) }).strict();
const requestKeys = Object.keys(fields);
const replyKeys = [...requestKeys, "action", "state", "receipt", "receipt_digest"];
function invalid(): never { throw new Error("The saved-operation closure does not match this request."); }

function closedSnapshot(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) invalid();
  const actual = Reflect.ownKeys(input);
  if (actual.length !== keys.length || actual.some(key => typeof key !== "string" || !keys.includes(key))) invalid();
  const value: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) invalid();
    const item: unknown = descriptor.value;
    if (key !== "receipt" && (key === "schema_version" ? item !== 1 : typeof item !== "string" || item.length > 64)) invalid();
    value[key] = item;
  }
  return value;
}
export function parseCountOperationClosureRequest(input: unknown): CountOperationClosureRequest {
  const parsed = requestSchema.safeParse(closedSnapshot(input, requestKeys));
  if (!parsed.success) invalid();
  return Object.freeze(parsed.data) as CountOperationClosureRequest;
}
function parseReply(input: unknown): CountOperationClosureReply {
  const parsed = replySchema.safeParse(closedSnapshot(input, replyKeys));
  if (!parsed.success) invalid();
  const value = parsed.data;
  let receipt: CountOperationClosureReply["receipt"] = null;
  if (value.state === "saved") {
    receipt = countActions.includes(value.original_action) ? parseCountPublicReceipt(value.receipt) : parseCountManagementReceipt(value.receipt);
    if (receipt.actor_id !== value.actor_id || receipt.operation_id !== value.operation_id || receipt.action !== value.original_action) invalid();
    if ("count_id" in receipt) {
      if (receipt.count_id !== value.scope_id || (receipt.action === "start" && receipt.result_ref.id !== value.scope_id)) invalid();
    }
    else if (receipt.product_id !== value.product_id || receipt.site_id !== value.site_id) invalid();
  } else if (value.receipt !== null) invalid();
  return Object.freeze({ ...value, receipt }) as CountOperationClosureReply;
}

/** Private i1 frame accepts only the closed, snapshotted closure and thin receipt. */
function frame(value: unknown): Uint8Array {
  const parts: Uint8Array[] = []; let length = 0;
  function add(text: string) { const bytes = encoder.encode(text); length += bytes.length; if (length > 8192) invalid(); parts.push(bytes); }
  function visit(input: unknown): void {
    if (input === null) { add("n"); return; }
    if (input === 1) { add("i1;"); return; }
    if (typeof input === "string") { add(`s${encoder.encode(input).length}:`); add(input); return; }
    if (!input || typeof input !== "object" || Array.isArray(input)) invalid();
    const record = input as Record<string, unknown>, keys = Object.keys(record).sort();
    add(`o${keys.length}:`); for (const key of keys) { visit(key); visit(record[key]); }
  }
  visit(value);
  const result = new Uint8Array(length); let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
export async function digestCountOperationClosureReply(input: unknown): Promise<string> {
  const reply = parseReply(input);
  const { receipt_digest: ignored, ...body } = reply;
  if (!ignored) invalid();
  const domain = encoder.encode(DOMAIN), payload = frame(body), bytes = new Uint8Array(domain.length + 1 + payload.length);
  bytes.set(domain); bytes.set(payload, domain.length + 1);
  const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}

const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const arrayName = Object.getOwnPropertyDescriptor(typedArrayPrototype, Symbol.toStringTag)!.get!;
const byteLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")!.get!;
const setBytes = Uint8Array.prototype.set;
function decode(raw: Uint8Array): unknown {
  if (arrayName.call(raw) !== "Uint8Array") invalid();
  const length = byteLength.call(raw) as number;
  if (length < 1 || length > 8192) invalid();
  const copy = new Uint8Array(length); setBytes.call(copy, raw);
  function numbers(value: ExactJson): unknown {
    if (value instanceof ExactJsonNumber) return protocolInteger(value, 1, 1);
    if (Array.isArray(value)) return value.map(numbers);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, numbers(child)]));
    return value;
  }
  return numbers(decodeExactJson(copy));
}

/** A digest checks public consistency. Server Auth/source/closure checks confer authority. */
export async function verifyCountOperationClosureReply(raw: Uint8Array, input: unknown): Promise<CountOperationClosureReply> {
  const request = parseCountOperationClosureRequest(input), reply = parseReply(decode(raw));
  for (const key of requestKeys as (keyof CountOperationClosureRequest)[]) if (reply[key] !== request[key]) invalid();
  if (await digestCountOperationClosureReply(reply) !== reply.receipt_digest) invalid();
  if (reply.receipt) {
    const digest = "count_id" in reply.receipt ? await digestCountReceipt(reply.receipt) : await digestCountManagementReceipt(reply.receipt);
    if (digest !== reply.receipt.receipt_digest) invalid();
  }
  return reply;
}
