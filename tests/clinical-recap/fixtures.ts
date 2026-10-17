import { randomUUID } from "node:crypto";
import {
  RECAP_UNSUPPORTED_FAMILIES,
  recapJobReadSchema,
  recapPayloadSchema,
} from "../../supabase/functions/_shared/clinical-recap-model.ts";
export const instant = "2026-10-16T18:00:00.000000Z";
// Adapter behavior/canonical hashes are tested by SQL; these are synthetic boundary fixtures.
export function recapFixture() {
  const actor = randomUUID(),
    pet = randomUUID(),
    jobId = randomUUID(),
    attemptId = randomUUID(),
    encounterId = randomUUID();
  const fields = {
    subjective:
      "Owner reported vomiting in June. No vomiting reported at July visit. ADR yesterday.",
    objective: "Eyes not examined.",
    assessment: "Historical gastrointestinal signs.",
    plan: "Cerenia discussed but declined. No medications administered.",
  };
  const manifest = {
    id: randomUUID(),
    contract_version: "clinical-recap-source-v1",
    captured_at: instant,
    source_fingerprint: "a".repeat(64),
    sha256: "b".repeat(64),
    source_set: {
      patient: {
        id: pet,
        version: 1,
        name: "Synthetic patient",
        species: "canine",
        breed: null,
        dob: null,
        birth_date_precision: "unknown",
        sex: "unknown",
        neuter_status: "unknown",
        archived_at: null,
        deceased_at: null,
      },
      selection: {
        encounter_ids: [encounterId],
        include_native_problems: false,
        visit_from: null,
        visit_to: null,
      },
      sources: [{
        ref: "src_0001",
        kind: "signed_encounter",
        id: encounterId,
        pet_id: pet,
        version: 2,
        sha256: "c".repeat(64),
        metadata: {
          visit_at: "2026-07-02T18:00:00.000000Z",
          created_by: actor,
          signed_by: actor,
          signed_at: instant,
        },
        fields,
      }],
      membership: {
        addenda_by_encounter: [{ encounter_id: encounterId, source_ids: [] }],
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
        source_characters: Object.values(fields).reduce(
          (n, s) => n + s.length,
          0,
        ),
        source_bytes: 1800,
      },
    },
  };
  const context = recapJobReadSchema.parse({
    actor_id: actor,
    job: {
      id: jobId,
      actor_id: actor,
      pet_id: pet,
      policy_version: 2,
      manifest_id: manifest.id,
      manifest_sha256: manifest.sha256,
      previous_job_id: null,
      source_note: "Synthetic history review",
      created_at: instant,
      output_id: null,
      review_version: 1,
      attempts: [],
    },
    manifest,
    policy: {
      version: 2,
      status: "approved",
      consent_text: "Synthetic evaluation only.",
      retention_text: "Retain reviewed internal recap.",
      generation_model: "gpt-6-luna",
      reviewed_by: actor,
      reviewed_at: instant,
      created_at: instant,
    },
    current: { source_status: "current", reasons: [] },
    output: null,
    review: null,
  });
  const intent = {
    job_id: jobId,
    attempt_id: attemptId,
    retry_of: null,
    reason: "",
    ack_cost: false,
  };
  const attempt = {
    id: attemptId,
    job_id: jobId,
    actor_id: actor,
    model: "gpt-6-luna",
    state: "claimed",
    intent: { job_id: jobId, retry_of: null, reason: "", ack_cost: false },
    lease_until: "2026-10-16T18:02:00.000000Z",
    result_hash: null,
    error_code: null,
    failure_details: null,
    provider_request_id: null,
    created_at: instant,
    finished_at: null,
  };
  const payload = recapPayloadSchema.parse({
    claims: [{
      claim_id: "claim_001",
      category: "history",
      temporal_status: "historical",
      text: "Owner reported vomiting in June.",
      uncertainty: "",
      citations: [{
        source_ref: "src_0001",
        field_path: "fields.subjective",
        quote: "Owner reported vomiting in June.",
      }],
    }],
    review_flags: [],
  });
  return { actor, pet, jobId, attemptId, context, intent, attempt, payload };
}
export function providerResponse(payload: unknown) {
  return {
    id: "resp_synthetic",
    model: "gpt-6-luna",
    status: "completed",
    error: null,
    incomplete_details: null,
    output: [{ type: "reasoning" }, {
      type: "message",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: JSON.stringify(payload) }],
    }],
  };
}
