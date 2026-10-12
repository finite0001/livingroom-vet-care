/** Coordinator protocol counterexamples. These DTO fixtures do not prove parser admission or Storage. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { source } from "./renderer-fixture.ts";
import { uuid } from "./fixture.ts";
import { diagnosticRenderInput } from "../../services/diagnostic-renderer/template.ts";
import { sha256 } from "../../services/diagnostic-renderer/sandbox.ts";
import {
  ACCEPTED_IMAGE,
  trustedProvenance,
} from "../../services/diagnostic-renderer/trusted.ts";
import {
  processDiagnosticPdf,
  boundedResponse,
  manifestSchema,
  artifactSchema,
  type RendererAdapters,
  type PdfService,
} from "../../services/diagnostic-renderer/processing.ts";
const bytes = Buffer.from("Protocol fixture only; not a PDF"),
  s = source(),
  job = s.job,
  input = diagnosticRenderInput(s);
const cfg = {
  image: ACCEPTED_IMAGE,
  renderer_sha: ACCEPTED_IMAGE.split(":")[1],
  settings_sha: "d".repeat(64),
  provenance: trustedProvenance(),
};
const manifest = {
  job_id: job.id,
  source: s,
  input,
  source_hash: job.source_hash,
  html_sha256: input.html_sha256,
  manifest_sha256: "e".repeat(64),
  image: cfg.image,
  provenance: cfg.provenance,
  actor_id: job.requested_by,
  created_at: job.created_at,
};
const capture = {
  job_id: job.id,
  pet_id: job.pet_id,
  claim_id: uuid(900),
  fence: 1,
  actor_id: job.requested_by,
  source_hash: job.source_hash,
  snapshot_hash: job.snapshot_hash,
  renderer_sha: cfg.renderer_sha,
  settings_sha: cfg.settings_sha,
  byte_length: bytes.length,
  sha256: sha256(bytes),
  validation_status: "not_validated",
  storage_status: "not_uploaded",
  export_eligible: false,
};
const claim = {
  job_id: job.id,
  pet_id: job.pet_id,
  claim_id: uuid(901),
  fence: 1,
  actor_id: job.requested_by,
  lease_until: "2099-01-01T00:00:00Z",
  manifest,
  capture,
};
const intent = {
  job_id: job.id,
  bucket_id: "diagnostic-pdfs",
  object_path: `${job.pet_id}/${job.id}/${sha256(bytes)}.pdf`,
  sha256: sha256(bytes),
  byte_length: bytes.length,
  manifest_sha256: manifest.manifest_sha256,
  actor_id: job.requested_by,
  created_at: job.created_at,
};
const object = {
  id: uuid(950),
  updated_at: job.created_at,
  version: "synthetic-object-v1",
  created_at: job.created_at,
  bucket_id: intent.bucket_id,
  name: intent.object_path,
  mime_type: "application/pdf",
  byte_length: bytes.length,
};
const artifact = {
  job_id: job.id,
  pet_id: job.pet_id,
  claim_id: claim.claim_id,
  fence: claim.fence,
  capture_actor_id: capture.actor_id,
  processing_actor_id: claim.actor_id,
  manifest_sha256: manifest.manifest_sha256,
  sha256: sha256(bytes),
  byte_length: bytes.length,
  bucket_id: intent.bucket_id,
  object_path: intent.object_path,
  object_id: object.id,
  object_created_at: object.created_at,
  object_updated_at: object.updated_at,
  object_version: object.version,
  mime_type: "application/pdf",
  status: "stored_private",
  export_eligible: false,
};
const request = { job_id: job.id, processing_claim_id: claim.claim_id };
function fixture(changes: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const responses: Record<string, unknown> = {
    read_diagnostic_pdf_runtime_config: cfg,
    read_diagnostic_pdf_processing_context: {
      job,
      manifest,
      capture,
      artifact: null,
      object_present: false,
    },
    claim_diagnostic_pdf_processing: claim,
    read_diagnostic_pdf_capture: {
      metadata: capture,
      base64: bytes.toString("base64"),
    },
    validate_diagnostic_pdf_capture: {},
    reserve_diagnostic_pdf_upload: intent,
    read_diagnostic_pdf_upload_object: object,
    register_diagnostic_pdf_artifact: artifact,
    ...changes,
  };
  const db: PdfService = {
    async rpc(name) {
      calls.push(name);
      return { data: responses[name], error: null };
    },
    async upload() {
      throw new Error("Unexpected upload");
    },
    async download() {
      return bytes;
    },
  };
  const adapters: RendererAdapters = {
    verifyProvenance() {},
    async generate() {
      throw new Error("Captured bytes must never regenerate");
    },
    async validate() {
      return {
        sha256: sha256(bytes),
        byte_length: bytes.length,
        page_count: 1,
        object_count: 1,
        stream_count: 0,
        inflated_bytes: 0,
        admission: "chromium-classic-pdf1.4-v1",
        qpdf_clean: true,
      };
    },
  };
  return { db, adapters, calls };
}
test("default-off exits before context, generation, validation or upload", async () => {
  const f = fixture({ read_diagnostic_pdf_runtime_config: null });
  assert.deepEqual(await processDiagnosticPdf(f.db, f.adapters, request), {
    state: "off",
  });
  assert.deepEqual(f.calls, ["read_diagnostic_pdf_runtime_config"]);
});
test("missing artifact field cannot masquerade as a completed registration", async () => {
  const f = fixture({
    read_diagnostic_pdf_processing_context: { job, manifest, capture },
  });
  await assert.rejects(processDiagnosticPdf(f.db, f.adapters, request));
  assert.ok(!f.calls.includes("claim_diagnostic_pdf_processing"));
});
test("deterministic manifest rejects altered HTML even with a matching altered HTML hash", () => {
  const modified = { ...input, html: input.html + "<p>invented result</p>" };
  modified.html_bytes = Buffer.byteLength(modified.html);
  modified.html_sha256 = sha256(modified.html);
  assert.equal(
    manifestSchema.safeParse({
      ...manifest,
      input: modified,
      html_sha256: modified.html_sha256,
    }).success,
    false,
  );
});
test("manifest rejects cross-job identity", () =>
  assert.equal(
    manifestSchema.safeParse({ ...manifest, job_id: uuid(999) }).success,
    false,
  ));
for (const [label, changed] of Object.entries({
  patient: { ...claim, pet_id: uuid(999) },
  claim: { ...claim, claim_id: uuid(999) },
  owner: { ...claim, actor_id: uuid(999) },
  capture: { ...claim, capture: { ...capture, job_id: uuid(999) } },
}))
  test(`cross-${label} processing claim stops before validation`, async () => {
    const f = fixture({ claim_diagnostic_pdf_processing: changed });
    await assert.rejects(processDiagnosticPdf(f.db, f.adapters, request));
    assert.ok(!f.calls.includes("validate_diagnostic_pdf_capture"));
  });
test("actual recovered-byte hash is checked before admission", async () => {
  const f = fixture({
    read_diagnostic_pdf_capture: {
      metadata: capture,
      base64: Buffer.alloc(bytes.length, 65).toString("base64"),
    },
  });
  await assert.rejects(processDiagnosticPdf(f.db, f.adapters, request));
  assert.ok(!f.calls.includes("validate_diagnostic_pdf_capture"));
});
test("different Storage readback bytes cannot register", async () => {
  const f = fixture();
  f.db.download = async () => Buffer.alloc(bytes.length, 66);
  await assert.rejects(processDiagnosticPdf(f.db, f.adapters, request));
  assert.ok(!f.calls.includes("register_diagnostic_pdf_artifact"));
});
test("canonical object path rejects another patient", async () => {
  const f = fixture({
    reserve_diagnostic_pdf_upload: {
      ...intent,
      object_path: `${uuid(999)}/${job.id}/${sha256(bytes)}.pdf`,
    },
  });
  await assert.rejects(processDiagnosticPdf(f.db, f.adapters, request));
  assert.ok(!f.calls.includes("register_diagnostic_pdf_artifact"));
});
test("ambiguous upload without an actual object cannot register", async () => {
  const f = fixture({ read_diagnostic_pdf_upload_object: null });
  f.db.upload = async () => {
    throw new Error("Lost acknowledgement");
  };
  await assert.rejects(
    processDiagnosticPdf(f.db, f.adapters, request),
    /Lost acknowledgement/,
  );
  assert.ok(!f.calls.includes("register_diagnostic_pdf_artifact"));
});
test("artifact DTO rejects fabricated release eligibility and path", () => {
  assert.equal(
    artifactSchema.safeParse({ ...artifact, export_eligible: true }).success,
    false,
  );
  assert.equal(
    artifactSchema.safeParse({ ...artifact, object_path: "elsewhere.pdf" })
      .success,
    false,
  );
});
test("registration response is bound to the actual object UUID", async () => {
  const f = fixture({
    register_diagnostic_pdf_artifact: { ...artifact, object_id: uuid(999) },
  });
  await assert.rejects(processDiagnosticPdf(f.db, f.adapters, request));
});
test("bounded HTTP readback checks declared size and actual chunks", async () => {
  await assert.rejects(
    boundedResponse(
      new Response(bytes, { headers: { "content-length": "3145729" } }),
    ),
    /capacity/,
  );
  await assert.rejects(
    boundedResponse(
      new Response(bytes, { headers: { "content-length": "NaN" } }),
    ),
    /capacity/,
  );
  await assert.rejects(
    boundedResponse(
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array(3145728));
            c.enqueue(new Uint8Array(1));
            c.close();
          },
        }),
      ),
    ),
    /capacity/,
  );
  assert.deepEqual(await boundedResponse(new Response(bytes)), bytes);
});

test("historical registration does not report availability after object loss", async () => {
  const f = fixture({
    read_diagnostic_pdf_processing_context: {
      job,
      manifest,
      capture,
      artifact,
      object_present: false,
    },
  });
  assert.equal(
    (await processDiagnosticPdf(f.db, f.adapters, request)).state,
    "registered_unavailable",
  );
  assert.ok(!f.calls.includes("claim_diagnostic_pdf_processing"));
});
