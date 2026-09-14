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
const parentSchema = z
  .object({
    animal_link_id: uuid,
    pet_id: uuid,
    client_id: uuid,
    animal_external_id: sourceId,
    source_origin: z.string().url(),
    source_site_uid: z.string(),
    parent_type: z.literal("Animal"),
    parent_external_id: sourceId,
    parent_snapshot_id: uuid,
    parent_payload_hash: hash,
    parent_observed_head_version: z.number().int().positive(),
  })
  .strict();
export const captureIntentSchema = z
  .object({
    p_id: uuid,
    p_animal_link_id: uuid,
    p_run_id: uuid,
    p_page: z.number().int().positive(),
    p_ordinal: z.number().int().min(1).max(10),
    p_snapshot_id: uuid,
    p_observed_head_version: z.number().int().positive(),
    p_stable_metadata_sha256: hash,
  })
  .strict();
export interface CaptureIntent extends z.infer<typeof captureIntentSchema> {}
const receiptSchema = z
  .object({
    id: uuid,
    request_id: uuid,
    entry_method: z.literal("ezyvet_api_attachment_original_v1"),
    content_sha256: hash,
    mime_type: z.enum(["application/pdf", "image/png", "image/jpeg"]),
    file_size: z
      .number()
      .int()
      .positive()
      .max(20 * 1024 * 1024),
    capture_hash: hash,
    captured_at: date,
  })
  .strict();
const captureSchema = z
  .object({
    id: uuid,
    requested_by: uuid,
    animal_link_id: uuid,
    pet_id: uuid,
    client_id: uuid,
    run_id: uuid,
    page: z.number().int().positive(),
    ordinal: z.number().int().min(1).max(10),
    snapshot_id: uuid,
    observed_head_version: z.number().int().positive(),
    external_id: sourceId,
    file_id: sourceId,
    stable_metadata_sha256: hash,
    raw_record_sha256: hash,
    metadata: metadataSchema,
    parent_context: parentSchema,
    request_hash: hash,
    status: z.enum([
      "prepared",
      "reserved",
      "ready",
      "blocked",
      "discarding",
      "abandoned",
    ]),
    source_current: z.boolean(),
    lease_active: z.boolean(),
    retry_after: date.nullable(),
    last_error_code: z
      .string()
      .regex(/^[A-Z0-9_]+$/)
      .nullable(),
    retryable: z.boolean(),
    created_at: date,
    updated_at: date,
    capture: receiptSchema.nullable(),
  })
  .strict();
export interface OriginalCapture extends z.infer<typeof captureSchema> {}
export interface CaptureScope {
  link_id: string;
  pet_id: string;
  source_origin: string;
  source_site_uid: string;
  external_id: string;
}
export const captureCursorSchema = z
  .object({ before_at: date, before_id: uuid })
  .strict();
export interface CaptureCursor extends z.infer<typeof captureCursorSchema> {}
export function validateCapture(
  value: unknown,
  actor: string,
  mapping: CaptureScope,
  expected?: CaptureIntent | string,
): OriginalCapture {
  const c = captureSchema.parse(value),
    p = c.parent_context;
  if (
    c.requested_by !== actor ||
    c.animal_link_id !== mapping.link_id ||
    c.pet_id !== mapping.pet_id ||
    p.animal_link_id !== c.animal_link_id ||
    p.pet_id !== c.pet_id ||
    p.client_id !== c.client_id ||
    p.source_origin !== mapping.source_origin ||
    p.source_site_uid !== mapping.source_site_uid ||
    p.animal_external_id !== mapping.external_id ||
    p.parent_external_id !== mapping.external_id ||
    c.metadata.id !== c.external_id ||
    c.metadata.file_id !== c.file_id ||
    c.metadata.record_id !== mapping.external_id ||
    (c.status === "ready") !== !!c.capture ||
    (c.capture && c.capture.request_id !== c.id) ||
    (c.retryable &&
      (!c.source_current || !["prepared", "reserved"].includes(c.status)))
  )
    throw new Error("Capture identity or state differs");
  if (
    typeof expected === "string"
      ? c.id !== expected
      : expected && !matchesCaptureIntent(c, expected)
  )
    throw new Error("Original capture request differs");
  return c;
}
export function intentOf(c: OriginalCapture): CaptureIntent {
  return {
    p_id: c.id,
    p_animal_link_id: c.animal_link_id,
    p_run_id: c.run_id,
    p_page: c.page,
    p_ordinal: c.ordinal,
    p_snapshot_id: c.snapshot_id,
    p_observed_head_version: c.observed_head_version,
    p_stable_metadata_sha256: c.stable_metadata_sha256,
  };
}
export function matchesCaptureIntent(
  c: OriginalCapture,
  intent: CaptureIntent,
) {
  const actual = intentOf(c);
  return Object.entries(captureIntentSchema.parse(intent)).every(
    ([key, value]) => actual[key as keyof CaptureIntent] === value,
  );
}
export function canAdvanceCapture(c: OriginalCapture, now = Date.now()) {
  return (
    c.retryable &&
    c.source_current &&
    !c.lease_active &&
    (!c.retry_after || Date.parse(c.retry_after) <= now) &&
    ["prepared", "reserved"].includes(c.status)
  );
}
export function capturePage(
  value: unknown,
  actor: string,
  mapping: CaptureScope,
) {
  const page = z
    .object({
      captures: z.array(z.unknown()).max(20),
      has_more: z.boolean(),
      next_cursor: captureCursorSchema.nullable(),
    })
    .strict()
    .parse(value);
  if (page.has_more !== !!page.next_cursor)
    throw new Error("Capture pagination differs");
  const captures = page.captures.map((v) => validateCapture(v, actor, mapping));
  const last = captures.at(-1);
  if (
    page.next_cursor &&
    (!last ||
      page.next_cursor.before_id !== last.id ||
      page.next_cursor.before_at !== last.created_at)
  )
    throw new Error("Capture cursor differs");
  return { ...page, captures };
}
const historicalMappingSchema = z
  .object({
    link_id: uuid,
    pet_id: uuid,
    patient_name: z.string(),
    household_name: z.string(),
    source_origin: z.string().url(),
    source_site_uid: z.string(),
    external_id: sourceId,
    patient_version: z.number().int().positive(),
    last_capture_at: date,
  })
  .strict();
export interface HistoricalCaptureMapping extends Required<
  z.infer<typeof historicalMappingSchema>
> {}
export function captureMappingPage(value: unknown) {
  const page = z
    .object({
      mappings: z.array(historicalMappingSchema).max(20),
      has_more: z.boolean(),
      next_cursor: captureCursorSchema.nullable(),
    })
    .strict()
    .parse(value);
  const last = page.mappings.at(-1);
  if (
    page.has_more !== !!page.next_cursor ||
    (page.next_cursor &&
      (!last ||
        last.link_id !== page.next_cursor.before_id ||
        last.last_capture_at !== page.next_cursor.before_at))
  )
    throw new Error("Capture mapping pagination differs");
  return { ...page, mappings: page.mappings as HistoricalCaptureMapping[] };
}
