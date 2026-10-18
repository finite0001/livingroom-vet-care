import { randomUUID } from "node:crypto";
import { captureClinicalCallTranscript } from "../../supabase/functions/_shared/clinical-call-handler.ts";
import { callSha256 } from "../../supabase/functions/_shared/clinical-call-model.ts";
import {
  CALL_NOTE_PAYLOAD_CONTRACT,
  assembleCallNoteSections,
} from "../../supabase/functions/_shared/clinical-call-note-model.ts";
import { CALL_NOTE_PROVIDER_PAYLOAD_CONTRACT, parseClinicalCallNoteResponse } from "../../supabase/functions/_shared/clinical-call-note-provider.ts";
import {
  CALL_NOTE_PROCESSING_CONTRACT,
  callNoteProcessingReadSchema,
  callNoteProviderContext,
  callNoteResultSchema,
  type CallNoteProcessingRead,
} from "../../supabase/functions/_shared/clinical-call-note-processing-model.ts";

export async function callNoteProcessingFixture(text = "Owner reports Luna is ADR. No medication administered.") {
  const actor = randomUUID(), now = "2026-10-17T15:00:00.000Z", id = randomUUID();
  const document = await captureClinicalCallTranscript("700013", "synthetic-only", async () => new Response(JSON.stringify({
    data: { callId: 700013, language: "en", callers: [{ type: "contact", id: null, localIdentifier: "owner-original" }],
      segments: [{ start: 0, end: 12.5, caller: "owner-original", text }] },
    pagination: { total: 1, offset: 0, limit: 100 },
  }), { headers: { "content-type": "application/json" } }), () => Date.parse(now));
  const pet = randomUUID(), encounter = randomUUID(), client = randomUUID(), conversation = randomUUID();
  const policy = {
    version: 2, status: "approved", consent_text: "Synthetic local-only processing",
    retention_text: "Synthetic retained evidence", reviewed_by: actor, reviewed_at: now, created_at: now,
  };
  const source = {
    id: randomUUID(), capture_id: randomUUID(), actor_id: randomUUID(), pet_id: pet, encounter_id: encounter,
    client_id: client, conversation_id: conversation, call_uuid: "synthetic-call-700013", call_id: "700013", policy_version: 2,
    context: { client_id: client, conversation_id: conversation, message_id: randomUUID(), call_uuid: "synthetic-call-700013",
      call_id: "700013", call_started_at: "2026-10-16T14:00:00.000Z", call_ended_at: "2026-10-16T14:01:00.000Z",
      call_last_event_at: "2026-10-16T14:02:00.000Z", inbound_version: 1 },
    document, sha256: "a".repeat(64), created_at: now,
  };
  const template = {
    id: randomUUID(), version: 1, sha256: "b".repeat(64), status: "approved",
    definition: { name: "Synthetic call template", detail: "standard", fields: [
      { id: "history", label: "History", destination: "subjective", instructions: "Preserve attribution.", required: true },
    ] },
  };
  const read = callNoteProcessingReadSchema.parse({
    contract_version: CALL_NOTE_PROCESSING_CONTRACT,
    job: { id, actor_id: actor, pet_id: pet, encounter_id: encounter, expected_version: 1, policy_version: 2,
      template_id: template.id, template_version: 1, template_hash: template.sha256,
      source_kind: "call_transcript", source_text: document.projection, source_sha256: await callSha256(document.projection),
      audio_job_id: null, source_audio_policy_version: null, source_note: "Authorized retained household call",
      proposal_id: null, created_at: now },
    attempts: [], events: [], events_has_more: false, proposal: null, generation: null, review: null, source,
    binding: { job_id: id, call_source_id: source.id, call_source_sha256: source.sha256,
      source_capture_policy_version: 2, call_generation_policy_version: 2, created_at: now },
    template, patient: { id: pet, name: "Luna", species: "canine" },
    note_policy: { version: 2, status: "approved", consent_text: "Synthetic note permission", soap_model: "gpt-6-luna",
      reviewed_by: actor, reviewed_at: now, created_at: now },
    call_generation_policy: policy, capture_policy: policy,
  });
  const quote = text.slice(-Math.min(1000, text.length));
  const payload = {
    contract_version: CALL_NOTE_PAYLOAD_CONTRACT,
    fields: [{ field_id: "history", status: "supported", uncertainty: "", claims: [{
      text: "Owner-reported concern; no medication administered.", patient_scope: "selected_patient",
      supports: [{ segment_ordinal: 1, segment_sha256: document.segments[0].text_sha256,
        from: text.length - quote.length, to: text.length, quote }],
    }] }], review_flags: [],
  };
  // Adapted fictional provider-v2 fixture; never a repaired historical provider response.
  const toProvider = (value: typeof payload) => ({ ...value, contract_version: CALL_NOTE_PROVIDER_PAYLOAD_CONTRACT,
    fields: value.fields.map((field) => ({ ...field, claims: field.claims.map((claim) => ({ ...claim,
      supports: claim.supports.map(({ segment_ordinal, quote }) => ({ segment_ordinal, quote })),
    })) })),
  });
  const response = (value: typeof payload = payload) => ({
    id: "resp_synthetic_call", model: "synthetic-returned-alias", status: "completed", error: null, incomplete_details: null,
    output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(toProvider(value)) }] }],
  });
  const intent = { job_id: id, attempt_id: randomUUID(), retry_of: null as string | null, reason: "", ack_cost: false };
  const result = async () => callNoteResultSchema.parse({
    ...await parseClinicalCallNoteResponse(response(), callNoteProviderContext(read), { response_sha256: await callSha256(JSON.stringify(response())) }), request_id: "req_synthetic_call",
  });
  return { actor, now, read, payload, response, intent, result };
}

export async function saveSyntheticCallResult(read: CallNoteProcessingRead, attempt: string, value: unknown) {
  const result = callNoteResultSchema.parse(value);
  const assembled = await assembleCallNoteSections(result.payload, read.source.document, read.template.definition);
  const quote = result.payload.fields[0].claims.find((claim) => claim.patient_scope === "selected_patient")!.supports[0].quote;
  const { status: _status, ...templateSnapshot } = read.template;
  read.job.proposal_id = attempt;
  read.proposal = {
    id: attempt, pet_id: read.job.pet_id, encounter_id: read.job.encounter_id, expected_version: read.job.expected_version,
    actor_id: read.job.actor_id, actor_name: "Synthetic administrator", transcript: read.job.source_text,
    source_hash: read.job.source_sha256, source_note: "Synthetic call draft", attest_authorized: true,
    sections: {
      subjective: { text: assembled.subjective, quote }, objective: { text: "", quote: "" },
      assessment: { text: "", quote: "" }, plan: { text: "", quote: "" },
    }, created_at: read.job.created_at,
  };
  const { payload, ...manifest } = result;
  read.generation = {
    proposal_id: attempt, job_id: read.job.id, attempt_id: attempt, template_snapshot: templateSnapshot,
    source_sha256: read.job.source_sha256, payload, manifest, created_at: read.job.created_at,
  };
  const recorded = read.attempts.find((item) => item.id === attempt);
  if (recorded) { recorded.state = "completed"; recorded.provider_request_id = result.request_id; }
}
