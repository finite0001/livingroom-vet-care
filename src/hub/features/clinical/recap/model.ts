import { z } from "zod";
import {
  recapIntentSchema,
  recapJobReadSchema,
  recapReceiptSchema,
  recapPolicyReceiptSchema,
  recapSourceSchema,
  recapPolicyRequestSchema,
  recapReviewRequestSchema,
} from "../../../../../supabase/functions/_shared/clinical-recap-model.ts";
export * from "../../../../../supabase/functions/_shared/clinical-recap-model.ts";
const uuid = z
    .string()
    .uuid()
    .refine((value) => value === value.toLowerCase()),
  hash = z.string().regex(/^[a-f0-9]{64}$/);
const identity = { actor_id: uuid, pet_id: uuid, job_id: uuid };
export const pendingRecapSchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        ...identity,
        kind: z.literal("reservation"),
        expected_pet_version: z.number().int().positive(),
        policy_version: z.number().int().positive(),
        source_fingerprint: hash,
      })
      .strict(),
    z
      .object({
        ...identity,
        kind: z.literal("attempt"),
        intent: recapIntentSchema,
      })
      .strict(),
    z
      .object({
        ...identity,
        kind: z.literal("review"),
        action_id: uuid,
        output_id: uuid,
        output_hash: hash,
        manifest_hash: hash,
      })
      .strict(),
  ])
  .superRefine((v, c) => {
    if (v.kind === "attempt" && v.intent.job_id !== v.job_id)
      c.addIssue({ code: "custom", message: "Pending attempt job differs." });
  });
export const pendingPolicySchema = z
  .object({
    actor_id: uuid,
    action_id: uuid,
    expected_version: z.number().int().positive(),
  })
  .strict();
export type PendingRecap = z.infer<typeof pendingRecapSchema>;
export type JobRead = z.infer<typeof recapJobReadSchema>;
export type RecapSource = z.infer<typeof recapSourceSchema>;
export const retryReasons = {
  previous_failure_reviewed: "Previous processing failure reviewed",
  uncertain_outcome_duplicate_charge_authorized:
    "Prior outcome uncertain; possible duplicate charge authorized",
  expired_attempt_reviewed: "Expired processing attempt reviewed",
} as const;
export const retryReasonSchema = z.enum([
  "previous_failure_reviewed",
  "uncertain_outcome_duplicate_charge_authorized",
  "expired_attempt_reviewed",
]);
export const sourceReasonLabels: Record<string, string> = {
  patient_changed: "Patient identity or lifecycle changed",
  encounters_changed: "Selected encounter content or eligibility changed",
  addenda_changed: "Selected encounter addenda changed",
  problems_changed: "Selected native problem records changed",
  problem_eligibility_changed: "Native problem source eligibility changed",
  source_unavailable: "Selected sources are currently unavailable",
};
export const budgetLimits = {
  encounters: 20,
  problems: 40,
  source_units: 64,
  source_characters: 60000,
  source_bytes: 240000,
} as const;
export const budgetLabels = {
  encounters: "Signed encounters",
  problems: "Native problems",
  source_units: "Source units including addenda",
  source_characters: "Clinical characters (UTF-16)",
  source_bytes: "Canonical source bytes (UTF-8)",
} as const;
export function verifyJobRead(
  value: unknown,
  actor: string,
  pet: string,
  id: string,
) {
  const parsed = recapJobReadSchema.parse(value);
  if (
    parsed.actor_id !== actor ||
    parsed.job.id !== id ||
    parsed.job.pet_id !== pet ||
    parsed.manifest.source_set.patient.id !== pet
  )
    throw Error("Recap identity differs.");
  return parsed;
}
export function verifyReviewReceipt(
  value: unknown,
  pending: PendingRecap,
  job?: JobRead,
  request?: unknown,
) {
  const receipt = recapReceiptSchema.parse(value);
  if (
    pending.kind !== "review" ||
    receipt.id !== pending.action_id ||
    receipt.actor_id !== pending.actor_id ||
    receipt.job_id !== pending.job_id ||
    receipt.review.id !== pending.action_id ||
    receipt.review.job_id !== pending.job_id ||
    receipt.review.output_id !== pending.output_id ||
    receipt.review.output_sha256 !== pending.output_hash ||
    receipt.review.manifest_sha256 !== pending.manifest_hash
  )
    throw Error("Review receipt identity differs.");
  if (job) {
    if (
      job.review &&
      JSON.stringify(job.review) !== JSON.stringify(receipt.review)
    )
      throw Error("Receipt differs from the committed review.");
    recapJobReadSchema.parse({
      ...job,
      job: { ...job.job, review_version: 2 },
      review: receipt.review,
    });
  }
  if (request) {
    const input = job
      ? verifyReviewRequestEvidence(request, pending, job)
      : recapReviewRequestSchema.parse(request);
    if (
      receipt.review.decision !== input.decision ||
      receipt.review.review_note !== input.review_note ||
      receipt.review.accepted_claims.length !== input.accepted_claims.length ||
      input.accepted_claims.some(
        (claim) =>
          receipt.review.accepted_claims.find(
            (item) => item.claim_id === claim.claim_id,
          )?.reviewed_text !== claim.text,
      )
    )
      throw Error("Recovered review differs from its exact request.");
  }
  return receipt;
}
export function verifyReviewRequest(
  request: unknown,
  pending: PendingRecap,
  job: JobRead,
) {
  const input = verifyReviewRequestEvidence(request, pending, job);
  if (input.expected_review_version !== job.job.review_version)
    throw Error("Review admission version differs.");
  return input;
}
function verifyReviewRequestEvidence(
  request: unknown,
  pending: PendingRecap,
  job: JobRead,
) {
  const input = recapReviewRequestSchema.parse(request);
  verifyJobRead(job, pending.actor_id, pending.pet_id, pending.job_id);
  if (
    pending.kind !== "review" ||
    !job.output ||
    input.job_id !== pending.job_id ||
    input.output_id !== pending.output_id ||
    input.expected_output_hash !== pending.output_hash ||
    input.manifest_sha256 !== pending.manifest_hash ||
    input.output_id !== job.output.id ||
    input.expected_output_hash !== job.output.payload_sha256 ||
    input.manifest_sha256 !== job.manifest.sha256 ||
    input.accepted_claims.some(
      (claim) =>
        !job.output.payload.claims.some(
          (original) => original.claim_id === claim.claim_id,
        ),
    )
  )
    throw Error("Review request differs from its pinned output.");
  return input;
}
export function verifyPolicyReceipt(
  value: unknown,
  pending: z.infer<typeof pendingPolicySchema>,
  request?: unknown,
) {
  const receipt = recapPolicyReceiptSchema.parse(value);
  if (
    receipt.id !== pending.action_id ||
    receipt.actor_id !== pending.actor_id ||
    receipt.policy.version !== pending.expected_version + 1
  )
    throw Error("Policy receipt identity differs.");
  if (request) {
    const input = recapPolicyRequestSchema.parse(request);
    if (
      receipt.policy.status !== input.status ||
      receipt.policy.consent_text !== input.consent_text ||
      receipt.policy.retention_text !== input.retention_text ||
      (input.status === "approved" &&
        receipt.policy.reviewed_by !== pending.actor_id)
    )
      throw Error("Policy receipt content differs.");
  }
  return receipt;
}
interface AttemptLease {
  state?: string;
  lease_until?: string;
}
export function unresolvedAttempt(attempt: AttemptLease) {
  if (
    !attempt.state ||
    !attempt.lease_until ||
    !Number.isFinite(Date.parse(attempt.lease_until))
  )
    return true;
  return (
    ["claimed", "sending"].includes(attempt.state) &&
    Date.parse(attempt.lease_until) > Date.now()
  );
}
interface ExcerptPart {
  text: string;
  highlighted: boolean;
}
export function excerptParts(text: string, quote: string) {
  if (!quote || !text.includes(quote)) throw Error("Citation excerpt differs.");
  const parts: ExcerptPart[] = [];
  let cursor = 0,
    index = text.indexOf(quote);
  while (index !== -1) {
    if (index > cursor)
      parts.push({ text: text.slice(cursor, index), highlighted: false });
    parts.push({ text: quote, highlighted: true });
    cursor = index + quote.length;
    index = text.indexOf(quote, cursor);
  }
  if (cursor < text.length)
    parts.push({ text: text.slice(cursor), highlighted: false });
  return parts;
}
