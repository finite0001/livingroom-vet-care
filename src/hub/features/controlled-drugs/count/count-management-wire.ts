import {
  parseCountManagementReceipt, parseCountManagementReply, parseCountManagementRequest,
  type CountManagementAction, type CountManagementMutationAction, type CountManagementNotFoundReply,
  type CountManagementReadReply, type CountManagementRequestMap, type CountManagementSavedReply,
} from "./count-management-schema.ts";

const REQUEST_DOMAIN = "lrv-controlled-count-management-request-v1";
const RECEIPT_DOMAIN = "lrv-controlled-count-management-public-receipt-v1";
const encoder = new TextEncoder();
function invalid(): never { throw new Error("Count management receipt does not match the retained request"); }

// Only closed snapshotted management values reach this private frame.
function frame(value: unknown): Uint8Array {
  const chunks: Uint8Array[] = [];
  let size = 0;
  function append(bytes: Uint8Array) { size += bytes.length; if (size > 32768) invalid(); chunks.push(bytes); }
  function ascii(text: string) { append(encoder.encode(text)); }
  function visit(input: unknown) {
    if (input === null) { ascii("n"); return; }
    if (input === false || input === true) { ascii(input ? "t" : "f"); return; }
    if (input === 1) { ascii("i1;"); return; }
    if (typeof input === "string") { const bytes = encoder.encode(input); ascii("s" + bytes.length + ":"); append(bytes); return; }
    if (Array.isArray(input)) { ascii("a" + input.length + ":"); input.forEach(visit); return; }
    if (!input || typeof input !== "object") invalid();
    const record = input as Record<string, unknown>, keys = Object.keys(record).sort();
    ascii("o" + keys.length + ":");
    for (const key of keys) { visit(key); visit(record[key]); }
  }
  visit(value);
  const result = new Uint8Array(size);
  let offset = 0;
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
export function countManagementRequestBytes<K extends CountManagementAction>(action: K, input: unknown): Uint8Array {
  return domainBytes(REQUEST_DOMAIN, { action, request: parseCountManagementRequest(action, input) });
}
export async function digestCountManagementRequest<K extends CountManagementAction>(action: K, input: unknown): Promise<string> {
  return sha256(countManagementRequestBytes(action, input));
}
export function countManagementReceiptBytes(value: unknown): Uint8Array {
  const receipt = parseCountManagementReceipt(value);
  const { receipt_digest: excludedDigest, ...retained } = receipt;
  if (!excludedDigest) invalid();
  return domainBytes(RECEIPT_DOMAIN, retained);
}
export async function digestCountManagementReceipt(value: unknown): Promise<string> { return sha256(countManagementReceiptBytes(value)); }

function resultId<K extends CountManagementMutationAction>(action: K, request: CountManagementRequestMap[K]): string {
  switch (action) {
    case "reconciliation_prepare": return (request as CountManagementRequestMap["reconciliation_prepare"]).preparation_id;
    case "reconciliation_approve": return (request as CountManagementRequestMap["reconciliation_approve"]).approval_id;
    case "reconciliation_execute": return (request as CountManagementRequestMap["reconciliation_execute"]).execution_id;
    case "reconciliation_confirm": return (request as CountManagementRequestMap["reconciliation_confirm"]).confirmation_id;
    case "cause_resolve": return (request as CountManagementRequestMap["cause_resolve"]).resolution_id;
  }
  return invalid();
}
/** Public binding only; private nonce/records and current authority stay server-owned. */
export async function verifyCountManagementSavedReply<K extends CountManagementMutationAction>(action: K, input: unknown, value: unknown): Promise<CountManagementSavedReply> {
  if (!["reconciliation_prepare", "reconciliation_approve", "reconciliation_execute", "reconciliation_confirm", "cause_resolve"].includes(action)) invalid();
  const request = parseCountManagementRequest(action, input), reply = parseCountManagementReply(value);
  if (reply.state !== "saved") invalid();
  const receipt = reply.data.receipt;
  if (receipt.action !== action || receipt.operation_id !== request.operation_id || receipt.actor_id !== request.actor_id ||
    receipt.product_id !== request.product_id || receipt.site_id !== request.site_id || receipt.result_ref.id !== resultId(action, request)) invalid();
  const requestDigest = await digestCountManagementRequest(action, request);
  const receiptDigest = await digestCountManagementReceipt(receipt);
  if (receipt.request_digest !== requestDigest || receipt.receipt_digest !== receiptDigest) invalid();
  return reply;
}
/** Compact absence is bound to its supplied identity; it never schedules a retry. */
export function verifyCountManagementNotFound(input: unknown, value: unknown): CountManagementNotFoundReply {
  const request = parseCountManagementRequest("recover", input), reply = parseCountManagementReply(value);
  if (reply.state !== "not_found" || reply.data.operation_id !== request.operation_id || reply.data.product_id !== request.product_id || reply.data.site_id !== request.site_id) invalid();
  return reply;
}
/** Read status is a projection, never permission to execute or release a hold. */
export function verifyCountManagementReadReply(input: unknown, value: unknown): CountManagementReadReply {
  const request = parseCountManagementRequest("read", input), reply = parseCountManagementReply(value);
  if (reply.state !== "available" || reply.data.reconciliation_id !== request.reconciliation_id || reply.data.product_id !== request.product_id || reply.data.site_id !== request.site_id) invalid();
  return reply;
}
