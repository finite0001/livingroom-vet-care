import { z } from "zod";

export const CALL_SOURCE_CONTRACT = "clinical-call-source-v1";
export const CALL_PROVIDER_SCHEMA = "cloudtalk-ci-transcription-v1";
export const CALL_LIMITS = {
  page_size: 100, pages_per_pass: 10, requests: 20, segments: 1000,
  characters: 60000, bytes: 240000, response_bytes: 512000,
  page_ms: 10000, capture_ms: 120000,
} as const;
const uuid = z.string().uuid();
const timestamp = z.string().datetime({ offset: true });
const text = (max: number) => z.string().max(max).refine((s) => !s.includes("\0"));
const nonblank = (max: number) => text(max).refine((s) => !!s.trim());
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const callProviderIdSchema = z.string().regex(/^[1-9][0-9]{0,15}$/).refine((s) => Number.isSafeInteger(Number(s)));
export const callPolicySchema = z.object({
  version: z.number().int().positive(), status: z.enum(["draft", "approved"]),
  consent_text: nonblank(4000), retention_text: nonblank(2000),
  reviewed_by: uuid.nullable(), reviewed_at: timestamp.nullable(), created_at: timestamp,
}).strict();
export const callCaptureIntentSchema = z.object({
  pet_id: uuid, expected_pet_version: z.number().int().positive(),
  encounter_id: uuid, expected_encounter_version: z.number().int().positive(),
  inbound_id: uuid, expected_inbound_version: z.number().int().positive(),
  policy_version: z.number().int().positive(), attest_authorized: z.literal(true),
}).strict();
export const callCallerSchema = z.object({
  type: z.enum(["agent", "contact"]), id: z.number().int().safe().nullable(),
  localIdentifier: nonblank(100),
}).strict();
export const callSegmentSchema = z.object({
  start: z.number().finite().nonnegative(), end: z.number().finite().nonnegative(),
  caller: nonblank(100), text: nonblank(60000),
}).strict().refine((s) => s.end >= s.start, "Segment end precedes start.");
export const callProviderPageSchema = z.object({
  data: z.object({
    callId: z.number().int().positive().safe(), language: nonblank(80),
    callers: z.array(callCallerSchema).min(1).max(50),
    segments: z.array(callSegmentSchema).max(CALL_LIMITS.page_size),
  }).strict(),
  pagination: z.object({
    limit: z.literal(CALL_LIMITS.page_size), offset: z.number().int().nonnegative().safe(),
    total: z.number().int().min(1).max(CALL_LIMITS.segments),
  }).strict(),
}).strict().superRefine((page, ctx) => {
  const labels = page.data.callers.map((c) => c.localIdentifier);
  if (new Set(labels).size !== labels.length || page.data.segments.some((s) => !labels.includes(s.caller))) {
    ctx.addIssue({ code: "custom", message: "Unique original caller labels and known segment attribution required." });
  }
});
export const callSourceSegmentSchema = z.object({
  ordinal: z.number().int().min(1).max(CALL_LIMITS.segments),
  start: z.number().finite().nonnegative(), end: z.number().finite().nonnegative(),
  caller: nonblank(100), text: nonblank(60000), text_sha256: hash,
  projection_from: z.number().int().nonnegative(), projection_to: z.number().int().nonnegative(),
}).strict();
export const callPageEvidenceSchema = z.object({
  pass: z.union([z.literal(1), z.literal(2)]), offset: z.number().int().nonnegative(),
  limit: z.literal(CALL_LIMITS.page_size), total: z.number().int().min(1).max(CALL_LIMITS.segments),
  count: z.number().int().min(1).max(CALL_LIMITS.page_size), sha256: hash, retrieved_at: timestamp, normalized_json: nonblank(CALL_LIMITS.response_bytes),
}).strict();
export const callSourceDocumentSchema = z.object({
  contract_version: z.literal(CALL_SOURCE_CONTRACT), provider_schema_version: z.literal(CALL_PROVIDER_SCHEMA),
  completeness: z.literal("observed_two_pass"), call_id: callProviderIdSchema,
  language: nonblank(80), callers: z.array(callCallerSchema).min(1).max(50),
  segments: z.array(callSourceSegmentSchema).min(1).max(CALL_LIMITS.segments),
  projection: nonblank(CALL_LIMITS.characters), pages: z.array(callPageEvidenceSchema).min(2).max(CALL_LIMITS.requests),
  captured_from: timestamp, captured_until: timestamp,
}).strict();
export const callCaptureActionSchema = z.object({
  id: uuid, actor_id: uuid, request: callCaptureIntentSchema.nullable(),
  state: z.enum(["pending", "capturing", "completed", "failed", "cancelled"]),
  source_id: uuid.nullable(), error_code: text(80).nullable(),
  lease_until: timestamp.nullable(), created_at: timestamp, finished_at: timestamp.nullable(),
}).strict();
export const callSourceContextSchema = z.object({
  client_id: uuid, conversation_id: uuid, message_id: uuid,
  call_uuid: nonblank(200), call_id: callProviderIdSchema,
  call_started_at: timestamp.nullable(), call_ended_at: timestamp, call_last_event_at: timestamp,
  inbound_version: z.number().int().positive(),
}).strict();
export const callSourceSchema = z.object({
  id: uuid, capture_id: uuid, actor_id: uuid, pet_id: uuid, encounter_id: uuid,
  client_id: uuid, conversation_id: uuid, call_uuid: nonblank(200), call_id: callProviderIdSchema,
  policy_version: z.number().int().positive(), context: callSourceContextSchema, document: callSourceDocumentSchema,
  sha256: hash, created_at: timestamp,
}).strict();
export const callCaptureReadSchema = z.object({
  action: callCaptureActionSchema, source: callSourceSchema.nullable(), policy: callPolicySchema,
}).strict();
export const callDispatchSchema = z.object({
  action: callCaptureActionSchema, provider_call_id: callProviderIdSchema,
}).strict();
export const callCandidateSchema = z.object({
  inbound_id: uuid, inbound_version: z.number().int().positive(), call_uuid: nonblank(200),
  call_id: callProviderIdSchema, occurred_at: timestamp, client_id: uuid, conversation_id: uuid,
}).strict();
export const callCandidatesSchema = z.object({
  policy: callPolicySchema, calls: z.array(callCandidateSchema).max(100), has_more: z.boolean(),
}).strict();
export async function callSha256(value: string) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export function callProjectionLine(segment: z.infer<typeof callSegmentSchema>, ordinal: number) {
  return `[#${String(ordinal).padStart(4, "0")} caller=${JSON.stringify(segment.caller)}]\n${segment.text}\n`;
}

/** Retain exact normalized bytes; SQL checks hash and semantic equivalence to the frozen segment slice. */
export function callPageFingerprintInput(page: z.infer<typeof callProviderPageSchema>) { return JSON.stringify(page); }
export const callSourceSummarySchema = callSourceSchema.omit({ document: true });
