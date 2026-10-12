import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  pdfClaimSchema,
  pdfCaptureSchema,
  captureMetadataSchema,
} from "../../src/hub/features/diagnostics/pdf-jobs/model.ts";
import { diagnosticRenderInput, reportSourceSchema } from "./template.ts";
import {
  bindRenderedBytes,
  renderInputSchema,
  sha256,
  type RenderInput,
  type RenderReceipt,
} from "./sandbox.ts";
const hash = z.string().regex(/^[a-f0-9]{64}$/),
  uuid = z.string().uuid();
const imageSchema = z
  .string()
  .regex(/^lrv-diagnostic-pdf@sha256:[a-f0-9]{64}$/);
export const admissionSchema = z
  .object({
    sha256: hash,
    byte_length: z.number().int().min(1).max(3145728),
    page_count: z.number().int().min(1).max(40),
    object_count: z.number().int().min(1).max(5000),
    stream_count: z.number().int().min(0).max(5000),
    inflated_bytes: z.number().int().min(0).max(16777216),
    admission: z.literal("chromium-classic-pdf1.4-v1"),
    qpdf_clean: z.literal(true),
  })
  .strict();
export interface Admission extends z.infer<typeof admissionSchema> {}
export const provenanceSchema = z
  .object({
    template_sha: hash,
    validator_sha: hash,
    worker_sha: hash,
    font_sha: hash,
    settings: z.record(z.unknown()),
  })
  .strict();
export const runtimeConfigSchema = z
  .object({
    image: imageSchema,
    renderer_sha: hash,
    settings_sha: hash,
    provenance: provenanceSchema,
  })
  .strict()
  .superRefine((c, x) => {
    if (!c.image.endsWith(c.renderer_sha))
      x.addIssue({
        code: "custom",
        message: "Pinned image differs from accepted renderer",
      });
  });
export interface RuntimeConfig extends z.infer<typeof runtimeConfigSchema> {}
export const manifestSchema = z
  .object({
    job_id: uuid,
    source: reportSourceSchema,
    input: renderInputSchema,
    source_hash: hash,
    html_sha256: hash,
    manifest_sha256: hash,
    provenance: provenanceSchema,
    image: imageSchema,
    actor_id: uuid,
    created_at: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((m, x) => {
    if (
      m.job_id !== m.source.job.id ||
      m.job_id !== m.input.job_id ||
      m.source_hash !== m.source.job.source_hash ||
      m.source_hash !== m.input.source_hash ||
      m.input.snapshot_hash !== m.source.job.snapshot_hash ||
      m.html_sha256 !== m.input.html_sha256
    )
      x.addIssue({
        code: "custom",
        message: "Frozen rendering manifest bindings differ",
      });
    if (
      JSON.stringify(diagnosticRenderInput(m.source)) !==
      JSON.stringify(m.input)
    )
      x.addIssue({
        code: "custom",
        message: "Frozen rendering input differs from deterministic template",
      });
  });
export const artifactSchema = z
  .object({
    job_id: uuid,
    pet_id: uuid,
    claim_id: uuid,
    fence: z.number().int().positive(),
    capture_actor_id: uuid,
    processing_actor_id: uuid,
    manifest_sha256: hash,
    sha256: hash,
    byte_length: z.number().int().positive().max(3145728),
    bucket_id: z.literal("diagnostic-pdfs"),
    object_path: z.string(),
    object_id: uuid,
    object_created_at: z.string().datetime({ offset: true }),
    object_updated_at: z.string().datetime({ offset: true }),
    object_version: z.string().min(1).max(100),
    mime_type: z.literal("application/pdf"),
    status: z.literal("stored_private"),
    export_eligible: z.literal(false),
  })
  .strict()
  .superRefine((a, x) => {
    if (a.object_path !== `${a.pet_id}/${a.job_id}/${a.sha256}.pdf`)
      x.addIssue({
        code: "custom",
        message: "Artifact path differs from byte and patient identity",
      });
  });
const intentSchema = z
  .object({
    job_id: uuid,
    bucket_id: z.literal("diagnostic-pdfs"),
    object_path: z
      .string()
      .regex(/^[a-f0-9-]{36}\/[a-f0-9-]{36}\/[a-f0-9]{64}\.pdf$/),
    sha256: hash,
    byte_length: z.number().int().positive().max(3145728),
    manifest_sha256: hash,
    actor_id: uuid,
    created_at: z.string().datetime({ offset: true }),
  })
  .strict();
const objectSchema = z
  .object({
    id: uuid,
    updated_at: z.string().datetime({ offset: true }),
    version: z.string().min(1).max(100),
    created_at: z.string().datetime({ offset: true }),
    bucket_id: z.literal("diagnostic-pdfs"),
    name: z.string(),
    mime_type: z.literal("application/pdf"),
    byte_length: z.number().int().positive().max(3145728),
  })
  .strict();
const processingClaimSchema = z
  .object({
    job_id: uuid,
    pet_id: uuid,
    claim_id: uuid,
    fence: z.number().int().positive(),
    actor_id: uuid,
    lease_until: z.string().datetime({ offset: true }),
    manifest: manifestSchema,
    capture: captureMetadataSchema,
  })
  .strict();
export interface PdfService {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
  upload(bucket: string, path: string, bytes: Uint8Array): Promise<void>;
  download(bucket: string, path: string): Promise<Uint8Array>;
}
export interface RendererAdapters {
  generate(
    input: RenderInput,
    image: string,
  ): Promise<{ bytes: Buffer; receipt: RenderReceipt }>;
  validate(
    bytes: Uint8Array,
    input: RenderInput,
    image: string,
  ): Promise<Admission>;
  verifyProvenance(
    provenance: z.infer<typeof provenanceSchema>,
    image: string,
  ): void;
}
async function rpc(
  db: PdfService,
  name: string,
  args: Record<string, unknown>,
) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw error;
  return data;
}
export async function processDiagnosticPdf(
  db: PdfService,
  adapters: RendererAdapters,
  raw: unknown,
) {
  const req = z
    .object({
      job_id: uuid,
      render_claim_id: uuid.default(() => randomUUID()),
      processing_claim_id: uuid.default(() => randomUUID()),
    })
    .strict()
    .parse(raw);
  const rawConfig = await rpc(db, "read_diagnostic_pdf_runtime_config", {});
  if (rawConfig === null) return { state: "off" };
  const cfg = runtimeConfigSchema.parse(rawConfig);
  adapters.verifyProvenance(cfg.provenance, cfg.image);
  const { pdfJobSchema } = await import(
    "../../src/hub/features/diagnostics/pdf-jobs/model.ts"
  );
  const contextSchema = z
    .object({
      job: pdfJobSchema,
      manifest: manifestSchema.nullable(),
      capture: captureMetadataSchema.nullable(),
      artifact: artifactSchema.nullable(),
      object_present: z.boolean(),
    })
    .strict();
  const currentRaw = await rpc(db, "read_diagnostic_pdf_processing_context", {
    p_id: req.job_id,
  });
  if (currentRaw === null) return { state: "missing" };
  const current = contextSchema.parse(currentRaw);
  assert.equal(current.job.id, req.job_id);
  if (current.artifact !== null) {
    assert.equal(current.artifact.job_id, req.job_id);
    assert.equal(current.artifact.pet_id, current.job.pet_id);
    assert.equal(current.artifact.sha256, current.capture?.sha256);
    assert.equal(
      current.artifact.manifest_sha256,
      current.manifest?.manifest_sha256,
    );
    return {
      state: current.object_present
        ? "stored_private"
        : "registered_unavailable",
      artifact: current.artifact,
    };
  }
  let manifest = current.manifest;
  if (current.capture === null) {
    const rawClaim = await rpc(db, "claim_diagnostic_pdf_job", {
      p_id: req.job_id,
      p_claim_id: req.render_claim_id,
    });
    if (rawClaim === null) return { state: "busy" };
    const claim = pdfClaimSchema.parse(rawClaim);
    assert.equal(claim.job_id, req.job_id);
    assert.equal(claim.renderer_sha, cfg.renderer_sha);
    assert.equal(claim.settings_sha, cfg.settings_sha);
    const args = {
      p_id: req.job_id,
      p_claim: req.render_claim_id,
      p_fence: claim.fence,
      p_actor: claim.actor_id,
    };
    const source = reportSourceSchema.parse(
      await rpc(db, "read_diagnostic_pdf_render_source", args),
    );
    const input = diagnosticRenderInput(source);
    manifest = manifestSchema.parse(
      await rpc(db, "prepare_diagnostic_pdf_manifest", {
        ...args,
        p_source: source,
        p_input: input,
      }),
    );
    assert.deepEqual(manifest.input, input);
    assert.equal(manifest.image, cfg.image);
    assert.deepEqual(manifest.provenance, cfg.provenance);
    const rendered = await adapters.generate(manifest.input, manifest.image);
    const receipt = bindRenderedBytes(
      manifest.input,
      rendered.bytes,
      rendered.receipt,
    );
    assert.equal(receipt.validation.sha256, sha256(rendered.bytes));
    assert.equal(receipt.validation.byte_length, rendered.bytes.length);
    // Validate before first capture; an invalid immutable first capture cannot be regenerated.
    const initial = admissionSchema.parse(
      await adapters.validate(rendered.bytes, manifest.input, manifest.image),
    );
    assert.equal(initial.sha256, sha256(rendered.bytes));
    assert.equal(initial.byte_length, rendered.bytes.length);
    await rpc(db, "capture_manifest_diagnostic_pdf", {
      ...args,
      p_base64: rendered.bytes.toString("base64"),
    });
  }
  assert.ok(
    manifest,
    "Captured bytes need an existing frozen manifest; never regenerate them",
  );
  assert.equal(manifest.image, cfg.image);
  assert.deepEqual(manifest.provenance, cfg.provenance);
  const rawClaim = await rpc(db, "claim_diagnostic_pdf_processing", {
    p_id: req.job_id,
    p_claim: req.processing_claim_id,
  });
  if (rawClaim === null) return { state: "busy" };
  const claim = processingClaimSchema.parse(rawClaim);
  assert.equal(claim.job_id, req.job_id);
  assert.equal(claim.claim_id, req.processing_claim_id);
  assert.equal(claim.pet_id, current.job.pet_id);
  assert.equal(claim.actor_id, current.job.requested_by);
  assert.deepEqual(claim.manifest, manifest);
  assert.equal(claim.capture.job_id, req.job_id);
  assert.equal(claim.capture.pet_id, claim.pet_id);
  assert.equal(claim.capture.source_hash, current.job.source_hash);
  assert.equal(claim.capture.snapshot_hash, current.job.snapshot_hash);
  assert.equal(claim.capture.renderer_sha, cfg.renderer_sha);
  assert.equal(claim.capture.settings_sha, cfg.settings_sha);
  const args = {
    p_id: req.job_id,
    p_claim: req.processing_claim_id,
    p_fence: claim.fence,
    p_actor: claim.actor_id,
  };
  let failureCode = "ADMISSION_FAILED";
  try {
    const captured = pdfCaptureSchema.parse(
      await rpc(db, "read_diagnostic_pdf_capture", {
        p_id: req.job_id,
        p_pet_id: claim.pet_id,
        p_actor_id: claim.actor_id,
        p_source_hash: claim.capture.source_hash,
        p_snapshot_hash: claim.capture.snapshot_hash,
      }),
    );
    const bytes = Buffer.from(captured.base64, "base64");
    assert.equal(sha256(bytes), claim.capture.sha256);
    assert.deepEqual(captured.metadata, claim.capture);
    const admitted = admissionSchema.parse(
      await adapters.validate(bytes, manifest.input, manifest.image),
    );
    assert.equal(admitted.sha256, sha256(bytes));
    assert.equal(admitted.byte_length, bytes.length);
    await rpc(db, "validate_diagnostic_pdf_capture", {
      ...args,
      p_receipt: admitted,
    });
    failureCode = "STORAGE_UNCERTAIN";
    const intent = intentSchema.parse(
      await rpc(db, "reserve_diagnostic_pdf_upload", args),
    );
    assert.equal(intent.job_id, req.job_id);
    assert.equal(intent.sha256, sha256(bytes));
    assert.equal(intent.byte_length, bytes.length);
    assert.equal(intent.manifest_sha256, manifest.manifest_sha256);
    assert.equal(
      intent.object_path,
      `${claim.pet_id}/${req.job_id}/${sha256(bytes)}.pdf`,
    );
    let object = await rpc(db, "read_diagnostic_pdf_upload_object", args);
    if (object === null) {
      try {
        await db.upload(intent.bucket_id, intent.object_path, bytes);
      } catch (error) {
        // An upload acknowledgement may be lost; only actual metadata + bytes resolve uncertainty.
        object = await rpc(db, "read_diagnostic_pdf_upload_object", args);
        if (object === null) throw error;
      }
    }
    const storedObject = objectSchema.parse(
      object ?? (await rpc(db, "read_diagnostic_pdf_upload_object", args)),
    );
    assert.equal(storedObject.name, intent.object_path);
    assert.equal(storedObject.byte_length, bytes.length);
    const downloaded = await db.download(intent.bucket_id, intent.object_path);
    failureCode = "OBJECT_CHANGED";
    assert.equal(downloaded.length, bytes.length);
    assert.equal(sha256(downloaded), sha256(bytes));
    failureCode = "STORAGE_UNCERTAIN";
    const artifact = artifactSchema.parse(
      await rpc(db, "register_diagnostic_pdf_artifact", {
        ...args,
        p_object: storedObject.id,
        p_object_created_at: storedObject.created_at,
        p_object_updated_at: storedObject.updated_at,
        p_object_version: storedObject.version,
        p_readback_base64: Buffer.from(downloaded).toString("base64"),
      }),
    );
    assert.equal(artifact.job_id, req.job_id);
    assert.equal(artifact.pet_id, claim.pet_id);
    assert.equal(artifact.claim_id, claim.claim_id);
    assert.equal(artifact.fence, claim.fence);
    assert.equal(artifact.processing_actor_id, claim.actor_id);
    assert.equal(artifact.capture_actor_id, claim.capture.actor_id);
    assert.equal(artifact.sha256, sha256(bytes));
    assert.equal(artifact.byte_length, bytes.length);
    assert.equal(artifact.manifest_sha256, manifest.manifest_sha256);
    assert.equal(artifact.object_id, storedObject.id);
    assert.equal(artifact.object_created_at, storedObject.created_at);
    assert.equal(artifact.object_updated_at, storedObject.updated_at);
    assert.equal(artifact.object_version, storedObject.version);
    return { state: "stored_private", artifact };
  } catch (error) {
    // Never store provider exceptions or chart text. Lost registration ACKs may already be committed.
    try {
      await rpc(db, "fail_diagnostic_pdf_processing", {
        ...args,
        p_code: failureCode,
      });
    } catch {
      /* Superseded, revoked or already-stored claims cannot be failed. */
    }
    throw error;
  }
}
/** Strict bounded HTTP readback; SDK Blob download would allocate before enforcing the limit. */
export async function boundedResponse(response: Response): Promise<Buffer> {
  if (!response.ok || !response.body)
    throw new Error("Private PDF readback failed");
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > 3145728))
    throw new Error("Private PDF readback exceeds capacity");
  const reader = response.body.getReader();
  let total = 0;
  const chunks: Buffer[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 3145728)
        throw new Error("Private PDF readback exceeds capacity");
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks, total);
}
