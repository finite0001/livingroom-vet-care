import { z } from "zod";
import { ExactJsonNumber, protocolInteger, validUnicode, type ExactJson } from "./exact-json.ts";
import { hashReviewTarget } from "./component-hashes.ts";
import { sameReviewJsonb } from "./jsonb-equality.ts";
import { reviewJsonbTextBytes, reviewMeaning, reviewMeaningText, reviewProtocolInstantSchema, reviewRequiredPacketSchema } from "./prepared-packet.ts";
import { reviewSummarySchema } from "./queue-model.ts";
import { recordReviewRequestSchema, reviewDigestSchema, reviewUuidSchema } from "./request.ts";
import { reviewDetailRequestSchema, type ReviewDetailRequest } from "./read-rpc.ts";

const wireInteger = (n: number) => z.instanceof(ExactJsonNumber).refine(value => {
  try { return protocolInteger(value, n, n) === n; } catch { return false; }
});
const auth = reviewRequiredPacketSchema.shape.current_authorization;
const readPacketSchema = reviewRequiredPacketSchema.extend({
  obligation: reviewRequiredPacketSchema.shape.obligation.nullable(),
  current_authorization: auth.extend({ policy: auth.shape.policy.nullable(), review: auth.shape.review.nullable() }).strict(),
}).strict();
export interface ReadReviewPacket extends z.infer<typeof readPacketSchema> {}
const reason = z.enum(["rejected", "overdue", "discrepancy_report", "no_eligible_reviewer", "routing_unavailable", "evidence_unavailable"]);
const orderedReasons = z.array(reason).max(6).refine(values =>
  values.every((value, index) => index === 0 || values[index - 1] < value));
const actorName = z.string().refine(value => validUnicode(value) && value === value.trim() && Array.from(value).length >= 1 &&
  Array.from(value).length <= 200 && Array.from(value).every(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127));
const terminal = z.object({ decision: z.enum(["approve", "reject"]), meaning: z.literal(reviewMeaning), meaning_text: z.literal(reviewMeaningText),
  meaning_version: wireInteger(1), actor_id: reviewUuidSchema, actor_name: actorName, recorded_at: reviewProtocolInstantSchema,
  reason: recordReviewRequestSchema.shape.reason, receipt_hash: reviewDigestSchema, target_hash: reviewDigestSchema, packet_hash: reviewDigestSchema }).strict();
const escalation = z.object({ reason, first_detected_at: reviewProtocolInstantSchema,
  has_acknowledgment: z.boolean(), has_resolution_note: z.boolean() }).strict();
const detail = z.object({ version: wireInteger(3), state: z.literal("detail"), data: z.object({
  summary: reviewSummarySchema, packet: readPacketSchema, terminal_review: terminal.nullable(), escalations: z.array(escalation).max(6)
    .refine(values => values.every((value, index) => index === 0 || values[index - 1].reason < value.reason)),
  derived_escalation_reasons: orderedReasons, policy_id: reviewUuidSchema.nullable(), read_eligibility_id: reviewUuidSchema,
  review_eligibility_id: reviewUuidSchema.nullable(),
}).strict() }).strict();
const exception = z.object({ version: wireInteger(3), state: z.literal("exception"), data: z.object({ summary: reviewSummarySchema }).strict() }).strict();
const response = z.discriminatedUnion("state", [detail, exception]);
export interface ReviewDetail extends z.infer<typeof detail> {}
export interface ReviewDetailException extends z.infer<typeof exception> {}
export type ReviewDetailResponse = ReviewDetail | ReviewDetailException;
const selection = recordReviewRequestSchema.pick({ actor_id: true, event_id: true, policy_id: true, read_eligibility_id: true, review_eligibility_id: true }).strict();
export interface ReadReviewSelection extends z.infer<typeof selection> {}
export interface AdmittedReviewDetail {
  readonly response: ReviewDetailResponse;
  readonly selection: Readonly<ReadReviewSelection> | null;
}
/** Mandatory complete available-field validation under an admitted backend,
 * historical-source and current-authorization contract. Shape-only/no-op
 * validation is not a production implementation. No default is provided.
 */
export interface ReviewDetailEvidenceAdmission {
  validate(response: Readonly<ReviewDetailResponse>, request: Readonly<ReviewDetailRequest>): void | Promise<void>;
}
interface EvidenceObject { readonly [key: string]: ExactJson }
function object(value: unknown): EvidenceObject {
  if (!value || typeof value !== "object" || Array.isArray(value) || value instanceof ExactJsonNumber) throw new Error("Expected source object");
  return value as EvidenceObject;
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

/** Read-only admission. No preparation metadata, operation UUID, signature or
 * pointer is synthesized. The consumer must check identity again at its own
 * commit boundary after awaiting this function.
 */
export async function verifyReviewDetail(requestInput: unknown, input: unknown, evidence: ReviewDetailEvidenceAdmission,
  check: () => void): Promise<AdmittedReviewDetail> {
  try {
    check();
    const request = freeze(reviewDetailRequestSchema.parse(requestInput)), result = freeze(response.parse(input)), s = result.data.summary;
    check();
    if (s.event_id !== request.event_id || !evidence || typeof evidence.validate !== "function") throw new Error("Detail target or admission differs");
    let signingSelection: ReadReviewSelection | null = null;
    if (result.state === "exception") {
      if (s.signing_state === "available") throw new Error("Exception cannot offer signing");
    } else {
      const d = result.data, p = d.packet, a = p.current_authorization, e = p.event, ob = p.obligation, t = d.terminal_review;
      if (p.target.event_id !== request.event_id || !sameReviewJsonb(p.target, p.adapter.target) ||
        String(p.target.sequence) !== s.event_sequence || p.adapter.event_kind !== s.event_kind ||
        p.adapter.site_id !== s.site_id || p.adapter.site_basis !== s.site_basis ||
        e.id !== s.event_id || String(e.sequence) !== s.event_sequence || e.product_id !== p.target.product_id ||
        e.actor_id !== p.target.original_actor_id || e.record_hash !== p.target.record_hash ||
        e.policy_version_id !== p.target.policy_version_id || e.opening_id !== p.target.opening_id || !sameReviewJsonb(e.engine_revision, p.target.engine_revision) ||
        e.observed_at !== s.observed_at || e.recorded_at !== s.recorded_at ||
        d.policy_id !== (a.policy?.id ?? null) || d.read_eligibility_id !== a.read.id || d.review_eligibility_id !== (a.review?.id ?? null) ||
        a.read.actor_id !== request.actor_id || (a.review !== null && a.review.actor_id !== request.actor_id) ||
        typeof e.secondary_review_required !== "boolean" || (ob !== null) !== e.secondary_review_required ||
        (s.review_state !== "not_required") !== e.secondary_review_required || reviewJsonbTextBytes(p) > 1048576)
        throw new Error("Detail source or current selection differs");
      if (ob !== null && (ob.due_at !== s.due_at || object(ob.historical).deadline_basis !== s.deadline_basis)) throw new Error("Detail deadline differs");
      if ((t !== null) !== (s.signing_state === "terminal") || (t && s.review_state !== (t.decision === "approve" ? "approved" : "rejected")))
        throw new Error("Detail terminal state differs");
      const persisted = new Set(d.escalations.map(item => item.reason));
      if (persisted.has("rejected") !== (t?.decision === "reject") || d.derived_escalation_reasons.some(value => value === "rejected" || persisted.has(value)) ||
        (!e.secondary_review_required && (t !== null || d.escalations.length !== 0 || d.derived_escalation_reasons.length !== 0)))
        throw new Error("Detail escalation history differs");
      if (t && (t.actor_id === p.target.original_actor_id || t.target_hash !== await hashReviewTarget(p.target))) throw new Error("Terminal target differs");
      check();
      if (s.signing_state === "available") {
        if (!a.policy || !a.review || !ob || t || request.actor_id === p.target.original_actor_id || a.policy.rule.enabled !== true)
          throw new Error("Detail cannot offer preparation");
        signingSelection = selection.parse({ ...request, policy_id: d.policy_id, read_eligibility_id: d.read_eligibility_id, review_eligibility_id: d.review_eligibility_id });
      }
    }
    check();
    await evidence.validate(result, request); check();
    return freeze({ response: result, selection: signingSelection });
  } catch {
    // Neither raw source fields, Zod errors nor trusted callback errors escape.
    throw new Error("Review detail could not be admitted for this staff session");
  }
}
