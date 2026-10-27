import { parseCountPolicyClosureReply, parseCountPolicyClosureRequest, parseCountPolicyPublishReceipt, parseCountPolicyPublishRequest, type CountPolicyClosureReply, type CountPolicyPublishReceipt } from "./count-admin-schema.ts";

/** Private positive-integer frame for the new policy protocol only. Older count
 * and management frames keep their original i1-only admission unchanged. */
function policyFrame(value: unknown): Uint8Array {
  const encoder = new TextEncoder(), chunks: Uint8Array[] = []; let length = 0;
  const add = (text: string) => { const bytes = encoder.encode(text); length += bytes.length; if (length > 131072) throw new Error("Invalid policy frame"); chunks.push(bytes); };
  function visit(input: unknown): void {
    if (input === null) { add("n"); return; }
    if (typeof input === "boolean") { add(input ? "t" : "f"); return; }
    if (typeof input === "number" && Number.isInteger(input) && input >= 1 && input <= 86400) { add(`i${input};`); return; }
    if (typeof input === "string") { add(`s${encoder.encode(input).length}:`); add(input); return; }
    if (Array.isArray(input)) { add(`a${input.length}:`); input.forEach(visit); return; }
    if (!input || typeof input !== "object") throw new Error("Invalid policy frame");
    const record = input as Record<string, unknown>, keys = Object.keys(record).sort();
    add(`o${keys.length}:`); for (const key of keys) { visit(key); visit(record[key]); }
  }
  visit(value);
  const raw = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { raw.set(chunk, offset); offset += chunk.length; }
  return raw;
}
async function digest(domain: string, value: unknown): Promise<string> {
  const prefix = new TextEncoder().encode(domain), payload = policyFrame(value), raw = new Uint8Array(prefix.length + 1 + payload.length);
  raw.set(prefix); raw.set(payload, prefix.length + 1);
  const hash = await crypto.subtle.digest("SHA-256", raw);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}
export async function digestCountPolicyRequest(input: unknown): Promise<string> {
  return digest("lrv-controlled-count-policy-request-v1", parseCountPolicyPublishRequest(input));
}
export async function digestCountPolicyReceipt(input: unknown): Promise<string> {
  const { receipt_digest: excluded, ...body } = parseCountPolicyPublishReceipt(input);
  if (!excluded) throw new Error("Invalid policy receipt");
  return digest("lrv-controlled-count-policy-receipt-v1", body);
}
export async function verifyCountPolicyReceipt(input: unknown, output: unknown): Promise<CountPolicyPublishReceipt> {
  const request = parseCountPolicyPublishRequest(input), receipt = parseCountPolicyPublishReceipt(output);
  if (receipt.actor_id !== request.actor_id || receipt.operation_id !== request.operation_id || receipt.product_id !== request.product_id || receipt.site_id !== request.site_id ||
    ((request.expected_prior_policy_id === null) !== (receipt.result_ref.version === "1")) ||
    receipt.request_digest !== await digestCountPolicyRequest(request) || receipt.receipt_digest !== await digestCountPolicyReceipt(receipt))
    throw new Error("The policy receipt does not match the original publication.");
  return receipt;
}
export async function digestCountPolicyClosure(input: unknown): Promise<string> {
  const { receipt_digest: excluded, ...body } = parseCountPolicyClosureReply(input);
  if (!excluded) throw new Error("Invalid policy closure");
  return digest("lrv-controlled-count-operation-closure-receipt-v2", body);
}
export async function verifyCountPolicyClosure(input: unknown, output: unknown): Promise<CountPolicyClosureReply> {
  const request = parseCountPolicyClosureRequest(input), reply = parseCountPolicyClosureReply(output);
  if (Object.keys(request).some(key => request[key as keyof typeof request] !== reply[key as keyof typeof request]) ||
    reply.receipt_digest !== await digestCountPolicyClosure(reply) || (reply.receipt && reply.receipt.receipt_digest !== await digestCountPolicyReceipt(reply.receipt)))
    throw new Error("The policy closure does not match the original publication.");
  return reply;
}
