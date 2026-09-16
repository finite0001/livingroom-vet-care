import { z } from "zod";

const uuid = z.string().uuid().refine((v) => v === v.toLowerCase());
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const sequence = z.number().int().min(1).max(2147483647);
const instant = z.string().datetime().refine((v) =>
  Number.isFinite(Date.parse(v)) && !/\.\d{7}/.test(v));
const text = (min: number, max: number) => z.string().refine((v) =>
  v === v.trim() && Array.from(v).length >= min && Array.from(v).length <= max &&
  !/[\uD800-\uDFFF]/u.test(v) && !Array.from(v).some((char) => {
    const code = char.charCodeAt(0);
    return code === 127 || (code < 32 && code !== 9 && code !== 10);
  }));

export const estimateDecisionTargetSchema = z.object({
  estimate_id: uuid, client_id: uuid, pet_id: uuid,
}).strict();
export const estimateDecisionBindingSchema = z.object({
  target: estimateDecisionTargetSchema, publication_id: uuid,
  content_hash: hash, artifact_hash: hash,
}).strict();
export const estimateDecisionHeadSchema = z.object({
  event_id: uuid.nullable(), version: z.number().int().min(0).max(2147483647),
  record_hash: hash.nullable(),
}).strict().refine((v) => v.version === 0
  ? v.event_id === null && v.record_hash === null
  : v.event_id !== null && v.record_hash !== null);

const decisionFields = {
  binding: estimateDecisionBindingSchema,
  grant_id: uuid.nullable(),
  expected_publication_head: estimateDecisionHeadSchema,
  choice: z.enum(["accept", "decline"]),
  signer_name: text(1, 200),
  signer_relationship: z.enum(["owner", "authorized_agent"]),
  comment: text(1, 2000).nullable(),
  acknowledgment_version: z.literal(1),
  attest_document_review: z.literal(true),
  attest_authority: z.literal(true),
  attest_choice: z.literal(true),
};
export const estimateClientDecisionRequestSchema = z.object({
  ...decisionFields, grant_id: uuid,
}).strict();
export const estimateWitnessedDecisionRequestSchema = z.object({
  decision: z.object({ ...decisionFields, grant_id: z.null() }).strict(),
  witness: z.object({
    channel: z.enum(["in_person", "telephone", "video", "written"]),
    occurred_at: instant, note: text(1, 2000),
    attest_direct_client_instruction: z.literal(true),
  }).strict(),
}).strict();

export const estimatePublicDecisionSchema = z.object({
  version: z.literal(1), id: uuid, sequence,
  binding: estimateDecisionBindingSchema,
  choice: decisionFields.choice,
  signer_name: decisionFields.signer_name,
  signer_relationship: decisionFields.signer_relationship,
  comment: decisionFields.comment,
  acknowledgment_version: z.literal(1),
  attribution: z.enum(["link_holder", "practice_staff_witness"]),
  recorded_at: instant, record_hash: hash,
}).strict();

/** Compare parsed evidence without relying on JSON object-key ordering. */
export function sameEstimateDecisionEvidence(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object" ||
    Array.isArray(a) !== Array.isArray(b)) return false;
  const aa = a as Record<string, unknown>, bb = b as Record<string, unknown>;
  return Object.keys(aa).length === Object.keys(bb).length &&
    Object.keys(aa).every((key) => Object.hasOwn(bb, key) && sameEstimateDecisionEvidence(aa[key], bb[key]));
}

export const estimatePublicDecisionReceiptSchema = z.object({
  version: z.literal(1), id: uuid, grant_id: uuid,
  request: estimateClientDecisionRequestSchema, request_hash: hash,
  result: estimatePublicDecisionSchema, created_at: instant,
}).strict().superRefine((v, ctx) => {
  if (v.grant_id !== v.request.grant_id || v.id !== v.result.id ||
    v.created_at !== v.result.recorded_at || v.result.attribution !== "link_holder" ||
    !sameEstimateDecisionEvidence(v.request.binding, v.result.binding) ||
    (["choice", "signer_name", "signer_relationship", "comment", "acknowledgment_version"] as const)
      .some((key) => v.request[key] !== v.result[key])) {
    ctx.addIssue({ code: "custom", message: "Estimate decision receipt differs from its request." });
  }
});
export const estimatePublicDecisionClosureSchema = z.object({
  version: z.literal(1), id: uuid, grant_id: uuid,
  request: estimateClientDecisionRequestSchema, request_hash: hash,
  closed_at: instant, record_hash: hash,
  closed_by: z.enum(["link_holder", "practice_staff"]),
}).strict().refine((v) => v.grant_id === v.request.grant_id);

const recorded = z.object({ version: z.literal(1), status: z.literal("recorded"), receipt: estimatePublicDecisionReceiptSchema }).strict();
const closed = z.object({ version: z.literal(1), status: z.literal("closed_unrecorded"), closure: estimatePublicDecisionClosureSchema }).strict();
export const estimatePublicDecisionResolutionSchema = z.discriminatedUnion("status", [
  recorded, closed, z.object({ version: z.literal(1), status: z.literal("unrecorded") }).strict(),
]);
export const estimatePublicDecisionTerminalSchema = z.discriminatedUnion("status", [recorded, closed]);
export const estimateClientDecisionOperationSchema = z.object({
  version: z.literal(1), id: uuid, grant_id: uuid, publication_id: uuid,
  request: estimateClientDecisionRequestSchema,
}).strict().refine((v) => v.grant_id === v.request.grant_id &&
  v.publication_id === v.request.binding.publication_id);

export interface EstimateClientDecisionRequest extends z.infer<typeof estimateClientDecisionRequestSchema> {}
export interface EstimateClientDecisionOperation extends z.infer<typeof estimateClientDecisionOperationSchema> {}
export interface EstimatePublicDecisionReceipt extends z.infer<typeof estimatePublicDecisionReceiptSchema> {}

/** An unrecorded lookup is not a durable cancellation of an in-flight write. */
export function verifyEstimateDecisionResolution(input: unknown, operationInput: unknown, terminal = false) {
  const operation = estimateClientDecisionOperationSchema.parse(operationInput);
  const result = (terminal ? estimatePublicDecisionTerminalSchema : estimatePublicDecisionResolutionSchema).parse(input);
  if (result.status === "unrecorded") return result;
  const evidence = result.status === "recorded" ? result.receipt : result.closure;
  if (evidence.id !== operation.id || evidence.grant_id !== operation.grant_id ||
    !sameEstimateDecisionEvidence(evidence.request, operation.request)) {
    throw new Error("Estimate decision evidence does not match the original request.");
  }
  return result;
}
