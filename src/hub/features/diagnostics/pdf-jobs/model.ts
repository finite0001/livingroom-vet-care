import { z } from "zod";
import { finalizedSchema } from "../model.ts";
const uuid = z.string().uuid(),
  hash = z.string().regex(/^[a-f0-9]{64}$/),
  instant = z.string().datetime({ offset: true }),
  positive = z.number().int().positive();
export const pdfSnapshotSchema = z
  .object({
    schema: z.literal(1),
    purpose: z.literal("diagnostic_result"),
    diagnostic: finalizedSchema,
    patient: z
      .object({
        id: uuid,
        name: z.string(),
        species: z.string(),
        breed: z.string().nullable(),
        dob: z.string().nullable(),
        birth_date_precision: z.string(),
        microchip_id: z.string().nullable(),
      })
      .strict(),
  })
  .strict()
  .superRefine((s, ctx) => {
    if (s.diagnostic.pet_id !== s.patient.id)
      ctx.addIssue({ code: "custom", message: "PDF snapshot patient differs" });
  });
export const captureMetadataSchema = z
  .object({
    job_id: uuid,
    pet_id: uuid,
    claim_id: uuid,
    fence: positive,
    actor_id: uuid,
    source_hash: hash,
    snapshot_hash: hash,
    renderer_sha: hash,
    settings_sha: hash,
    byte_length: positive.max(3145728),
    sha256: hash,
    validation_status: z.literal("not_validated"),
    storage_status: z.literal("not_uploaded"),
    export_eligible: z.literal(false),
  })
  .strict();
export const pdfJobSchema = z
  .object({
    id: uuid,
    panel_id: uuid,
    pet_id: uuid,
    source_hash: hash,
    snapshot: pdfSnapshotSchema,
    snapshot_hash: hash,
    requested_by: uuid,
    created_by: uuid,
    updated_by: uuid,
    status: z.enum(["pending", "claimed", "failed", "captured_unverified"]),
    version: positive,
    fence: z.number().int().nonnegative(),
    claim_id: uuid.nullable(),
    lease_until: instant.nullable(),
    renderer_sha: hash.nullable(),
    settings_sha: hash.nullable(),
    last_error: z.string().max(2000),
    created_at: instant,
    updated_at: instant,
  })
  .strict()
  .superRefine((j, ctx) => {
    if (
      j.id !== j.snapshot.diagnostic.id ||
      j.panel_id !== j.snapshot.diagnostic.panel_id ||
      j.pet_id !== j.snapshot.patient.id ||
      j.source_hash !== j.snapshot.diagnostic.source_hash ||
      (j.status === "claimed") !==
        (j.claim_id !== null && j.lease_until !== null) ||
      (j.claim_id === null) !== (j.lease_until === null) ||
      (j.status === "claimed" && (j.fence < 1 || j.renderer_sha === null)) ||
      (j.renderer_sha === null) !== (j.settings_sha === null)
    )
      ctx.addIssue({ code: "custom", message: "PDF job binding differs" });
  });
export const pdfJobDetailSchema = z
  .object({
    job: pdfJobSchema,
    capture: captureMetadataSchema.nullable(),
    worker_configured: z.boolean(),
    owner_active: z.boolean(),
    pdf_status: z.literal("not_available"),
    export_eligible: z.literal(false),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (
      (d.job.status === "captured_unverified") !== (d.capture !== null) ||
      (d.capture &&
        (d.capture.job_id !== d.job.id ||
          d.capture.pet_id !== d.job.pet_id ||
          d.capture.source_hash !== d.job.source_hash ||
          d.capture.snapshot_hash !== d.job.snapshot_hash ||
          d.capture.renderer_sha !== d.job.renderer_sha ||
          d.capture.settings_sha !== d.job.settings_sha ||
          d.capture.fence !== d.job.fence))
    )
      ctx.addIssue({ code: "custom", message: "PDF capture binding differs" });
  });
export const pdfClaimSchema = z
  .object({
    job_id: uuid,
    pet_id: uuid,
    claim_id: uuid,
    fence: positive,
    actor_id: uuid,
    lease_until: instant,
    source_hash: hash,
    snapshot_hash: hash,
    renderer_sha: hash,
    settings_sha: hash,
  })
  .strict();
export const pdfClaimContextSchema = z
  .object({ claim: pdfClaimSchema, snapshot: pdfSnapshotSchema })
  .strict()
  .superRefine((c, ctx) => {
    if (
      c.claim.job_id !== c.snapshot.diagnostic.id ||
      c.claim.pet_id !== c.snapshot.patient.id ||
      c.claim.source_hash !== c.snapshot.diagnostic.source_hash
    )
      ctx.addIssue({ code: "custom", message: "Claim source differs" });
  });
export const pdfCaptureSchema = z
  .object({
    metadata: captureMetadataSchema,
    base64: z
      .string()
      .max(4194304)
      .regex(/^[A-Za-z0-9+/]*={0,2}$/),
  })
  .strict()
  .superRefine((capture, ctx) => {
    try {
      const bytes = atob(capture.base64);
      if (
        btoa(bytes) !== capture.base64 ||
        bytes.length !== capture.metadata.byte_length
      )
        ctx.addIssue({
          code: "custom",
          message: "Captured byte encoding or length differs",
        });
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "Captured byte encoding is invalid",
      });
    }
  });
export const pdfRequestSchema = z
  .object({ action_id: uuid, id: uuid, pet_id: uuid, source_hash: hash })
  .strict();
export const pdfRetrySchema = z
  .object({
    action_id: uuid,
    id: uuid,
    pet_id: uuid,
    expected_version: positive,
    reason: z.string().trim().min(1).max(2000),
  })
  .strict();
export interface PdfJobDetail extends z.infer<typeof pdfJobDetailSchema> {}
export interface PdfClaim extends z.infer<typeof pdfClaimSchema> {}
export interface PdfCapture extends z.infer<typeof pdfCaptureSchema> {}
