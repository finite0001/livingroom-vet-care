import { z } from "zod";
import { audioLanguageContextSchema } from "./clinical-audio-model.ts";
import { callPolicySchema, callSha256, callSourceSchema } from "./clinical-call-model.ts";
import {
  callNotePayloadSchema,
  assembleCallNoteSections,
  validateCallNotePayload,
  validateCallNoteSourceDocument,
} from "./clinical-call-note-model.ts";
import {
  CALL_NOTE_PROMPT_VERSION,
  CALL_NOTE_RESULT_CONTRACT,
  callNoteProviderContextSchema,
  callNoteProviderEvidenceSchema,
} from "./clinical-call-note-provider.ts";
import {
  noteAttemptSchema,
  noteHashSchema,
  noteIntentSchema,
  noteJobSchema,
  notePolicySchema,
  noteTemplateVersionSchema,
} from "./clinical-note-model.ts";

export const CALL_NOTE_PROCESSING_CONTRACT = "clinical-call-note-processing-v1";
const uuid = z.string().uuid();
const version = z.number().int().min(1).max(2147483646);
const text = (maximum: number) => z.string().max(maximum).refine((value) => !value.includes("\0"));
const nonempty = (maximum: number) => text(maximum).refine((value) => !!value.trim());
export const callNoteIntentSchema = noteIntentSchema;
export const callNoteAttemptSchema = noteAttemptSchema;
export const callNoteGenerationPolicySchema = callPolicySchema;
export const callNoteReserveSchema = z.object({
  source_id: uuid,
  expected_version: version,
  template_id: uuid,
  template_version: version,
  template_hash: noteHashSchema,
  note_policy_version: version,
  call_generation_policy_version: version,
  attest_authorized: z.literal(true),
}).strict();

// Derive the stored columns without changing the strict legacy typed/audio readers.
export const callNoteJobSchema = noteJobSchema.innerType().omit({ attempts: true }).extend({
  source_kind: z.literal("call_transcript"),
  audio_job_id: z.null(),
  source_audio_policy_version: z.null(),
}).strict();
export const callNoteBindingSchema = z.object({
  job_id: uuid,
  call_source_id: uuid,
  call_source_sha256: noteHashSchema,
  source_capture_policy_version: version,
  call_generation_policy_version: version,
  created_at: z.string(),
}).strict();
const callNoteResultBaseSchema = z.object({
  request_id: text(200),
  response_id: nonempty(200),
  requested_model: notePolicySchema.innerType().shape.soap_model,
  provider_model: text(200),
  job_id: uuid,
  source_id: uuid,
  source_manifest_sha256: noteHashSchema,
  projection_sha256: noteHashSchema,
  source_capture_policy_version: version,
  call_generation_policy_version: version,
  note_policy_version: version,
  template_id: uuid,
  template_version: version,
  template_sha256: noteHashSchema,
  veterinary_context: audioLanguageContextSchema,
  payload: callNotePayloadSchema,
}).strict();
// Historical records keep their original contract; current admissions require the strict v2 schema.
export const callNoteLegacyResultSchema = callNoteResultBaseSchema.extend({
  contract_version: z.literal("clinical-call-note-result-v1"), prompt_version: z.literal("lrv-call-note-fields-v1"),
});
export const callNoteResultSchema = callNoteResultBaseSchema.extend({
  contract_version: z.literal(CALL_NOTE_RESULT_CONTRACT), prompt_version: z.literal(CALL_NOTE_PROMPT_VERSION),
  provider_evidence: callNoteProviderEvidenceSchema,
});
const callNoteHistoricalManifestSchema = z.discriminatedUnion("contract_version", [
  callNoteLegacyResultSchema.omit({ payload: true }), callNoteResultSchema.omit({ payload: true }),
]);
export const callNoteGenerationSchema = z.object({
  proposal_id: uuid,
  job_id: uuid,
  attempt_id: uuid,
  template_snapshot: noteTemplateVersionSchema.omit({ status: true }),
  source_sha256: noteHashSchema,
  payload: callNotePayloadSchema,
  manifest: callNoteHistoricalManifestSchema,
  created_at: z.string(),
}).strict();
const section = z.object({ text: text(50000), quote: text(2000) }).strict();
export const callNoteProposalSectionsSchema = z.object({
  subjective: section,
  objective: section,
  assessment: section,
  plan: section,
}).strict();
export const callNoteProposalSchema = z.object({
  id: uuid,
  pet_id: uuid,
  encounter_id: uuid,
  expected_version: version,
  actor_id: uuid,
  actor_name: nonempty(200),
  transcript: nonempty(60000),
  source_hash: noteHashSchema,
  source_note: nonempty(1000),
  attest_authorized: z.literal(true),
  sections: callNoteProposalSectionsSchema,
  created_at: z.string(),
}).strict();
export const callNoteSelectedSectionsSchema = z.object({
  subjective: nonempty(50000).optional(),
  objective: nonempty(50000).optional(),
  assessment: nonempty(50000).optional(),
  plan: nonempty(50000).optional(),
}).strict();
export const callNoteReviewRequestSchema = z.object({
  expected_version: version,
  proposal_id: uuid,
  decision: z.enum(["accepted", "rejected"]),
  accepted_sections: callNoteSelectedSectionsSchema,
  review_note: text(2000),
  attest_reviewed: z.literal(true),
}).strict().refine((value) => value.decision === "accepted"
  ? Object.keys(value.accepted_sections).length > 0
  : Object.keys(value.accepted_sections).length === 0 && !!value.review_note.trim(),
"Accept selected clinical text or reject with a reason and no chart changes.");
export const callNoteReviewSchema = z.object({
  id: uuid,
  proposal_id: uuid,
  actor_id: uuid,
  actor_name: nonempty(200),
  decision: z.enum(["accepted", "rejected"]),
  accepted_sections: callNoteSelectedSectionsSchema,
  review_note: text(2000),
  attest_reviewed: z.literal(true),
  encounter_version: z.number().int().positive().nullable(),
  created_at: z.string(),
}).strict().refine((value) => value.decision === "accepted"
  ? value.encounter_version !== null && Object.keys(value.accepted_sections).length > 0
  : value.encounter_version === null && Object.keys(value.accepted_sections).length === 0 && !!value.review_note.trim());
export const callNoteEventSchema = z.object({
  id: uuid,
  job_id: uuid,
  attempt_id: uuid.nullable(),
  actor_id: uuid,
  kind: nonempty(100),
  details: z.record(z.unknown()),
  created_at: z.string(),
}).strict();
export const callNoteTemplateRootSchema = z.object({
  id: uuid,
  revision: version,
  latest_version: version,
  approved_version: version.nullable(),
  retired: z.boolean(),
  latest: noteTemplateVersionSchema.pick({ version: true, definition: true, sha256: true }),
  approved: noteTemplateVersionSchema.pick({ version: true, definition: true, sha256: true }).nullable(),
}).strict();
export const callNoteWorkspaceSchema = z.object({
  jobs: z.array(z.object({
    id: uuid, actor_id: uuid, created_at: z.string(), proposal_id: uuid.nullable(),
  }).strict()).max(20),
  has_more: z.boolean(),
  templates: z.array(callNoteTemplateRootSchema),
  note_policy: notePolicySchema,
  call_generation_policy: callNoteGenerationPolicySchema,
  capture_policy: callPolicySchema,
}).strict();
export const callNoteProcessingReadSchema = z.object({
  contract_version: z.literal(CALL_NOTE_PROCESSING_CONTRACT),
  job: callNoteJobSchema,
  attempts: z.array(callNoteAttemptSchema).max(20),
  events: z.array(callNoteEventSchema).max(100),
  events_has_more: z.boolean(),
  proposal: callNoteProposalSchema.nullable(),
  generation: callNoteGenerationSchema.nullable(),
  review: callNoteReviewSchema.nullable(),
  source: callSourceSchema,
  binding: callNoteBindingSchema,
  template: noteTemplateVersionSchema,
  patient: callNoteProviderContextSchema.shape.patient,
  note_policy: notePolicySchema,
  call_generation_policy: callNoteGenerationPolicySchema,
  capture_policy: callPolicySchema,
}).strict().superRefine((value, context) => {
  const { job, binding, source, template, proposal, generation, review } = value;
  const mismatch = (message: string) => context.addIssue({ code: "custom", message });
  if (binding.job_id !== job.id || binding.call_source_id !== source.id
    || binding.call_source_sha256 !== source.sha256
    || binding.source_capture_policy_version !== source.policy_version
    || job.pet_id !== source.pet_id || job.encounter_id !== source.encounter_id
    || source.call_id !== source.document.call_id || source.call_id !== source.context.call_id
    || source.call_uuid !== source.context.call_uuid || source.client_id !== source.context.client_id
    || source.conversation_id !== source.context.conversation_id
    || job.pet_id !== value.patient.id || job.source_text !== source.document.projection
    || job.template_id !== template.id || job.template_version !== template.version
    || job.template_hash !== template.sha256) mismatch("Pinned call source, patient or template differs.");
  if (value.attempts.some((attempt) => attempt.job_id !== job.id
    || attempt.actor_id !== job.actor_id || attempt.intent.job_id !== job.id)
    || value.events.some((event) => event.job_id !== job.id)
    || new Set(value.attempts.map((attempt) => attempt.id)).size !== value.attempts.length) {
    mismatch("Private call attempt or event identity differs.");
  }
  if ((job.proposal_id === null) !== (proposal === null)
    || (proposal === null) !== (generation === null)) mismatch("Private call proposal or generation is missing.");
  if (proposal && (proposal.id !== job.proposal_id || proposal.pet_id !== job.pet_id
    || proposal.encounter_id !== job.encounter_id || proposal.expected_version !== job.expected_version
    || proposal.transcript !== job.source_text || proposal.source_hash !== job.source_sha256)) {
    mismatch("Private call proposal source differs.");
  }
  if (generation) {
    const manifest = generation.manifest;
    if (generation.proposal_id !== job.proposal_id || generation.job_id !== job.id
      || generation.attempt_id !== generation.proposal_id || generation.source_sha256 !== job.source_sha256
      || generation.template_snapshot.id !== job.template_id
      || generation.template_snapshot.version !== job.template_version
      || generation.template_snapshot.sha256 !== job.template_hash
      || JSON.stringify(generation.template_snapshot.definition) !== JSON.stringify(template.definition)
      || manifest.job_id !== job.id || manifest.source_id !== source.id
      || manifest.source_manifest_sha256 !== source.sha256 || manifest.projection_sha256 !== job.source_sha256
      || manifest.source_capture_policy_version !== binding.source_capture_policy_version
      || manifest.call_generation_policy_version !== binding.call_generation_policy_version
      || manifest.note_policy_version !== job.policy_version || manifest.template_id !== job.template_id
      || manifest.template_version !== job.template_version || manifest.template_sha256 !== job.template_hash) {
      mismatch("Private call generation manifest differs.");
    }
  }
  if (review && (!proposal || review.proposal_id !== proposal.id
    || (review.decision === "accepted" && review.encounter_version !== job.expected_version + 1)
    || Object.keys(review.accepted_sections).some((key) => !proposal.sections[key as keyof typeof proposal.sections].text))) {
    mismatch("Private call review proposal or accepted version differs.");
  }
});

export type CallNoteProcessingRead = z.infer<typeof callNoteProcessingReadSchema>;

/** Current SQL authority is mandatory; this verifies returned evidence, not authorization. */
export async function validateCallNoteProcessingRead(value: unknown) {
  const parsed = callNoteProcessingReadSchema.parse(value);
  await validateCallNoteSourceDocument(parsed.source.document);
  if (await callSha256(parsed.job.source_text) !== parsed.job.source_sha256) {
    throw Error("Retained call projection digest differs.");
  }
  if (parsed.generation) {
    await validateCallNotePayload(parsed.generation.payload, parsed.source.document, parsed.template.definition);
    const assembled = await assembleCallNoteSections(parsed.generation.payload, parsed.source.document, parsed.template.definition);
    const quotes = { subjective: "", objective: "", assessment: "", plan: "" };
    parsed.generation.payload.fields.forEach((field, index) => {
      const destination = parsed.template.definition.fields[index].destination;
      const first = field.claims.find((claim) => claim.patient_scope === "selected_patient");
      if (first && !quotes[destination]) quotes[destination] = first.supports[0].quote;
    });
    for (const destination of ["subjective", "objective", "assessment", "plan"] as const) {
      if (parsed.proposal?.sections[destination].text !== assembled[destination]
        || parsed.proposal.sections[destination].quote !== quotes[destination]) {
        throw Error("Retained private call proposal differs from its validated selected-patient claims.");
      }
    }
  }
  return parsed;
}

/** Eligibility is distinct from historical readability after a policy/template change. */
export function callNoteProviderContext(value: CallNoteProcessingRead) {
  const parsed = callNoteProcessingReadSchema.parse(value);
  if (parsed.note_policy.status !== "approved" || parsed.note_policy.version !== parsed.job.policy_version
    || parsed.call_generation_policy.status !== "approved"
    || !parsed.call_generation_policy.reviewed_by || !parsed.call_generation_policy.reviewed_at
    || parsed.call_generation_policy.version !== parsed.binding.call_generation_policy_version
    || parsed.capture_policy.status !== "approved"
    || !parsed.capture_policy.reviewed_by || !parsed.capture_policy.reviewed_at
    || parsed.capture_policy.version !== parsed.binding.source_capture_policy_version
    || parsed.template.status !== "approved") {
    throw Error("Current call generation policy or template approval is required.");
  }
  return callNoteProviderContextSchema.parse({
    job_id: parsed.job.id,
    source: parsed.source,
    projection_sha256: parsed.job.source_sha256,
    patient: parsed.patient,
    template: parsed.template,
    model: parsed.note_policy.soap_model,
    note_policy_version: parsed.job.policy_version,
    call_generation_policy_version: parsed.binding.call_generation_policy_version,
  });
}
