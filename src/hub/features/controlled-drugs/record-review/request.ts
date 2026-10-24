import { z } from "zod";
import { validUnicode } from "./exact-json.ts";

export const reviewUuidSchema = z.string().uuid().refine(value => value === value.toLowerCase() && value !== "00000000-0000-0000-0000-000000000000");
export const reviewDigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const recordReviewRequestSchema = z.object({
  actor_id: reviewUuidSchema, operation_id: reviewUuidSchema, event_id: reviewUuidSchema,
  policy_id: reviewUuidSchema, read_eligibility_id: reviewUuidSchema, review_eligibility_id: reviewUuidSchema,
  decision: z.enum(["approve", "reject"]),
  reason: z.string().refine(value => validUnicode(value) && value === value.trim() &&
    Array.from(value).length >= 1 && Array.from(value).length <= 4000 &&
    Array.from(value).every(char => char === "\n" || char === "\t" || (char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127)), "Use clean review reason text"),
}).strict();
export interface RecordReviewRequest extends z.infer<typeof recordReviewRequestSchema> {}
/** Source evidence can be checked before a mutation operation exists. */
export interface ReviewEvidenceTarget { readonly event_id: string }
const fields = ["actor_id", "operation_id", "event_id", "policy_id", "read_eligibility_id", "review_eligibility_id", "decision", "reason"] as const;

/** Exact C2b domain/UTF-8-byte framing; no trimming or Unicode normalization. */
export function frameReviewFields(values: readonly string[]): Uint8Array {
  if (values.length !== 8 || values.some(value => typeof value !== "string" || !validUnicode(value) || value.includes("\0")))
    throw new Error("Expected eight valid Unicode review fields");
  const encoder = new TextEncoder();
  const parts = [encoder.encode("lrv-record-review-request-v3\n")];
  for (const value of values) {
    const bytes = encoder.encode(value);
    parts.push(encoder.encode(`${bytes.byteLength}:`), bytes);
  }
  const result = new Uint8Array(parts.reduce((total, bytes) => total + bytes.byteLength, 0));
  let position = 0;
  for (const part of parts) { result.set(part, position); position += part.byteLength; }
  return result;
}
export async function reviewTransportDigest(input: unknown): Promise<string> {
  const request = recordReviewRequestSchema.parse(input);
  const digest = await crypto.subtle.digest("SHA-256", frameReviewFields(fields.map(field => request[field])));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
