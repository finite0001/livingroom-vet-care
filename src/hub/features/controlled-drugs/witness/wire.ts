import { witnessReceiptSchema, type WitnessReceipt } from "./schema.ts";
const encoder = new TextEncoder();
/** Fixed receipt11 protocol only. No generic private preparation hash API. */
export function witnessReceiptBytes(input: unknown): Uint8Array {
  const { receipt_digest, ...value } = witnessReceiptSchema.parse(input);
  if (!receipt_digest) throw new Error("Witness receipt digest is missing.");
  const chunks = [encoder.encode("lrv-controlled-stock-witness-receipt-v1\0")];
  const append = (text: string) => chunks.push(encoder.encode(text));
  const string = (text: string) => { const raw = encoder.encode(text); append(`s${raw.length}:`); chunks.push(raw); };
  const entries = Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  append(`o${entries.length}:`);
  for (const [key, item] of entries) {
    string(key);
    if (key === "schema_version" && item === 1) append("i1;");
    else if (typeof item === "string") string(item);
    else throw new Error("Only the closed witness receipt scalars can be framed.");
  }
  const size = chunks.reduce((total, chunk) => total + chunk.length, 0);
  if (size > 8192) throw new Error("Witness receipt exceeds its byte limit.");
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
export async function witnessReceiptDigest(input: unknown): Promise<string> {
  const bytes = witnessReceiptBytes(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
}
export async function verifyWitnessReceipt(receipt: WitnessReceipt): Promise<void> {
  if (await witnessReceiptDigest(receipt) !== receipt.receipt_digest) throw new Error("Witness receipt does not match its digest.");
}
