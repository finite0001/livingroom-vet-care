import { administrationRequestSchema, administrationReceiptSchema, parseAdministrationReply, type AdministrationPointer, type AdministrationReceipt, type AdministrationRequest } from "./schema.ts";
import type { ExactJson } from "../record-review/exact-json.ts";
const encoder = new TextEncoder();
function invalid(): never { throw new Error("Administration evidence does not match the original operation."); }
function parsedBytes(value: unknown): number {
  if (value === null) return 4;
  if (typeof value === "boolean") return value ? 4 : 5;
  if (typeof value === "string") return encoder.encode(JSON.stringify(value)).length;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 2147483647) return String(value).length;
  if (Array.isArray(value)) return 2 + value.reduce((total, child) => total + parsedBytes(child), 0) + Math.max(0, value.length - 1) * 2;
  if (!value || typeof value !== "object") invalid();
  const entries = Object.entries(value);
  return 2 + entries.reduce((total, [key, child]) => total + parsedBytes(key) + 2 + parsedBytes(child), 0) + Math.max(0, entries.length - 1) * 2;
}
/** Only closed, validated administration values reach this specialized iN frame. */
function framed(domain: string, value: unknown): Uint8Array {
  const chunks: Uint8Array[] = []; let size = 0, nodes = 0;
  const append = (bytes: Uint8Array) => { size += bytes.length; if (size > 1024 * 1024) invalid(); chunks.push(bytes); };
  const ascii = (text: string) => append(encoder.encode(text));
  function visit(item: unknown, depth: number) {
    if (++nodes > 100000 || depth > 64) invalid();
    if (item === null) { ascii("n"); return; }
    if (typeof item === "boolean") { ascii(item ? "t" : "f"); return; }
    if (typeof item === "number" && Number.isInteger(item) && item >= 0 && item <= 2147483647 && !Object.is(item, -0)) { ascii(`i${item};`); return; }
    if (typeof item === "string") { const bytes = encoder.encode(item); ascii(`s${bytes.length}:`); append(bytes); return; }
    if (Array.isArray(item)) { ascii(`a${item.length}:`); item.forEach(child => visit(child, depth + 1)); return; }
    if (!item || typeof item !== "object") invalid();
    const entries = Object.entries(item).sort(([first], [second]) => first < second ? -1 : first > second ? 1 : 0);
    ascii(`o${entries.length}:`);
    for (const [key, child] of entries) { visit(key, depth + 1); visit(child, depth + 1); }
  }
  append(encoder.encode(domain + "\0")); visit(value, 0);
  const result = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}
function equal(a: Uint8Array, b: Uint8Array): boolean { return a.length === b.length && a.every((value, index) => value === b[index]); }
async function digest(bytes: Uint8Array): Promise<string> {
  const result = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(result), value => value.toString(16).padStart(2, "0")).join("");
}
export function administrationRequestBytes(input: unknown): Uint8Array {
  const request = administrationRequestSchema.parse(input);
  if (parsedBytes(request) > 262144) invalid();
  return framed("lrv-controlled-stock-administration-request-v1", request);
}
export async function digestAdministrationRequest(input: unknown): Promise<string> { return digest(administrationRequestBytes(input)); }
export function administrationReceiptBytes(input: unknown): Uint8Array {
  const receipt = administrationReceiptSchema.parse(input);
  if (parsedBytes(receipt) > 8192) invalid();
  const { receipt_digest: omitted, ...value } = receipt; if (!omitted) invalid();
  return framed("lrv-controlled-stock-administration-receipt-v1", value);
}
export async function digestAdministrationReceipt(input: unknown): Promise<string> { return digest(administrationReceiptBytes(input)); }
export async function verifyAdministrationReply(raw: ExactJson, pointer: AdministrationPointer, original?: AdministrationRequest) {
  const reply = parseAdministrationReply(raw, pointer), { preparation, receipt } = reply.data;
  if (preparation) {
    if (await digestAdministrationRequest(preparation.request) !== preparation.request_digest ||
      original && !equal(administrationRequestBytes(original), administrationRequestBytes(preparation.request))) invalid();
  } else if (original && reply.state === "saved") invalid();
  if (receipt && await digestAdministrationReceipt(receipt) !== receipt.receipt_digest) invalid();
  return reply;
}
export function administrationReceiptMatchesPointer(receipt: AdministrationReceipt, pointer: AdministrationPointer): boolean {
  return receipt.schema_version === pointer.schema_version && receipt.actor_id === pointer.actor_id && receipt.operation_id === pointer.operation_id && receipt.action === pointer.action &&
    receipt.product_id === pointer.product_id && receipt.site_id === pointer.site_id;
}
