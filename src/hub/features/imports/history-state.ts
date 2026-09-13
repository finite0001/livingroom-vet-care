import { z } from "zod";
export const historyId = z.string().uuid();
export const historyHash = z.string().regex(/^[a-f0-9]{64}$/);
export const historyTimestamp = z
  .string()
  .refine((v) => Number.isFinite(Date.parse(v)), "Invalid review timestamp");
export const historyKind = z.enum([
  "history_approval",
  "problem_extraction",
  "discrepancy_review",
]);
export type HistoryRequestKind = z.infer<typeof historyKind>;
const positive = z.number().int().positive();
export const sourceApprovalPayload = z
  .object({
    animal_link_id: historyId,
    snapshot_id: historyId,
    payload_hash: historyHash,
    observed_head_version: positive,
    patient_version: positive,
    consult_mode: z.enum(["not_referenced", "unresolved", "verified"]),
    consult_snapshot_id: historyId.nullable(),
    consult_payload_hash: historyHash.nullable(),
    consult_head_version: positive.nullable(),
    reason: z.string().trim().min(5).max(2000),
  })
  .strict()
  .superRefine((v, c) => {
    if (
      v.consult_mode === "verified"
        ? !v.consult_snapshot_id ||
          !v.consult_payload_hash ||
          !v.consult_head_version
        : v.consult_snapshot_id !== null ||
          v.consult_payload_hash !== null ||
          v.consult_head_version !== null
    )
      c.addIssue({ code: "custom", message: "Consult review binding differs" });
  });
export type SourceApprovalPayload = z.infer<typeof sourceApprovalPayload>;
export const localProblemFields = z
  .object({
    title: z.string().min(1).max(250),
    notes: z.string().max(10000),
    onset_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    status: z.enum(["active", "resolved"]),
    importance: z.enum(["routine", "high"]),
  })
  .strict();
export const extractionPayload = z
  .object({
    sources: z
      .array(z.object({ id: historyId, version_hash: historyHash }).strict())
      .min(1)
      .max(20),
    patient_version: positive,
    action: z.enum(["create", "link"]),
    problem_id: historyId.nullable(),
    problem_version: positive.nullable(),
    fields: localProblemFields,
    duplicate_decision: z.enum(["distinct_finding", "link_existing"]),
    reason: z.string().trim().min(5).max(2000),
  })
  .strict()
  .superRefine((v, c) => {
    if (
      v.action === "link"
        ? !v.problem_id ||
          !v.problem_version ||
          v.duplicate_decision !== "link_existing"
        : v.problem_id !== null ||
          v.problem_version !== null ||
          v.duplicate_decision !== "distinct_finding"
    )
      c.addIssue({
        code: "custom",
        message: "Duplicate decision or target differs",
      });
    if (new Set(v.sources.map((s) => s.id)).size !== v.sources.length)
      c.addIssue({ code: "custom", message: "Duplicate source version" });
  });
export type ExtractionPayload = z.infer<typeof extractionPayload>;
export type HistoryPayload =
  | SourceApprovalPayload
  | ExtractionPayload
  | z.infer<typeof discrepancyPayload>;
export const sourceIdentity = z.object({
  origin: z.string(),
  site_uid: z.string(),
  animal_id: z.string(),
  history_id: z.string(),
});
export const sourceOriginal = z.object({
  comments: z.unknown(),
  history_system: z.unknown(),
  chain: z.unknown(),
  timestamp: z.unknown(),
  vet_id: z.unknown(),
  active: z.unknown(),
  consult_id: z.unknown(),
});
export const consultProof = z.object({
  status: z.enum(["not_referenced", "unresolved", "verified"]),
  snapshot_id: historyId.optional(),
  payload_hash: historyHash.optional(),
  observed_head_version: positive.optional(),
  external_id: z.string().optional(),
});
export const compactHistory = z.object({
  id: historyId,
  version: positive,
  version_hash: historyHash,
  source: sourceIdentity,
  snapshot_id: historyId,
  payload_hash: historyHash,
  observed_head_version: positive,
  approved_by: historyId,
  approved_at: historyTimestamp,
});
export const importedHistory = compactHistory.extend({
  pet_id: historyId,
  animal_link_id: historyId,
  original: sourceOriginal,
  consult: consultProof,
  current: z.object({
    snapshot_id: historyId,
    head_version: positive,
    scoped: z.boolean(),
    is_current: z.boolean(),
    source_active: z.unknown(),
  }),
});
export type ImportedHistory = z.infer<typeof importedHistory>;
export const discrepancyReview = z.object({
  id: historyId,
  reviewed_by: historyId,
  reviewed_at: historyTimestamp,
  source_heads: z
    .array(
      z.object({
        history_id: historyId,
        snapshot_id: historyId,
        head_version: positive,
      }),
    )
    .max(20),
  sources: z.array(compactHistory).max(20),
});
export const problemExtraction = z.object({
  id: historyId,
  problem_id: historyId,
  action: z.enum(["create", "link"]),
  problem_version: positive,
  problem_fields: localProblemFields,
  extracted_by: historyId,
  extracted_at: historyTimestamp,
  sources: z.array(compactHistory).min(1).max(20),
  current_problem_version: positive,
  locally_edited: z.boolean(),
  discrepancy: z.object({
    required: z.boolean(),
    reviewed: z.boolean(),
    changed_from_original: z.boolean(),
    review_history: z.array(discrepancyReview),
  }),
});
export type ProblemExtraction = z.infer<typeof problemExtraction>;
export const problemRow = localProblemFields
  .extend({
    id: historyId,
    pet_id: historyId,
    version: positive,
  })
  .strip();
export type ProblemRow = z.infer<typeof problemRow>;
export const discrepancyPayload = z
  .object({
    extraction_id: historyId,
    reviewed_sources: z
      .array(
        z
          .object({
            original_history_id: historyId,
            reviewed_history_id: historyId,
            version_hash: historyHash,
          })
          .strict(),
      )
      .min(1)
      .max(20),
    reason: z.string().trim().min(5).max(2000),
  })
  .strict()
  .superRefine((v, c) => {
    if (
      new Set(v.reviewed_sources.map((s) => s.original_history_id)).size !==
        v.reviewed_sources.length ||
      new Set(v.reviewed_sources.map((s) => s.reviewed_history_id)).size !==
        v.reviewed_sources.length
    )
      c.addIssue({ code: "custom", message: "Duplicate discrepancy source" });
  });
export const reviewContext = z.object({
  history_source: z
    .object({
      source: sourceIdentity,
      snapshot_id: historyId,
      payload_hash: historyHash,
      observed_head_version: positive,
      original: sourceOriginal,
      consult: consultProof,
    })
    .nullable(),
  histories: z.array(importedHistory).max(20),
  problem: problemRow.nullable(),
  extraction: problemExtraction.nullable(),
});
export type ReviewContext = z.infer<typeof reviewContext>;
export const requestSchema = z.object({
  id: historyId,
  actor_id: historyId,
  pet_id: historyId,
  kind: historyKind,
  status: z.enum(["prepared", "approved", "abandoned"]),
  request_hash: historyHash.nullable(),
  payload: z.record(z.unknown()).nullable(),
  created_at: historyTimestamp,
  resolved_at: historyTimestamp.nullable(),
  review_context: reviewContext.nullable(),
});
export interface HistoryRequestEnvelope {
  request: z.infer<typeof requestSchema>;
  receipt: Record<string, unknown> | null;
}
export function parseHistoryRequest(
  value: unknown,
  actor: string,
  petId: string,
  kind: HistoryRequestKind,
  id?: string,
): HistoryRequestEnvelope | null {
  if (value === null) return null;
  const e = z
      .object({
        request: requestSchema,
        receipt: z.record(z.unknown()).nullable(),
      })
      .parse(value),
    r = e.request;
  if (
    r.actor_id !== actor ||
    r.pet_id !== petId ||
    r.kind !== kind ||
    (id && r.id !== id)
  )
    throw new Error(
      "Saved review identity differs. Original request retained.",
    );
  if (r.status !== "abandoned" && (!r.payload || !r.request_hash))
    throw new Error("Frozen review payload is missing");
  if (r.payload)
    (kind === "history_approval"
      ? sourceApprovalPayload
      : kind === "problem_extraction"
        ? extractionPayload
        : discrepancyPayload
    ).parse(r.payload);
  if (
    (r.status === "approved") !== !!e.receipt ||
    (r.status === "prepared" ? r.resolved_at !== null : r.resolved_at === null)
  )
    throw new Error("Saved review status is inconsistent");
  if (r.status !== "abandoned" && !r.review_context)
    throw new Error("Frozen source review context is missing");
  if (r.review_context && r.payload) {
    const c = r.review_context;
    if (kind === "history_approval") {
      const p = sourceApprovalPayload.parse(r.payload),
        h = c.history_source;
      if (
        !h ||
        h.snapshot_id !== p.snapshot_id ||
        h.payload_hash !== p.payload_hash ||
        h.observed_head_version !== p.observed_head_version ||
        h.consult.status !== p.consult_mode ||
        c.histories.length ||
        c.problem ||
        c.extraction
      )
        throw new Error("Frozen source approval evidence differs");
      if (
        p.consult_mode === "verified" &&
        (h.consult.snapshot_id !== p.consult_snapshot_id ||
          h.consult.payload_hash !== p.consult_payload_hash ||
          h.consult.observed_head_version !== p.consult_head_version)
      )
        throw new Error("Frozen consult evidence differs");
    } else if (kind === "problem_extraction") {
      const p = extractionPayload.parse(r.payload);
      if (
        c.history_source ||
        c.extraction ||
        c.histories.length !== p.sources.length ||
        p.sources.some(
          (s) =>
            !c.histories.some(
              (h) =>
                h.id === s.id &&
                h.version_hash === s.version_hash &&
                h.pet_id === petId,
            ),
        )
      )
        throw new Error("Frozen extraction source evidence differs");
      if (
        p.action === "link"
          ? !c.problem ||
            c.problem.id !== p.problem_id ||
            c.problem.version !== p.problem_version ||
            c.problem.pet_id !== petId ||
            !equalHistoryPayload(p.fields, {
              title: c.problem.title,
              notes: c.problem.notes,
              onset_date: c.problem.onset_date,
              status: c.problem.status,
              importance: c.problem.importance,
            })
          : c.problem !== null
      )
        throw new Error("Frozen target problem differs");
    } else {
      const p = discrepancyPayload.parse(r.payload);
      if (
        !c.extraction ||
        c.extraction.id !== p.extraction_id ||
        c.histories.length !== p.reviewed_sources.length ||
        c.extraction.sources.length !== p.reviewed_sources.length ||
        c.extraction.sources.some((old) => {
          const ref = p.reviewed_sources.find(
            (s) => s.original_history_id === old.id,
          );
          const fresh = c.histories.find(
            (h) => h.id === ref?.reviewed_history_id,
          );
          return !fresh || !equalHistoryPayload(old.source, fresh.source);
        }) ||
        p.reviewed_sources.some(
          (s) =>
            !c.histories.some(
              (h) =>
                h.id === s.reviewed_history_id &&
                h.version_hash === s.version_hash &&
                h.pet_id === petId,
            ),
        )
      )
        throw new Error("Frozen discrepancy evidence differs");
    }
  }
  if (e.receipt) {
    const receipt = (
      kind === "history_approval"
        ? importedHistory
        : kind === "problem_extraction"
          ? problemExtraction
          : discrepancyReview
    ).parse(e.receipt);
    const reviewer =
      kind === "history_approval"
        ? e.receipt.approved_by
        : kind === "problem_extraction"
          ? e.receipt.extracted_by
          : e.receipt.reviewed_by;
    if (reviewer !== actor || receipt.id !== r.id)
      throw new Error("Saved receipt differs from the original request");
  }
  return { request: e.request, receipt: e.receipt };
}
export function equalHistoryPayload(left: unknown, right: unknown): boolean {
  const canonical = (v: unknown): string =>
    Array.isArray(v)
      ? `[${v.map(canonical).join(",")}]`
      : v && typeof v === "object"
        ? `{${Object.entries(v)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`)
            .join(",")}}`
        : JSON.stringify(v);
  return canonical(left) === canonical(right);
}
export const historyCursor = z.object({
  before_at: historyTimestamp,
  before_id: historyId,
});
export type HistoryCursor = z.infer<typeof historyCursor>;
