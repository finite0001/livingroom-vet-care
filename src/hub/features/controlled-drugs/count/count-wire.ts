import {
  parseCountPublicReceipt, parseCountReply, parseCountRequest,
  type CountAction, type CountMutationAction, type CountNotFoundReply, type CountNotReadyReply,
  type CountPublicReceipt, type CountRequestMap, type CountSavedReply,
} from "./count-request-schema.ts";

const REQUEST_DOMAIN = "lrv-controlled-count-request-v1";
const RECEIPT_DOMAIN = "lrv-controlled-count-public-receipt-v1";
const encoder = new TextEncoder();
function invalid(): never { throw new Error("Count receipt does not match the retained request"); }

// Private implementation: only closed, fully snapshotted count DTOs reach this
// frame. No private record/snapshot hash or caller-selected domain API exists.
function frame(value: unknown): Uint8Array {
  const chunks: Uint8Array[] = [];
  let size = 0;
  function append(bytes: Uint8Array) { size += bytes.length; if (size > 524288) invalid(); chunks.push(bytes); }
  function ascii(text: string) { append(encoder.encode(text)); }
  function visit(input: unknown) {
    if (input === null) { ascii("n"); return; }
    if (input === false || input === true) { ascii(input ? "t" : "f"); return; }
    if (input === 1) { ascii("i1;"); return; }
    if (typeof input === "string") { const bytes = encoder.encode(input); ascii(`s${bytes.length}:`); append(bytes); return; }
    if (Array.isArray(input)) { ascii(`a${input.length}:`); input.forEach(visit); return; }
    if (!input || typeof input !== "object") invalid();
    const record = input as Record<string, unknown>, keys = Object.keys(record).sort();
    ascii(`o${keys.length}:`);
    for (const key of keys) { visit(key); visit(record[key]); }
  }
  visit(value);
  const result = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}
function domainBytes(domain: string, value: unknown): Uint8Array {
  const prefix = encoder.encode(domain), body = frame(value), result = new Uint8Array(prefix.length + 1 + body.length);
  result.set(prefix); result.set(body, prefix.length + 1); return result;
}
async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

/** New bytes are returned on each call; caller mutation cannot change a DTO. */
export function countRequestBytes<K extends CountAction>(action: K, request: unknown): Uint8Array {
  return domainBytes(REQUEST_DOMAIN, { action, request: parseCountRequest(action, request) });
}
export async function digestCountRequest<K extends CountAction>(action: K, request: unknown): Promise<string> {
  return sha256(countRequestBytes(action, request));
}
/** Eight-key public count receipt only; validates the excluded digest too before
 * omission. The opaque commitment remains server-private, not reconstructed. */
export function countReceiptBytes(value: unknown): Uint8Array {
  const receipt = parseCountPublicReceipt(value);
  const { receipt_digest: excludedDigest, ...retained } = receipt;
  if (!excludedDigest) invalid();
  return domainBytes(RECEIPT_DOMAIN, retained);
}
export async function digestCountReceipt(value: unknown): Promise<string> { return sha256(countReceiptBytes(value)); }

function resultId<K extends CountMutationAction>(action: K, request: CountRequestMap[K]): string {
  switch (action) {
    case "start": return request.count_id;
    case "statement": return (request as CountRequestMap["statement"]).statement_id;
    case "finalize": return (request as CountRequestMap["finalize"]).outcome_id;
    case "cancel": return (request as CountRequestMap["cancel"]).cancellation_id;
  }
  return invalid();
}
/** Binds every public field to an original retained mutation, across sessions.
 * No session or current policy is fabricated here. Freeze occurs before awaits. */
export async function verifyCountSavedReply<K extends CountMutationAction>(action: K, input: unknown, value: unknown): Promise<CountSavedReply> {
  if (!["start", "statement", "finalize", "cancel"].includes(action)) invalid();
  const request = parseCountRequest(action, input), reply = parseCountReply(value);
  if (reply.state !== "saved") invalid();
  const receipt: CountPublicReceipt = reply.data.receipt;
  if (receipt.action !== action || receipt.operation_id !== request.operation_id || receipt.count_id !== request.count_id ||
    receipt.actor_id !== request.actor_id || receipt.result_ref.id !== resultId(action, request)) invalid();
  const requestDigest = await digestCountRequest(action, request);
  const receiptDigest = await digestCountReceipt(receipt);
  if (receipt.request_digest !== requestDigest || receipt.receipt_digest !== receiptDigest) invalid();
  return reply;
}
/** Nonwriting absence replies are a different shape, bound to explicit recovery. */
export function verifyCountNotFound(input: unknown, value: unknown): CountNotFoundReply {
  const request = parseCountRequest("recover", input), reply = parseCountReply(value);
  if (reply.state !== "not_found" || reply.data.operation_id !== request.operation_id || reply.data.count_id !== request.count_id) invalid();
  return reply;
}
export function verifyCountNotReady(input: unknown, value: unknown): CountNotReadyReply {
  const request = parseCountRequest("finalize", input), reply = parseCountReply(value);
  if (reply.state !== "not_ready" || reply.data.count_id !== request.count_id) invalid();
  return reply;
}
