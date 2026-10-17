import { z } from "zod";
import { audioLanguageContextSchema } from "./clinical-audio-model.ts";

export const RECAP_CONTRACT = "clinical-recap-v1";
export const RECAP_SOURCE_CONTRACT = "clinical-recap-source-v1";
export const RECAP_PROMPT_VERSION = "lrv-recap-claims-v3";
export const RECAP_PROMPT_VERSIONS = [
  "lrv-recap-claims-v1",
  "lrv-recap-claims-v2",
  RECAP_PROMPT_VERSION,
] as const;
export const RECAP_LIMITS = {
  encounters: 20,
  problems: 40,
  source_units: 64,
  source_characters: 60000,
  source_bytes: 240000,
} as const;
export const RECAP_UNSUPPORTED_FAMILIES = [
  "documents",
  "outside_records",
  "structured_labs",
  "structured_treatments",
  "structured_prescriptions",
  "structured_vaccines",
  "imaging",
] as const;
export const RECAP_REASONS = [
  "patient_changed",
  "encounters_changed",
  "addenda_changed",
  "problems_changed",
  "problem_eligibility_changed",
  "source_unavailable",
] as const;
export const recapUuidSchema = z.string().uuid().refine(
  (s) => s === s.toLowerCase(),
  "Canonical UUID required.",
);
export const recapHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const recapTimestampSchema = z.string().datetime({
  precision: 6,
  offset: false,
});
export const recapDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(
  (s) =>
    Number.isFinite(Date.parse(s + "T00:00:00Z")) &&
    new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s,
  "Valid date required.",
);
const uuid = recapUuidSchema,
  hash = recapHashSchema,
  timestamp = recapTimestampSchema,
  date = recapDateSchema;
const version = z.number().int().min(1).max(2147483646);
const count = z.number().int().nonnegative().safe();
const text = (max: number) =>
  z.string().max(max).refine((s) => !s.includes("\0"));
const nonblank = (max: number) => text(max).refine((s) => !!s.trim());
const ordered = (values: readonly string[]) =>
  values.every((v, i) => i === 0 || values[i - 1] < v);
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const issue = (c: z.RefinementCtx, message: string) =>
  c.addIssue({ code: "custom", message });
export const recapSelectionSchema = z.object({
  encounter_ids: z.array(uuid).max(20),
  include_native_problems: z.boolean(),
  visit_from: date.nullable(),
  visit_to: date.nullable(),
}).strict().superRefine((v, c) => {
  if (!ordered(v.encounter_ids)) {
    issue(c, "Unique canonical encounter order required.");
  }
  if (v.visit_from && v.visit_to && v.visit_from > v.visit_to) {
    issue(c, "Visit date range is reversed.");
  }
});
export const recapPatientSchema = z.object({
  id: uuid,
  version,
  name: text(240000),
  species: text(240000),
  breed: text(240000).nullable(),
  dob: date.nullable(),
  birth_date_precision: z.enum(["exact", "estimated", "unknown"]),
  sex: z.enum(["unknown", "female", "male"]),
  neuter_status: z.enum(["unknown", "intact", "neutered"]),
  archived_at: timestamp.nullable(),
  deceased_at: date.nullable(),
}).strict();
const sourceBase = z.object({
  ref: z.string().regex(/^src_00(?:0[1-9]|[1-5][0-9]|6[0-4])$/),
  id: uuid,
  pet_id: uuid,
  sha256: hash,
});
const signedSource = sourceBase.extend({
  kind: z.literal("signed_encounter"),
  version,
  metadata: z.object({
    visit_at: timestamp,
    created_by: uuid,
    signed_by: uuid,
    signed_at: timestamp,
  }).strict(),
  fields: z.object({
    subjective: text(60000),
    objective: text(60000),
    assessment: text(60000),
    plan: text(60000),
  }).strict(),
}).strict();
const addendumSource = sourceBase.extend({
  kind: z.literal("addendum"),
  version: z.null(),
  metadata: z.object({
    encounter_id: uuid,
    created_by: uuid,
    created_at: timestamp,
  }).strict(),
  fields: z.object({ content: text(60000) }).strict(),
}).strict();
const problemSource = sourceBase.extend({
  kind: z.literal("native_problem"),
  version,
  metadata: z.object({
    created_by: uuid,
    created_at: timestamp,
    updated_by: uuid,
    updated_at: timestamp,
  }).strict(),
  fields: z.object({
    title: text(60000),
    notes: text(60000),
    status: z.enum(["active", "resolved"]),
    importance: z.enum(["routine", "high"]),
    onset_date: date.nullable(),
  }).strict(),
}).strict();
export const recapSourceSchema = z.discriminatedUnion("kind", [
  signedSource,
  addendumSource,
  problemSource,
]);
export const recapBudgetsSchema = z.object({
  encounters: count.max(20),
  problems: count.max(40),
  source_units: count.min(1).max(64),
  source_characters: count.max(60000),
  source_bytes: count.min(1).max(240000),
}).strict();
function visitDate(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Denver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  return ["year", "month", "day"].map((kind) =>
    parts.find((part) => part.type === kind)!.value
  ).join("-");
}
export const recapSourceSetSchema = z.object({
  patient: recapPatientSchema,
  selection: recapSelectionSchema,
  sources: z.array(recapSourceSchema).min(1).max(64),
  membership: z.object({
    addenda_by_encounter: z.array(
      z.object({ encounter_id: uuid, source_ids: z.array(uuid).max(64) })
        .strict(),
    ).max(20),
    native_problem_ids: z.array(uuid).max(40).nullable(),
  }).strict(),
  exclusions: z.object({
    outside_linked_problem_count: count.nullable(),
    unsupported_families: z.array(z.enum(RECAP_UNSUPPORTED_FAMILIES)).length(
      RECAP_UNSUPPORTED_FAMILIES.length,
    ),
  }).strict(),
  budgets: recapBudgetsSchema,
}).strict().superRefine((v, c) => {
  const keys = v.sources.map((s) => s.kind + ":" + s.id);
  if (
    !ordered(keys) ||
    v.sources.some((s, i) =>
      s.ref !== `src_${String(i + 1).padStart(4, "0")}` ||
      s.pet_id !== v.patient.id
    )
  ) issue(c, "Ordered patient-bound source identities required.");
  const encounters = v.sources.filter((s) => s.kind === "signed_encounter"),
    problems = v.sources.filter((s) => s.kind === "native_problem"),
    addenda = v.sources.filter((s) => s.kind === "addendum");
  if (
    !same(encounters.map((s) => s.id), v.selection.encounter_ids) ||
    !same(
      v.membership.addenda_by_encounter.map((m) => m.encounter_id),
      v.selection.encounter_ids,
    )
  ) issue(c, "Selected encounter membership differs.");
  for (const m of v.membership.addenda_by_encounter) {
    if (
      !same(
        m.source_ids,
        addenda.filter((s) => s.metadata.encounter_id === m.encounter_id).map((
          s,
        ) => s.id),
      )
    ) issue(c, "Complete captured addendum membership required.");
  }
  if (
    addenda.some((s) =>
      !v.selection.encounter_ids.includes(s.metadata.encounter_id)
    )
  ) issue(c, "Addendum parent is outside selection.");
  if (
    v.selection.include_native_problems
      ? !same(v.membership.native_problem_ids, problems.map((s) => s.id)) ||
        v.exclusions.outside_linked_problem_count === null
      : problems.length !== 0 || v.membership.native_problem_ids !== null ||
        v.exclusions.outside_linked_problem_count !== null
  ) issue(c, "Optional problem scope differs.");
  if (!same(v.exclusions.unsupported_families, RECAP_UNSUPPORTED_FAMILIES)) {
    issue(c, "Explicit unsupported source coverage required.");
  }
  const chars = v.sources.reduce(
    (n, s) =>
      n +
      Object.values(s.fields).reduce<number>(
        (sum, f) => sum + (typeof f === "string" ? f.length : 0),
        0,
      ),
    0,
  );
  if (
    v.budgets.encounters !== encounters.length ||
    v.budgets.problems !== problems.length ||
    v.budgets.source_units !== v.sources.length ||
    v.budgets.source_characters !== chars
  ) issue(c, "Source budgets differ from captured content.");
  for (const e of encounters) {
    const day = visitDate(e.metadata.visit_at);
    if (
      v.selection.visit_from && day < v.selection.visit_from ||
      v.selection.visit_to && day > v.selection.visit_to
    ) issue(c, "Encounter outside selected visit range.");
  }
});
export const recapManifestSchema = z.object({
  id: uuid,
  contract_version: z.literal(RECAP_SOURCE_CONTRACT),
  captured_at: timestamp,
  source_fingerprint: hash,
  source_set: recapSourceSetSchema,
  sha256: hash,
}).strict();
export const recapPreviewSchema = z.object({
  actor_id: uuid,
  pet_id: uuid,
  source_set: recapSourceSetSchema,
  source_fingerprint: hash,
}).strict().refine(
  (v) => v.pet_id === v.source_set.patient.id,
  "Preview patient differs.",
);
export const recapPolicySchema = z.object({
  version,
  status: z.enum(["draft", "approved"]),
  consent_text: nonblank(4000),
  retention_text: nonblank(2000),
  generation_model: z.literal("gpt-6-luna"),
  reviewed_by: uuid.nullable(),
  reviewed_at: timestamp.nullable(),
  created_at: timestamp,
}).strict().refine((v) =>
  v.status === "approved"
    ? !!v.reviewed_by && !!v.reviewed_at
    : v.reviewed_by === null && v.reviewed_at === null
);
export const recapPolicyRequestSchema = z.object({
  expected_version: version,
  status: z.enum(["draft", "approved"]),
  consent_text: nonblank(4000),
  retention_text: nonblank(2000),
  attest_reviewed: z.boolean(),
}).strict().refine(
  (v) => v.status !== "approved" || v.attest_reviewed,
  "Policy approval requires review.",
);
export const recapPolicyReceiptSchema = z.object({
  id: uuid,
  actor_id: uuid,
  request_hash: hash,
  policy: recapPolicySchema,
}).strict();
export const recapReserveSchema = z.object({
  pet_id: uuid,
  expected_pet_version: version,
  policy_version: version,
  selection: recapSelectionSchema,
  expected_source_fingerprint: hash,
  source_note: nonblank(1000),
  attest_authorized: z.literal(true),
  previous_job_id: uuid.nullable(),
}).strict();
export const recapRetryReasonSchema = z.enum([
  "previous_failure_reviewed",
  "uncertain_outcome_duplicate_charge_authorized",
  "expired_attempt_reviewed",
]);
const intentBase = z.object({
  job_id: uuid,
  attempt_id: uuid,
  retry_of: uuid.nullable(),
  reason: z.union([z.literal(""), recapRetryReasonSchema]),
  ack_cost: z.boolean(),
}).strict();
function validRetry(
  v: { retry_of?: string | null; reason?: string; ack_cost?: boolean },
) {
  return v.retry_of === null
    ? v.reason === "" && v.ack_cost === false
    : typeof v.retry_of === "string" && !!v.reason && v.ack_cost === true;
}
export const recapIntentSchema = intentBase.refine(
  (v) => validRetry(v) && v.retry_of !== v.attempt_id,
  "Exact initial/retry authorization required.",
);
const storedIntentSchema = intentBase.omit({ attempt_id: true }).refine(
  validRetry,
  "Exact initial/retry authorization required.",
);
export const recapAttemptStateSchema = z.enum([
  "claimed",
  "sending",
  "completed",
  "failed",
  "uncertain",
  "superseded",
]);
export const recapFailureDetailsSchema = z.object({
  http_status: z.number().int().min(100).max(599).optional(),
  provider_code: z.string().regex(/^[a-z0-9_]{1,80}$/).optional(),
  request_id: text(200).optional(),
  retry_after_seconds: z.number().int().min(0).max(86400).optional(),
}).strict();
export const recapAttemptSchema = z.object({
  id: uuid,
  job_id: uuid,
  actor_id: uuid,
  model: z.literal("gpt-6-luna"),
  state: recapAttemptStateSchema,
  intent: storedIntentSchema,
  lease_until: timestamp,
  result_hash: hash.nullable(),
  error_code: z.string().regex(/^[a-z][a-z0-9_]{0,79}$/).nullable(),
  failure_details: recapFailureDetailsSchema.nullable(),
  provider_request_id: text(200).nullable(),
  created_at: timestamp,
  finished_at: timestamp.nullable(),
}).strict().refine(
  (v) => v.id !== v.intent.retry_of,
  "Attempt cannot retry itself.",
);
const reasonArray = z.array(z.enum(RECAP_REASONS)).max(6).refine(
  (v) => ordered(v.map((r) => String(RECAP_REASONS.indexOf(r)))),
  "Unique canonical source reasons required.",
);
export const recapCurrentSchema = z.object({
  source_status: z.enum(["current", "stale", "unavailable"]),
  reasons: reasonArray,
}).strict().refine((v) =>
  v.source_status === "current"
    ? v.reasons.length === 0
    : v.source_status === "unavailable"
    ? v.reasons.includes("source_unavailable")
    : v.reasons.length > 0 && !v.reasons.includes("source_unavailable")
);
export const recapJobSchema = z.object({
  id: uuid,
  actor_id: uuid,
  pet_id: uuid,
  policy_version: version,
  manifest_id: uuid,
  manifest_sha256: hash,
  previous_job_id: uuid.nullable(),
  source_note: nonblank(1000),
  created_at: timestamp,
  output_id: uuid.nullable(),
  review_version: z.union([z.literal(1), z.literal(2)]),
  attempts: z.array(recapAttemptSchema).max(6),
}).strict().superRefine((v, c) => {
  if (
    new Set(v.attempts.map((a) => a.id)).size !== v.attempts.length ||
    v.attempts.some((a, i) =>
      a.actor_id !== v.actor_id || a.job_id !== v.id ||
      a.intent.job_id !== v.id ||
      a.intent.retry_of !== (v.attempts[i + 1]?.id ?? null)
    )
  ) issue(c, "Serialized retry ancestry differs.");
  if (
    v.output_id !== null &&
    (v.attempts[0]?.id !== v.output_id || v.attempts[0]?.state !== "completed")
  ) issue(c, "Completed output attempt differs.");
  if (v.previous_job_id === v.id) issue(c, "Recap cannot precede itself.");
});
export const recapCitationSchema = z.object({
  source_ref: sourceBase.shape.ref,
  field_path: z.enum([
    "fields.subjective",
    "fields.objective",
    "fields.assessment",
    "fields.plan",
    "fields.content",
    "fields.title",
    "fields.notes",
    "fields.status",
    "fields.importance",
    "fields.onset_date",
  ]),
  quote: nonblank(1000),
}).strict();
export const recapClaimSchema = z.object({
  claim_id: z.string().regex(/^claim_0(?:0[1-9]|[1-3][0-9]|4[0-8])$/),
  category: z.enum([
    "history",
    "problem_status",
    "medication_vaccine_mention",
    "conflict",
  ]),
  temporal_status: z.enum([
    "historical",
    "recorded_status_as_of_capture",
    "uncertain",
  ]),
  text: nonblank(500),
  uncertainty: text(500),
  citations: z.array(recapCitationSchema).min(1).max(4),
}).strict();
export const recapPayloadSchema = z.object({
  claims: z.array(recapClaimSchema).min(1).max(48),
  review_flags: z.array(nonblank(500)).max(10),
}).strict().superRefine((v, c) => {
  if (
    v.claims.some((claim, i) =>
      claim.claim_id !== `claim_${String(i + 1).padStart(3, "0")}` ||
      (claim.temporal_status === "uncertain"
        ? !claim.uncertainty.trim()
        : claim.uncertainty !== "")
    )
  ) issue(c, "Claim identity or uncertainty differs.");
});
export function validateRecapPayload(value: unknown, manifestValue: unknown) {
  const payload = recapPayloadSchema.parse(value),
    manifest = recapManifestSchema.parse(manifestValue);
  for (const claim of payload.claims) {
    let statusEvidence = false;
    for (const citation of claim.citations) {
      const source = manifest.source_set.sources.find((s) =>
        s.ref === citation.source_ref
      );
      const field = citation.field_path.slice(7);
      if (!source || !Object.prototype.hasOwnProperty.call(source.fields, field)) {
        throw Error("Citation source/path outside immutable manifest.");
      }
      const quoted = (source.fields as Record<string, unknown>)[field];
      if (typeof quoted !== "string" || !quoted.includes(citation.quote)) {
        throw Error("Citation lacks an exact source-field excerpt.");
      }
      if (source.kind === "native_problem" && field === "status") {
        statusEvidence = true;
      }
    }
    if (
      claim.temporal_status === "recorded_status_as_of_capture" &&
      !statusEvidence
    ) throw Error("Recorded status requires native problem status evidence.");
  }
  return payload;
}
// This is a generation coverage check, not a semantic-entailment validator.
// Historical v1 output remains readable through validateRecapPayload above.
export function recapRequiredProblemEvidence(manifestValue: unknown) {
  const manifest = recapManifestSchema.parse(manifestValue);
  return manifest.source_set.sources.flatMap((source) => {
    if (source.kind !== "native_problem") return [];
    return (["title", "status", "importance", "onset_date"] as const).flatMap(
      (field) => {
        const value = source.fields[field];
        return value === null || !value.trim() ? [] : [
          {
            source_ref: source.ref,
            field_path: `fields.${field}` as const,
            value,
          },
        ];
      },
    );
  });
}
export function validateGeneratedRecapCoverage(
  value: unknown,
  manifestValue: unknown,
) {
  const payload = validateRecapPayload(value, manifestValue);
  const citations = payload.claims.flatMap((claim) => claim.citations);
  for (const required of recapRequiredProblemEvidence(manifestValue)) {
    if (
      !citations.some(
        (citation) =>
          citation.source_ref === required.source_ref &&
          citation.field_path === required.field_path &&
          (required.field_path === "fields.title" ||
            citation.quote === required.value),
      )
    ) {
      throw Error("Generated recap lacks required native problem evidence.");
    }
  }
  return payload;
}
export const recapResultSchema = z.object({
  request_id: text(200),
  response_id: nonblank(200),
  provider_model: text(200),
  contract_version: z.literal(RECAP_CONTRACT),
  prompt_version: z.enum(RECAP_PROMPT_VERSIONS),
  manifest_sha256: hash,
  language_context: audioLanguageContextSchema,
  payload: recapPayloadSchema,
}).strict();
export const recapOutputSchema = z.object({
  id: uuid,
  job_id: uuid,
  manifest_sha256: hash,
  payload: recapPayloadSchema,
  payload_sha256: hash,
  provider_manifest: recapResultSchema.omit({ payload: true }),
  created_at: timestamp,
}).strict().refine((v) =>
  v.manifest_sha256 === v.provider_manifest.manifest_sha256
);
const reviewedClaimSchema = recapClaimSchema.omit({ text: true }).extend({
  proposed_text: nonblank(500),
  reviewed_text: nonblank(500),
}).strict();
export const recapReviewSchema = z.object({
  id: uuid,
  job_id: uuid,
  output_id: uuid,
  reviewer_id: uuid,
  decision: z.enum(["accepted", "rejected"]),
  accepted_claims: z.array(reviewedClaimSchema).max(48),
  review_note: text(2000),
  manifest_sha256: hash,
  output_sha256: hash,
  version: z.literal(2),
  created_at: timestamp,
}).strict().refine((v) =>
  v.decision === "accepted"
    ? v.accepted_claims.length > 0
    : v.accepted_claims.length === 0 && !!v.review_note.trim()
);
export const recapReviewRequestSchema = z.object({
  job_id: uuid,
  output_id: uuid,
  expected_output_hash: hash,
  expected_review_version: z.literal(1),
  manifest_sha256: hash,
  decision: z.enum(["accepted", "rejected"]),
  accepted_claims: z.array(
    z.object({ claim_id: recapClaimSchema.shape.claim_id, text: nonblank(500) })
      .strict(),
  ).max(48),
  review_note: text(2000),
  attest_reviewed: z.literal(true),
}).strict().refine((v) =>
  (v.decision === "accepted"
    ? v.accepted_claims.length > 0
    : v.accepted_claims.length === 0 && !!v.review_note.trim()) &&
  new Set(v.accepted_claims.map((c) => c.claim_id)).size ===
    v.accepted_claims.length
);
export const recapReceiptSchema = z.object({
  id: uuid,
  actor_id: uuid,
  job_id: uuid,
  request_hash: hash,
  review: recapReviewSchema,
}).strict().refine((v) =>
  v.id === v.review.id && v.actor_id === v.review.reviewer_id &&
  v.job_id === v.review.job_id
);
export const recapJobReadSchema = z.object({
  actor_id: uuid,
  job: recapJobSchema,
  manifest: recapManifestSchema,
  policy: recapPolicySchema,
  current: recapCurrentSchema,
  output: recapOutputSchema.nullable(),
  review: recapReviewSchema.nullable(),
}).strict().superRefine((v, c) => {
  if (
    v.job.pet_id !== v.manifest.source_set.patient.id ||
    v.job.manifest_id !== v.manifest.id ||
    v.job.manifest_sha256 !== v.manifest.sha256
  ) issue(c, "Job manifest binding differs.");
  if (
    v.job.output_id !== (v.output?.id ?? null) ||
    v.output &&
      (v.output.job_id !== v.job.id ||
        v.output.manifest_sha256 !== v.manifest.sha256)
  ) issue(c, "Output binding differs.");
  if (v.output) {
    try {
      validateRecapPayload(v.output.payload, v.manifest);
    } catch {
      issue(c, "Retained output evidence differs.");
    }
  }
  if (
    v.job.review_version !== (v.review ? 2 : 1) ||
    v.review &&
      (!v.output || v.review.job_id !== v.job.id ||
        v.review.output_id !== v.output.id ||
        v.review.manifest_sha256 !== v.manifest.sha256 ||
        v.review.output_sha256 !== v.output.payload_sha256)
  ) issue(c, "Review binding differs.");
  if (v.review && v.output) {
    const ids = v.review.accepted_claims.map((r) => r.claim_id),
      originals = v.output.payload.claims.filter((original) =>
        ids.includes(original.claim_id)
      );
    if (
      originals.length !== ids.length || !same(
        originals.map((o) => o.claim_id),
        ids,
      ) || v.review.accepted_claims.some((reviewed, i) => {
        const original = originals[i];
        return !original || reviewed.proposed_text !== original.text ||
          reviewed.category !== original.category ||
          reviewed.temporal_status !== original.temporal_status ||
          reviewed.uncertainty !== original.uncertainty ||
          !same(reviewed.citations, original.citations);
      })
    ) issue(c, "Reviewed provenance differs from the original output.");
  }
});
export const recapCitationReadSchema = z.object({
  actor_id: uuid,
  pet_id: uuid,
  job_id: uuid,
  manifest_id: uuid,
  manifest_sha256: hash,
  source_ref: sourceBase.shape.ref,
  source: recapSourceSchema,
  current: recapCurrentSchema,
}).strict().refine((v) =>
  v.source.ref === v.source_ref && v.source.pet_id === v.pet_id
);
export const recapDiscoverySchema = z.object({
  actor_id: uuid,
  pet_id: uuid,
  encounters: z.array(
    z.object({
      id: uuid,
      version,
      visit_at: timestamp,
      signed_at: timestamp,
      addendum_count: count,
    }).strict(),
  ).max(20),
  native_problem_count: count,
  outside_linked_problem_count: count,
  has_more: z.boolean(),
  next: z.object({ visit_at: timestamp, id: uuid }).strict().nullable(),
}).strict().refine((v) =>
  v.has_more
    ? !!v.encounters.length && v.next?.id === v.encounters.at(-1)?.id &&
      v.next?.visit_at === v.encounters.at(-1)?.visit_at
    : v.next === null
);
export const recapHistorySchema = z.object({
  actor_id: uuid,
  pet_id: uuid,
  items: z.array(
    z.object({
      id: uuid,
      actor_id: uuid,
      pet_id: uuid,
      policy_version: version,
      manifest_id: uuid,
      manifest_sha256: hash,
      created_at: timestamp,
      captured_at: timestamp,
      previous_job_id: uuid.nullable(),
      selection: recapSelectionSchema,
      budgets: recapBudgetsSchema,
      output_id: uuid.nullable(),
      review_version: z.union([z.literal(1), z.literal(2)]),
      review_decision: z.enum(["accepted", "rejected"]).nullable(),
      reviewer_id: uuid.nullable(),
      reviewed_at: timestamp.nullable(),
      latest_attempt: z.object({
        id: uuid,
        state: recapAttemptStateSchema,
        created_at: timestamp,
      }).strict().nullable(),
    }).strict(),
  ).max(20),
  has_more: z.boolean(),
  next: z.object({ created_at: timestamp, id: uuid }).strict().nullable(),
}).strict().superRefine((v, c) => {
  if (
    v.items.some((item, i) =>
      item.pet_id !== v.pet_id || (item.review_version === 1
        ? item.review_decision !== null || item.reviewer_id !== null ||
          item.reviewed_at !== null
        : item.review_decision === null || item.reviewer_id === null ||
          item.reviewed_at === null) ||
      i > 0 &&
        (v.items[i - 1].created_at < item.created_at ||
          v.items[i - 1].created_at === item.created_at &&
            v.items[i - 1].id <= item.id)
    )
  ) issue(c, "History patient/order/review differs.");
  if (
    v.has_more
      ? !v.items.length || v.next?.id !== v.items.at(-1)?.id ||
        v.next?.created_at !== v.items.at(-1)?.created_at
      : v.next !== null
  ) issue(c, "History cursor differs.");
});
export const RECAP_REFUSAL_CODES = [
  "invalid_request",
  "authentication_required",
  "forbidden",
  "not_found",
  "operation_unavailable",
  "policy_unapproved",
  "policy_changed",
  "source_changed",
  "source_unavailable",
  "empty_selection",
  "budget_exceeded",
  "identity_conflict",
  "intent_conflict",
  "action_cancelled",
  "review_conflict",
  "attempt_active",
  "retry_not_allowed",
  "processing_disabled",
  "rate_limited",
  "provider_rejected",
  "provider_unavailable",
  "provider_uncertain",
  "invalid_provider_output",
] as const;
const dimensions = [
  "encounters",
  "problems",
  "source_units",
  "source_characters",
  "source_bytes",
] as const;
export const recapRefusalSchema = z.object({
  code: z.enum(RECAP_REFUSAL_CODES),
  source_reasons: reasonArray,
  budget_violations: z.array(
    z.object({
      dimension: z.enum(dimensions),
      observed: count,
      limit: count.min(1),
    }).strict(),
  ).max(5),
  retry_after_seconds: z.number().int().min(0).max(86400).nullable(),
}).strict().superRefine((v, c) => {
  if (
    v.code === "budget_exceeded"
      ? v.budget_violations.length === 0
      : v.budget_violations.length !== 0
  ) issue(c, "Budget refusal shape differs.");
  if (
    !ordered(
      v.budget_violations.map((b) => String(dimensions.indexOf(b.dimension))),
    ) || v.budget_violations.some((b) =>
      b.limit !== RECAP_LIMITS[b.dimension] || b.observed <= b.limit
    )
  ) issue(c, "Budget refusal dimensions differ.");
  if (
    v.code === "source_changed"
      ? v.source_reasons.includes("source_unavailable")
      : v.code === "source_unavailable"
      ? !v.source_reasons.includes("source_unavailable")
      : v.source_reasons.length !== 0
  ) issue(c, "Source refusal reasons differ.");
});
export function recapRefusal(
  code: z.infer<typeof recapRefusalSchema>["code"],
  options: Partial<z.infer<typeof recapRefusalSchema>> = {},
) {
  return recapRefusalSchema.parse({
    code,
    source_reasons: [],
    budget_violations: [],
    retry_after_seconds: null,
    ...options,
  });
}
const sqlCodes: Record<string, readonly string[]> = {
  PT401: ["authentication_required"],
  PT403: ["forbidden", "policy_unapproved"],
  PT404: ["not_found"],
  PT422: ["invalid_request", "empty_selection", "budget_exceeded"],
  PT409: [
    "policy_changed",
    "source_changed",
    "source_unavailable",
    "identity_conflict",
    "intent_conflict",
    "action_cancelled",
    "review_conflict",
    "attempt_active",
    "retry_not_allowed",
  ],
  PT429: ["rate_limited"],
  PT503: ["operation_unavailable"],
};
export function normalizeRecapRefusal(
  value: unknown,
): z.infer<typeof recapRefusalSchema> {
  const direct = recapRefusalSchema.safeParse(value);
  if (direct.success) return direct.data;
  if (value && typeof value === "object") {
    const raw = value as Record<string, unknown>;
    const edge = recapRefusalSchema.safeParse(raw.error);
    if (edge.success) return edge.data;
    if (
      typeof raw.code === "string" && typeof raw.details === "string" &&
      raw.details.length <= 10000
    ) {
      try {
        const parsed = recapRefusalSchema.parse(JSON.parse(raw.details));
        if (sqlCodes[raw.code]?.includes(parsed.code)) return parsed;
      } catch { /* Unknown errors never become source-bearing messages. */ }
    }
  }
  return recapRefusal("operation_unavailable");
}
export function recapRefusalStatus(value: z.infer<typeof recapRefusalSchema>) {
  if (value.code === "authentication_required") return 401;
  if (["forbidden", "policy_unapproved"].includes(value.code)) return 403;
  if (value.code === "not_found") return 404;
  if (
    ["invalid_request", "empty_selection", "budget_exceeded"].includes(
      value.code,
    )
  ) return 422;
  if (value.code === "rate_limited") return 429;
  if (value.code === "provider_uncertain") return 504;
  if (["provider_rejected", "invalid_provider_output"].includes(value.code)) {
    return 502;
  }
  if (
    ["operation_unavailable", "processing_disabled", "provider_unavailable"]
      .includes(value.code)
  ) return 503;
  return 409;
}

export const recapFinishReceiptSchema = z.object({
  job_id: uuid,
  attempt_id: uuid,
  retained: z.boolean(),
  outcome: z.enum(["completed", "policy_changed", "forbidden"]),
}).strict().refine(
  (v) => v.retained === (v.outcome === "completed"),
  "Finish retention outcome differs.",
);
