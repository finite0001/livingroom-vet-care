import assert from "node:assert/strict";
import test from "node:test";
import {
  pendingRecapSchema,
  pendingPolicySchema,
  verifyJobRead,
  verifyReviewReceipt,
  verifyReviewRequest,
  verifyPolicyReceipt,
  unresolvedAttempt,
  excerptParts,
  RECAP_UNSUPPORTED_FAMILIES,
  type PendingRecap,
} from "../../src/hub/features/clinical/recap/model.ts";
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = id(1),
  pet = id(2),
  jobId = id(3),
  manifestId = id(4),
  encounter = id(5),
  attemptId = id(6),
  action = id(7),
  at = "2026-10-16T12:00:00.000000Z",
  hash = "a".repeat(64),
  outputHash = "b".repeat(64),
  text = "Owner reports earlier vomiting.";
function fixture() {
  const claim = {
    claim_id: "claim_001",
    category: "history",
    temporal_status: "historical",
    text,
    uncertainty: "",
    citations: [
      { source_ref: "src_0001", field_path: "fields.subjective", quote: text },
    ],
  };
  const policy = {
    version: 1,
    status: "approved",
    consent_text: "Synthetic authorized recap policy.",
    retention_text: "Synthetic internal retention.",
    generation_model: "gpt-6-luna",
    reviewed_by: actor,
    reviewed_at: at,
    created_at: at,
  };
  const payload = { claims: [claim], review_flags: [] };
  const value = {
    actor_id: actor,
    job: {
      id: jobId,
      actor_id: actor,
      pet_id: pet,
      policy_version: 1,
      manifest_id: manifestId,
      manifest_sha256: hash,
      previous_job_id: null,
      source_note: "Synthetic authorized source.",
      created_at: at,
      output_id: attemptId,
      review_version: 1,
      attempts: [
        {
          id: attemptId,
          job_id: jobId,
          actor_id: actor,
          model: "gpt-6-luna",
          state: "completed",
          intent: {
            job_id: jobId,
            retry_of: null,
            reason: "",
            ack_cost: false,
          },
          lease_until: at,
          result_hash: hash,
          error_code: null,
          failure_details: null,
          provider_request_id: "synthetic_request",
          created_at: at,
          finished_at: at,
        },
      ],
    },
    manifest: {
      id: manifestId,
      contract_version: "clinical-recap-source-v1",
      captured_at: at,
      source_fingerprint: hash,
      sha256: hash,
      source_set: {
        patient: {
          id: pet,
          version: 1,
          name: "Synthetic patient",
          species: "Dog",
          breed: null,
          dob: null,
          birth_date_precision: "unknown",
          sex: "unknown",
          neuter_status: "unknown",
          archived_at: null,
          deceased_at: null,
        },
        selection: {
          encounter_ids: [encounter],
          include_native_problems: false,
          visit_from: null,
          visit_to: null,
        },
        sources: [
          {
            ref: "src_0001",
            kind: "signed_encounter",
            id: encounter,
            pet_id: pet,
            version: 2,
            sha256: hash,
            metadata: {
              visit_at: at,
              created_by: actor,
              signed_by: actor,
              signed_at: at,
            },
            fields: {
              subjective: text,
              objective: "",
              assessment: "",
              plan: "",
            },
          },
        ],
        membership: {
          addenda_by_encounter: [{ encounter_id: encounter, source_ids: [] }],
          native_problem_ids: null,
        },
        exclusions: {
          outside_linked_problem_count: null,
          unsupported_families: [...RECAP_UNSUPPORTED_FAMILIES],
        },
        budgets: {
          encounters: 1,
          problems: 0,
          source_units: 1,
          source_characters: text.length,
          source_bytes: 2400,
        },
      },
    },
    policy,
    current: { source_status: "current", reasons: [] },
    output: {
      id: attemptId,
      job_id: jobId,
      manifest_sha256: hash,
      payload,
      payload_sha256: outputHash,
      provider_manifest: {
        request_id: "synthetic_request",
        response_id: "synthetic_response",
        provider_model: "synthetic_model",
        contract_version: "clinical-recap-v1",
        prompt_version: "lrv-recap-claims-v1",
        manifest_sha256: hash,
        language_context: {
          version: "lrv-vet-en-v1",
          bundle_sha256: hash,
          request_sha256: hash,
        },
      },
      created_at: at,
    },
    review: null,
  };
  const pending = pendingRecapSchema.parse({
    kind: "review",
    actor_id: actor,
    pet_id: pet,
    job_id: jobId,
    action_id: action,
    output_id: attemptId,
    output_hash: outputHash,
    manifest_hash: hash,
  });
  const job = verifyJobRead(value, actor, pet, jobId);
  const request = {
    job_id: jobId,
    output_id: attemptId,
    expected_output_hash: outputHash,
    expected_review_version: 1,
    manifest_sha256: hash,
    decision: "accepted",
    accepted_claims: [
      { claim_id: "claim_001", text: "Owner reports vomiting historically." },
    ],
    review_note: "",
    attest_reviewed: true,
  };
  const review = {
    id: action,
    job_id: jobId,
    output_id: attemptId,
    reviewer_id: actor,
    decision: "accepted",
    accepted_claims: [
      {
        claim_id: claim.claim_id,
        category: claim.category,
        temporal_status: claim.temporal_status,
        uncertainty: "",
        citations: claim.citations,
        proposed_text: text,
        reviewed_text: request.accepted_claims[0].text,
      },
    ],
    review_note: "",
    manifest_sha256: hash,
    output_sha256: outputHash,
    version: 2,
    created_at: at,
  };
  const receipt = {
    id: action,
    actor_id: actor,
    job_id: jobId,
    request_hash: hash,
    review,
  };
  return { job, pending, receipt, request, policy };
}
test("recap recovery metadata rejects clinical text, unknown keys and nonclinical reason substitution", () => {
  const base = {
    actor_id: actor,
    pet_id: pet,
    job_id: jobId,
    kind: "attempt",
    intent: {
      job_id: jobId,
      attempt_id: attemptId,
      retry_of: null,
      reason: "",
      ack_cost: false,
    },
  };
  assert.equal(pendingRecapSchema.parse(base).kind, "attempt");
  assert.throws(() => pendingRecapSchema.parse({ ...base, source_note: text }));
  assert.throws(() =>
    pendingRecapSchema.parse({
      ...base,
      intent: { ...base.intent, retry_of: id(9), reason: text, ack_cost: true },
    }),
  );
  assert.throws(() =>
    pendingRecapSchema.parse({
      ...base,
      intent: { ...base.intent, job_id: id(10) },
    }),
  );
  assert.throws(() =>
    pendingPolicySchema.parse({
      actor_id: actor,
      action_id: action,
      expected_version: 1,
      consent_text: text,
    }),
  );
});
test("review receipts reject forged original metadata despite valid identifier and opaque hash bindings", () => {
  const { job, pending, receipt, request } = fixture();
  assert.equal(
    verifyReviewReceipt(receipt, pending, job).review.accepted_claims[0]
      .proposed_text,
    text,
  );
  for (const patch of [
    { proposed_text: "Normal examination." },
    { category: "problem_status" },
    { temporal_status: "recorded_status_as_of_capture" },
    { uncertainty: "Invented uncertainty." },
    {
      citations: [
        { source_ref: "src_0001", field_path: "fields.plan", quote: text },
      ],
    },
  ]) {
    const changed = structuredClone(receipt);
    Object.assign(changed.review.accepted_claims[0], patch);
    assert.throws(() => verifyReviewReceipt(changed, pending, job));
  }
  const changedWording = structuredClone(receipt);
  changedWording.review.accepted_claims[0].reviewed_text =
    "Different reviewer wording.";
  assert.throws(() =>
    verifyReviewReceipt(changedWording, pending, job, request),
  );
  assert.throws(() =>
    verifyReviewReceipt(
      receipt,
      { ...pending, output_hash: "c".repeat(64) } as PendingRecap,
      job,
    ),
  );
});
test("review request bindings reject a different destination before a write can be attempted", () => {
  const { job, pending, request } = fixture();
  assert.equal(verifyReviewRequest(request, pending, job).job_id, jobId);
  for (const patch of [
    { job_id: id(11) },
    { output_id: id(12) },
    { expected_output_hash: hash },
    { manifest_sha256: outputHash },
    { accepted_claims: [{ claim_id: "claim_002", text }] },
  ])
    assert.throws(() =>
      verifyReviewRequest({ ...request, ...patch }, pending, job),
    );
  assert.throws(() => verifyJobRead(job, id(13), pet, jobId));
  assert.throws(() => verifyJobRead(job, actor, id(14), jobId));
});
test("committed accepted review recovers from fresh version 2 after lost acknowledgement or cancellation race", () => {
  const { job, pending, receipt, request } = fixture();
  const fresh = verifyJobRead(
    {
      ...job,
      job: { ...job.job, review_version: 2 },
      review: receipt.review,
      current: { source_status: "stale", reasons: ["addenda_changed"] },
      policy: {
        ...job.policy,
        version: 2,
        status: "draft",
        reviewed_by: null,
        reviewed_at: null,
      },
    },
    actor,
    pet,
    jobId,
  );
  const recovered = verifyReviewReceipt(receipt, pending, fresh, request);
  const cancellation = { cancelled: false, receipt };
  assert.equal(recovered.review.version, 2);
  assert.equal(
    verifyReviewReceipt(cancellation.receipt, pending, fresh, request).id,
    action,
  );
  assert.throws(() => verifyReviewRequest(request, pending, fresh));
  assert.throws(() =>
    verifyReviewReceipt(receipt, pending, fresh, {
      ...request,
      review_note: "Different request wording.",
    }),
  );
});
test("committed rejection recovers from fresh version 2 without relaxing original request provenance", () => {
  const { job, pending, receipt, request } = fixture();
  const rejection = {
    ...receipt,
    review: {
      ...receipt.review,
      decision: "rejected",
      accepted_claims: [],
      review_note: "Synthetic conflicting history requires a fresh selection.",
    },
  };
  const rejectedRequest = {
    ...request,
    decision: "rejected",
    accepted_claims: [],
    review_note: rejection.review.review_note,
  };
  const fresh = verifyJobRead(
    {
      ...job,
      job: { ...job.job, review_version: 2 },
      review: rejection.review,
    },
    actor,
    pet,
    jobId,
  );
  assert.equal(
    verifyReviewReceipt(rejection, pending, fresh, rejectedRequest).review
      .decision,
    "rejected",
  );
  assert.equal(
    verifyReviewReceipt({ ...rejection }, pending, fresh, rejectedRequest)
      .review.version,
    2,
  );
  assert.throws(() => verifyReviewRequest(rejectedRequest, pending, fresh));
  assert.throws(() => verifyReviewReceipt(receipt, pending, fresh, request));
});
test("policy receipts bind exact same-tab approved wording and actual reviewer", () => {
  const { policy } = fixture();
  const input = {
    expected_version: 1,
    status: "approved",
    consent_text: policy.consent_text,
    retention_text: policy.retention_text,
    attest_reviewed: true,
  };
  const pending = { actor_id: actor, action_id: action, expected_version: 1 },
    receipt = {
      id: action,
      actor_id: actor,
      request_hash: hash,
      policy: { ...policy, version: 2 },
    };
  assert.equal(verifyPolicyReceipt(receipt, pending, input).policy.version, 2);
  for (const patch of [
    { consent_text: "Different permitted use." },
    { retention_text: "Different retention." },
    { reviewed_by: id(15) },
  ])
    assert.throws(() =>
      verifyPolicyReceipt(
        { ...receipt, policy: { ...receipt.policy, ...patch } },
        pending,
        input,
      ),
    );
});
test("missing attempt leases remain unresolved; exact repeated excerpts are rendered separately", () => {
  assert.equal(unresolvedAttempt({ state: "sending" }), true);
  assert.equal(
    unresolvedAttempt({ state: "claimed", lease_until: "invalid" }),
    true,
  );
  assert.equal(
    unresolvedAttempt({
      state: "sending",
      lease_until: "2999-01-01T00:00:00.000000Z",
    }),
    true,
  );
  assert.equal(
    unresolvedAttempt({ state: "completed", lease_until: at }),
    false,
  );
  const parts = excerptParts("No fever. No fever.", "No fever.");
  assert.equal(parts.filter((part) => part.highlighted).length, 2);
  assert.equal(parts.map((part) => part.text).join(""), "No fever. No fever.");
  assert.throws(() => excerptParts("Not examined.", "Normal"));
});
