import { z } from "zod";
const uuid = z.string().uuid();
const date = z.string().refine((v) => Number.isFinite(Date.parse(v)));
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const sourceId = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .refine((v) => Number.isSafeInteger(Number(v)));
const scalar = z.union([
  z.string().max(1024),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
const metadataSchema = z
  .object({
    id: sourceId,
    file_id: sourceId,
    record_type: z.literal("Animal"),
    record_id: sourceId,
    active: scalar.optional(),
    primary_image: scalar.optional(),
    created_at: z
      .union([z.string().max(1024), z.number().finite(), z.null()])
      .optional(),
    modified_at: z
      .union([z.string().max(1024), z.number().finite(), z.null()])
      .optional(),
    mime_type: z.string().max(1024).nullable().optional(),
    name: z.string().max(1024).nullable().optional(),
    notes: z.string().max(16384).nullable().optional(),
  })
  .strict();
const positive = z.number().int().positive();
const mime = z.enum(["application/pdf", "image/jpeg", "image/png"]);
const recordSchema = z
  .object({
    id: uuid,
    action_id: uuid,
    approved_by: uuid,
    approved_at: date,
    pet_id: uuid,
    client_id: uuid,
    patient_version: positive,
    animal_link_id: uuid,
    capture_id: uuid,
    capture_request_id: uuid,
    capture_hash: hash,
    request_hash: hash,
    record_hash: hash,
    source_origin: z.string().url(),
    source_site_uid: z.string(),
    source_animal_id: sourceId,
    source_attachment_id: sourceId,
    source_file_id: sourceId,
    snapshot_id: uuid,
    observed_head_version: positive,
    stable_metadata_sha256: hash,
    raw_record_sha256: hash,
    metadata: metadataSchema,
    content_sha256: hash,
    mime_type: mime,
    file_size: positive.max(20971520),
    captured_at: date,
    entry_method: z.literal("staff_reviewed_ezyvet_api_attachment_v1"),
    source_current_at_review: z.boolean(),
    previous_record_id: uuid.nullable(),
    version: positive,
    kind: z.enum(["original", "replacement"]),
    review_reason: z.string().trim().min(1).max(2000),
  })
  .strict();
const acknowledgmentSchema = z
  .object({
    id: uuid,
    action_id: uuid,
    record_id: uuid,
    pet_id: uuid,
    actor_id: uuid,
    record_hash: hash,
    capture_hash: hash,
    created_at: date,
  })
  .strict();
const withdrawalSchema = z
  .object({
    id: uuid,
    action_id: uuid,
    record_id: uuid,
    pet_id: uuid,
    actor_id: uuid,
    record_hash: hash,
    reason: z.string().trim().min(1).max(2000),
    created_at: date,
  })
  .strict();
const actionSchema = z
  .object({
    id: uuid,
    action: z.enum(["approve", "acknowledge", "withdraw"]),
    actor_id: uuid,
    pet_id: uuid,
    request_hash: hash,
    status: z.enum(["committed", "abandoned"]),
    created_at: date,
    record: recordSchema.nullable(),
    acknowledgment: acknowledgmentSchema.nullable(),
    withdrawal: withdrawalSchema.nullable(),
  })
  .strict();
const historySchema = z
  .object({
    record: recordSchema,
    latest_record_id: uuid,
    is_latest: z.boolean(),
    withdrawal: withdrawalSchema.nullable(),
    acknowledgments: z.array(acknowledgmentSchema),
  })
  .strict();
const candidateSchema = z
  .object({
    capture_id: uuid,
    capture_request_id: uuid,
    pet_id: uuid,
    client_id: uuid,
    animal_link_id: uuid,
    capture_hash: hash,
    content_sha256: hash,
    mime_type: mime,
    file_size: positive.max(20971520),
    captured_at: date,
    metadata: metadataSchema,
    source_origin: z.string().url(),
    source_site_uid: z.string(),
    source_animal_id: sourceId,
    source_attachment_id: sourceId,
    source_file_id: sourceId,
    source_current: z.boolean(),
    patient_version: positive,
    mapping_current: z.boolean(),
    latest_record: recordSchema.nullable(),
    admitted_record: recordSchema.nullable(),
  })
  .strict();
export interface ApiOriginalRecord extends Required<
  z.infer<typeof recordSchema>
> {}
export interface OriginalReviewAction extends Required<
  z.infer<typeof actionSchema>
> {}
export interface OriginalHistoryRow extends Required<
  z.infer<typeof historySchema>
> {}
export interface OriginalReviewCandidate extends Required<
  z.infer<typeof candidateSchema>
> {}
export const cursorSchema = z
  .object({ before_at: date, before_id: uuid })
  .strict();
export interface ReviewCursor extends Required<z.infer<typeof cursorSchema>> {}
const approvalArgs = z
  .object({
    p_id: uuid,
    p_pet_id: uuid,
    p_capture_id: uuid,
    p_expected_capture_hash: hash,
    p_expected_patient_version: positive,
    p_previous_record_id: uuid.nullable(),
    p_review_reason: z.string().trim().min(1).max(2000),
    p_attest: z.literal(true),
  })
  .strict();
const ackArgs = z
  .object({
    p_id: uuid,
    p_pet_id: uuid,
    p_record_id: uuid,
    p_expected_record_hash: hash,
    p_expected_capture_hash: hash,
    p_attest: z.literal(true),
  })
  .strict();
const withdrawalArgs = z
  .object({
    p_id: uuid,
    p_pet_id: uuid,
    p_record_id: uuid,
    p_expected_record_hash: hash,
    p_reason: z.string().trim().min(1).max(2000),
  })
  .strict();
const intentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("approve"), args: approvalArgs }).strict(),
  z.object({ kind: z.literal("acknowledge"), args: ackArgs }).strict(),
  z.object({ kind: z.literal("withdraw"), args: withdrawalArgs }).strict(),
]);
export interface ReviewIntent {
  kind: "approve" | "acknowledge" | "withdraw";
  args: Record<string, string | number | boolean | null>;
}
export function reviewIntent(value: unknown, pet: string): ReviewIntent {
  const v = intentSchema.parse(value);
  if (v.args.p_pet_id !== pet) throw new Error("Patient differs");
  return v as ReviewIntent;
}
function validateRecord(r: z.infer<typeof recordSchema>, pet: string) {
  if (
    r.pet_id !== pet ||
    r.metadata.id !== r.source_attachment_id ||
    r.metadata.file_id !== r.source_file_id ||
    r.metadata.record_id !== r.source_animal_id ||
    (r.kind === "original"
      ? r.version !== 1 || r.previous_record_id !== null
      : r.version < 2 || !r.previous_record_id)
  )
    throw new Error("Original record identity differs");
}
export function reviewAction(
  value: unknown,
  pet: string,
  actor: string,
  intent: ReviewIntent,
): OriginalReviewAction | null {
  if (value === null) return null;
  const a = actionSchema.parse(value),
    p = reviewIntent(intent, pet),
    args = p.args;
  if (
    a.id !== args.p_id ||
    a.pet_id !== pet ||
    a.actor_id !== actor ||
    a.action !== p.kind
  )
    throw new Error("Action identity differs");
  const present = [a.record, a.acknowledgment, a.withdrawal].filter(
    Boolean,
  ).length;
  if (a.status === "abandoned") {
    if (present) throw new Error("Abandoned result differs");
    return a as OriginalReviewAction;
  }
  if (present !== 1) throw new Error("Action result differs");
  if (p.kind === "approve") {
    const r = a.record;
    if (
      !r ||
      r.action_id !== a.id ||
      r.approved_by !== actor ||
      r.capture_id !== args.p_capture_id ||
      r.capture_hash !== args.p_expected_capture_hash ||
      r.patient_version !== args.p_expected_patient_version ||
      r.previous_record_id !== args.p_previous_record_id ||
      r.review_reason !== args.p_review_reason ||
      r.request_hash !== a.request_hash
    )
      throw new Error("Admission differs");
    validateRecord(r, pet);
  } else {
    const r = p.kind === "acknowledge" ? a.acknowledgment : a.withdrawal;
    if (
      !r ||
      r.action_id !== a.id ||
      r.pet_id !== pet ||
      r.actor_id !== actor ||
      r.record_id !== args.p_record_id ||
      r.record_hash !== args.p_expected_record_hash ||
      ("capture_hash" in r &&
        r.capture_hash !== args.p_expected_capture_hash) ||
      ("reason" in r && r.reason !== args.p_reason)
    )
      throw new Error("Review result differs");
  }
  return a as OriginalReviewAction;
}
export function historyPage(value: unknown, pet: string) {
  const page = z
    .object({
      pet_id: uuid,
      records: z.array(historySchema).max(20),
      has_more: z.boolean(),
      next_cursor: cursorSchema.nullable(),
    })
    .strict()
    .parse(value);
  if (page.pet_id !== pet || page.has_more !== !!page.next_cursor)
    throw new Error("History scope differs");
  const last = page.records.at(-1)?.record;
  if (
    page.next_cursor &&
    (!last ||
      page.next_cursor.before_id !== last.id ||
      page.next_cursor.before_at !== last.approved_at)
  )
    throw new Error("History cursor differs");
  for (const row of page.records) {
    const r = row.record;
    validateRecord(r, pet);
    if (row.is_latest !== (row.latest_record_id === r.id))
      throw new Error("History head differs");
    for (const result of [
      ...row.acknowledgments,
      ...(row.withdrawal ? [row.withdrawal] : []),
    ])
      if (
        result.record_id !== r.id ||
        result.pet_id !== pet ||
        result.record_hash !== r.record_hash ||
        ("capture_hash" in result && result.capture_hash !== r.capture_hash)
      )
        throw new Error("History review differs");
  }
  return {
    ...page,
    records: page.records as OriginalHistoryRow[],
    next_cursor: page.next_cursor as ReviewCursor | null,
  };
}
export function candidatePage(value: unknown, pet: string) {
  const page = z
    .object({
      candidates: z.array(candidateSchema).max(20),
      has_more: z.boolean(),
      next_cursor: cursorSchema.nullable(),
    })
    .strict()
    .parse(value);
  if (page.has_more !== !!page.next_cursor)
    throw new Error("Candidate cursor differs");
  const last = page.candidates.at(-1);
  if (
    page.next_cursor &&
    (!last ||
      page.next_cursor.before_id !== last.capture_id ||
      page.next_cursor.before_at !== last.captured_at)
  )
    throw new Error("Candidate cursor differs");
  for (const c of page.candidates) {
    if (
      c.pet_id !== pet ||
      c.metadata.id !== c.source_attachment_id ||
      c.metadata.file_id !== c.source_file_id ||
      c.metadata.record_id !== c.source_animal_id
    )
      throw new Error("Candidate identity differs");
    for (const r of [c.latest_record, c.admitted_record])
      if (r) {
        validateRecord(r, pet);
        if (
          r.source_origin !== c.source_origin ||
          r.source_site_uid !== c.source_site_uid ||
          r.source_animal_id !== c.source_animal_id ||
          r.source_attachment_id !== c.source_attachment_id
        )
          throw new Error("Candidate series differs");
      }
    if (
      c.admitted_record &&
      (c.admitted_record.capture_id !== c.capture_id ||
        c.admitted_record.capture_hash !== c.capture_hash)
    )
      throw new Error("Admitted capture differs");
  }
  return {
    ...page,
    candidates: page.candidates as OriginalReviewCandidate[],
    next_cursor: page.next_cursor as ReviewCursor | null,
  };
}
