import { z } from "zod";
import { ExactJsonNumber, protocolInteger, type ExactJson } from "./exact-json.ts";
import { recordReviewRequestSchema, reviewDigestSchema, reviewTransportDigest, reviewUuidSchema, type RecordReviewRequest } from "./request.ts";
import { reviewEventKindSchema } from "./queue-model.ts";
import type { RecordReviewPointer } from "./recovery-pointer.ts";

export const reviewMeaning = "independent_record_review_v1";
export const reviewMeaningText = "Independent record review; no claim of personal physical observation.";
const wireInteger = (n: number) => z.instanceof(ExactJsonNumber).refine(value => {
  try { return protocolInteger(value, n, n) === n; } catch { return false; }
});
// Protocol instants have a fixed UTC spelling. Historical source instants are not
// passed through this schema: old source evidence must remain visible unchanged.
export const reviewProtocolInstantSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/)
  .refine(value => {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 23) === value.slice(0, 23) &&
      value >= "2026-01-01T00:00:00.000000Z" && value < "2101-01-01T00:00:00.000000Z";
  });
const object = z.custom<{ readonly [key: string]: ExactJson }>(value => value !== null && typeof value === "object" &&
  !Array.isArray(value) && !(value instanceof ExactJsonNumber));
const sequence = z.instanceof(ExactJsonNumber).refine(value => /^[1-9][0-9]*$/.test(String(value)) &&
  String(value).length <= 19 && BigInt(String(value)) <= 9223372036854775807n);
export const reviewTargetSchema = z.object({
  event_id: reviewUuidSchema, product_id: reviewUuidSchema, sequence, record_hash: reviewDigestSchema,
  original_actor_id: reviewUuidSchema, policy_version_id: reviewUuidSchema, opening_id: reviewUuidSchema,
  engine_revision: z.instanceof(ExactJsonNumber).refine(value => {
    try { return protocolInteger(value, 1, 2147483647) > 0; } catch { return false; }
  }),
}).strict();
const ref = z.object({ relation: z.string().regex(/^public\.[a-z][a-z0-9_]*$/).max(120), key: object,
  row_hash: reviewDigestSchema, role: z.string().min(1).max(200) }).strict();
const adapter = z.object({ version: wireInteger(1), event_kind: reviewEventKindSchema,
  adapter_id: z.enum(["movement_v1", "treatment_v1", "anesthesia_v1", "dispense_v1", "pickup_v1", "return_v1", "return_v2", "retraction_v1", "discrepancy_v1", "annotation_v1"]),
  target: reviewTargetSchema, site_basis: z.enum(["event_transitions", "managed_dispense", "managed_pickup", "managed_return", "opening_custody_site"]),
  site_id: reviewUuidSchema, source_refs: z.array(ref).max(512), native_family_dispense_id: reviewUuidSchema.nullable(),
  provenance_state: z.literal("supported"), reason: z.null(),
}).strict();
const roles = z.array(z.enum(["ADMIN", "DVM", "STAFF", "TECH"])).min(1).max(4)
  .refine(values => values.every((value, i) => i === 0 || values[i - 1] < value));
const eligibility = z.object({ id: reviewUuidSchema, record_hash: reviewDigestSchema, actor_id: reviewUuidSchema, roles }).strict();
const packet = z.object({ version: wireInteger(3), meaning: z.literal(reviewMeaning), meaning_text: z.literal(reviewMeaningText),
  meaning_version: wireInteger(1), target: reviewTargetSchema, adapter, event: object, parent_preparation: object,
  original_result: object, clinical_snapshot: object, source_rows: z.array(z.object({ relation: ref.shape.relation, key: object, row: object }).strict()).max(512),
  event_lines: z.array(object).max(512), cells: z.array(object).max(512), transitions: z.array(object).max(512), containers: z.array(object).max(512),
  obligation: object, current_authorization: z.object({
    policy: z.object({ id: reviewUuidSchema, record_hash: reviewDigestSchema, rule: object }).strict(),
    read: eligibility, review: eligibility,
  }).strict(),
}).strict();
const envelope = z.object({ version: wireInteger(3), state: z.literal("prepared"), data: z.object({
  operation_id: reviewUuidSchema, request: recordReviewRequestSchema, transport_digest: reviewDigestSchema,
  packet, packet_hash: reviewDigestSchema, created_at: reviewProtocolInstantSchema, expires_at: reviewProtocolInstantSchema,
}).strict() }).strict();
export interface PreparedReview extends z.infer<typeof envelope> {}
/** Closed response schema; exported for the separate authenticated reconstruction check. */
export const reviewPreparedResponseSchema = envelope;
export interface PreparedReviewPacket extends z.infer<typeof packet> {}
/** P alone: this schema creates no preparation envelope or operation. */
export const reviewRequiredPacketSchema = packet;

/** Required source-specific admission. No production implementation is implied.
 * It must validate every row/key/order, exact original event/preparation/result/
 * clinical binding, adapter dispatch/membership, obligation and policy rule.
 * An absent or rejecting validator never enables confirmation. Do not hash P.
 */
export interface ReviewEvidenceAdmission {
  validate(packet: PreparedReviewPacket, request: Readonly<RecordReviewRequest>): void | Promise<void>;
}

function sameTarget(a: PreparedReviewPacket["target"], b: PreparedReviewPacket["target"]): boolean {
  return Object.keys(a).every(key => key === "sequence" || key === "engine_revision" ? String(a[key]) === String(b[key]) : a[key] === b[key]);
}
/** PostgreSQL numeric_out retains decimal scale, expands exponent notation and
 * suppresses a zero sign (numeric.c/get_str_from_var). Calculate only its length
 * with bounded token/BigInt arithmetic; never allocate exponent-sized strings,
 * convert the value to Number, or rebuild/hash a packet.
 */
export function reviewNumericTextBytes(value: ExactJsonNumber): bigint {
  const token = String(value);
  if (token.length > 1024) throw new Error("Review numeric token exceeds the limit");
  const match = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/.exec(token);
  if (!match) throw new Error("Invalid review numeric token");
  const fraction = match[3] ?? "", exponent = BigInt(match[4] ?? "0");
  const digits = (match[2] + fraction).replace(/^0+/, "");
  const scale = BigInt(fraction.length) > exponent ? BigInt(fraction.length) - exponent : 0n;
  const integral = digits.length ? BigInt(digits.length) + exponent - BigInt(fraction.length) : 1n;
  return (digits.length && match[1] ? 1n : 0n) + (integral > 0n ? integral : 1n) + (scale > 0n ? 1n + scale : 0n);
}
/** Count canonical jsonb text bytes of losslessly decoded evidence, without
 * serializing/hashing it or conferring source authority. Decoder bounds apply. */
export function reviewJsonbTextBytes(value: unknown): number {
  if (value === null) return 4;
  if (typeof value === "boolean") return value ? 4 : 5;
  if (typeof value === "string") return new TextEncoder().encode(JSON.stringify(value)).length;
  if (value instanceof ExactJsonNumber) {
    const bytes = reviewNumericTextBytes(value);
    return bytes > 1048576n ? 1048577 : Number(bytes); // bounded byte count, never the clinical value
  }
  if (Array.isArray(value)) return 2 + value.reduce((n, item) => n + reviewJsonbTextBytes(item), 0) + Math.max(0, value.length - 1) * 2;
  if (typeof value !== "object" || !value) throw new Error("Review evidence is not lossless JSON");
  const entries = Object.entries(value);
  return 2 + entries.reduce((n, [key, item]) => n + reviewJsonbTextBytes(key) + 2 + reviewJsonbTextBytes(item), 0) + Math.max(0, entries.length - 1) * 2;
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

/** Call check after every asynchronous boundary; it rejects obsolete sessions. */
export async function verifyPreparedReview(pointer: RecordReviewPointer, input: unknown, evidence: ReviewEvidenceAdmission,
  check: () => void, original?: Readonly<RecordReviewRequest>): Promise<PreparedReview> {
  check();
  const parsed = envelope.safeParse(input);
  if (!parsed.success) throw new Error("Prepared review evidence is invalid");
  const result = parsed.data, data = result.data, p = data.packet, req = data.request;
  if (!evidence || typeof evidence.validate !== "function") throw new Error("Complete review evidence validation is unavailable");
  if (data.operation_id !== pointer.operation_id || req.operation_id !== pointer.operation_id || req.actor_id !== pointer.actor_id ||
    data.transport_digest !== pointer.transport_digest || p.target.event_id !== req.event_id || p.target.original_actor_id === req.actor_id ||
    !sameTarget(p.target, p.adapter.target) || p.current_authorization.policy.id !== req.policy_id ||
    p.current_authorization.read.id !== req.read_eligibility_id || p.current_authorization.review.id !== req.review_eligibility_id ||
    p.current_authorization.read.actor_id !== req.actor_id || p.current_authorization.review.actor_id !== req.actor_id ||
    (original && Object.keys(original).some(key => original[key] !== req[key])) ||
    Date.parse(data.expires_at) - Date.parse(data.created_at) !== 15 * 60 * 1000 ||
    data.created_at.slice(20, 26) !== data.expires_at.slice(20, 26) || reviewJsonbTextBytes(p) > 1048576)
    throw new Error("Prepared review does not match its original request");
  const digest = await reviewTransportDigest(req); check();
  if (digest !== pointer.transport_digest) throw new Error("Prepared review request commitment differs");
  // Freeze before invoking the trusted source-specific validator so it cannot
  // accidentally mutate evidence after validation or while awaiting a result.
  freeze(result);
  try { await evidence.validate(p, req); } catch { check(); throw new Error("Complete review evidence could not be validated"); }
  check();
  return result;
}
