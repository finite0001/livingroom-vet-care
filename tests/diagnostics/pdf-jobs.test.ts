import assert from "node:assert/strict";
import test from "node:test";
import { finalized, uuid } from "./fixture.ts";
import {
  pdfJobDetailSchema,
  pdfClaimContextSchema,
  pdfCaptureSchema,
  pdfRequestSchema,
  pdfRetrySchema,
} from "../../src/hub/features/diagnostics/pdf-jobs/model.ts";
function detail() {
  const v = finalized();
  const snapshot = {
    schema: 1,
    purpose: "diagnostic_result",
    diagnostic: v,
    patient: {
      id: v.pet_id,
      name: "Synthetic",
      species: "Dog",
      breed: null,
      dob: null,
      birth_date_precision: "unknown",
      microchip_id: null,
    },
  };
  return {
    job: {
      id: v.id,
      panel_id: v.panel_id,
      pet_id: v.pet_id,
      source_hash: v.source_hash,
      snapshot,
      snapshot_hash: "b".repeat(64),
      requested_by: uuid(800),
      created_by: uuid(800),
      updated_by: uuid(800),
      status: "pending",
      version: 1,
      fence: 0,
      claim_id: null,
      lease_until: null,
      renderer_sha: null,
      settings_sha: null,
      last_error: "",
      created_at: "2026-10-11T20:00:00Z",
      updated_at: "2026-10-11T20:00:00Z",
    },
    capture: null,
    worker_configured: false,
    owner_active: true,
    pdf_status: "not_available",
    export_eligible: false,
  };
}
test("Pending jobs preserve reviewed zero and remain explicitly unavailable", () => {
  const d = pdfJobDetailSchema.parse(detail());
  assert.equal(
    d.job.snapshot.diagnostic.snapshot.observations[0].value_number,
    0,
  );
  assert.equal(d.export_eligible, false);
});
test("A job cannot substitute another patient, panel, version or reviewed hash", () => {
  for (const k of ["id", "panel_id", "pet_id", "source_hash"]) {
    const d = detail();
    (d.job as Record<string, unknown>)[k] =
      k === "source_hash" ? "c".repeat(64) : uuid(999);
    assert.equal(pdfJobDetailSchema.safeParse(d).success, false);
  }
});
test("Claims require live fields and captures require actual metadata", () => {
  const d = detail();
  d.job.status = "claimed";
  assert.equal(pdfJobDetailSchema.safeParse(d).success, false);
  const unbound = {
    ...d,
    job: { ...d.job, claim_id: uuid(12), lease_until: "2026-10-11T20:01:30Z" },
  };
  assert.equal(pdfJobDetailSchema.safeParse(unbound).success, false);
  d.job.status = "captured_unverified";
  assert.equal(pdfJobDetailSchema.safeParse(d).success, false);
});
test("Capture parser cannot claim validated, uploaded or release-ready output", () => {
  const metadata = {
    job_id: uuid(10),
    pet_id: uuid(900),
    claim_id: uuid(11),
    fence: 1,
    actor_id: uuid(800),
    source_hash: "a".repeat(64),
    snapshot_hash: "b".repeat(64),
    renderer_sha: "c".repeat(64),
    settings_sha: "d".repeat(64),
    byte_length: 15,
    sha256: "e".repeat(64),
    validation_status: "not_validated",
    storage_status: "not_uploaded",
    export_eligible: false,
  };
  assert.equal(
    pdfCaptureSchema.safeParse({
      metadata: { ...metadata, byte_length: 14 },
      base64: "JVBERi0xLjQKJSVFT0YK",
    }).success,
    false,
  );
  assert.ok(
    pdfCaptureSchema.safeParse({ metadata, base64: "JVBERi0xLjQKJSVFT0YK" })
      .success,
  );
  for (const [key, value] of [
    ["validation_status", "validated"],
    ["storage_status", "ready"],
    ["export_eligible", true],
  ])
    assert.equal(
      pdfCaptureSchema.safeParse({
        metadata: { ...metadata, [key as string]: value },
        base64: "JVBERi0xLjQKJSVFT0YK",
      }).success,
      false,
    );
});
test("Claim context binds exact reviewed identity and source", () => {
  const d = detail();
  const claim = {
    job_id: d.job.id,
    pet_id: d.job.pet_id,
    claim_id: uuid(11),
    fence: 1,
    actor_id: uuid(800),
    lease_until: "2026-10-11T20:01:30Z",
    source_hash: d.job.source_hash,
    snapshot_hash: d.job.snapshot_hash,
    renderer_sha: "c".repeat(64),
    settings_sha: "d".repeat(64),
  };
  assert.ok(
    pdfClaimContextSchema.safeParse({ claim, snapshot: d.job.snapshot })
      .success,
  );
  assert.equal(
    pdfClaimContextSchema.safeParse({
      claim: { ...claim, job_id: uuid(999) },
      snapshot: d.job.snapshot,
    }).success,
    false,
  );
});
test("Requests and retries reject actor injection and unbounded recovery", () => {
  assert.equal(
    pdfRequestSchema.safeParse({
      action_id: uuid(1),
      id: uuid(10),
      pet_id: uuid(900),
      source_hash: "a".repeat(64),
      actor_id: uuid(801),
    }).success,
    false,
  );
  assert.equal(
    pdfRetrySchema.safeParse({
      action_id: uuid(1),
      id: uuid(10),
      pet_id: uuid(900),
      expected_version: 1,
      reason: " ",
    }).success,
    false,
  );
  assert.equal(
    pdfRetrySchema.safeParse({
      action_id: uuid(1),
      id: uuid(10),
      pet_id: uuid(900),
      expected_version: 1,
      reason: "x".repeat(2001),
    }).success,
    false,
  );
});
