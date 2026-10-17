import { z } from "zod";
import {
  audioAttemptSchema,
  audioLanguageContextSchema,
} from "./clinical-audio-model.ts";

export const NOTE_CONTRACT = "clinical-note-v1";
export const NOTE_PROMPT_VERSION = "lrv-note-fields-v1";
export const noteSoapFields = [
  "subjective",
  "objective",
  "assessment",
  "plan",
] as const;
const uuid = z.string().uuid();
const version = z.number().int().min(1).max(2147483646);
export const noteHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const text = (max: number) =>
  z.string().max(max).refine((s) => !s.includes("\0"));
const nonempty = (max: number) => text(max).refine((s) => !!s.trim());
export const noteTemplateFieldSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{0,47}$/),
  label: nonempty(120),
  destination: z.enum(noteSoapFields),
  instructions: text(500),
  required: z.boolean(),
}).strict();
export const noteTemplateDefinitionSchema = z.object({
  name: nonempty(120),
  detail: z.enum(["concise", "standard", "detailed"]),
  fields: z.array(noteTemplateFieldSchema).min(1).max(48),
}).strict().superRefine((v, c) => {
  if (new Set(v.fields.map((f) => f.id)).size !== v.fields.length) {
    c.addIssue({
      code: "custom",
      message: "Template field IDs must be unique.",
    });
  }
  if (v.fields.reduce((n, f) => n + f.instructions.length, 0) > 12000) {
    c.addIssue({
      code: "custom",
      message: "Template instruction budget exceeded.",
    });
  }
});
export const noteTemplateVersionSchema = z.object({
  id: uuid,
  version,
  definition: noteTemplateDefinitionSchema,
  sha256: noteHashSchema,
  status: z.enum(["draft", "approved", "retired"]),
}).strict();
export const notePolicySchema = z.object({
  version,
  status: z.enum(["draft", "approved"]),
  consent_text: nonempty(4000),
  soap_model: z.literal("gpt-6-luna"),
  reviewed_by: uuid.nullable(),
  reviewed_at: z.string().nullable(),
  created_at: z.string(),
}).strict().refine((v) =>
  v.status === "approved"
    ? !!v.reviewed_by && !!v.reviewed_at
    : v.reviewed_by === null && v.reviewed_at === null
);
export const noteReserveSchema = z.object({
  pet_id: uuid,
  encounter_id: uuid,
  expected_version: version,
  policy_version: version,
  template_id: uuid,
  template_version: version,
  template_hash: noteHashSchema,
  source_kind: z.enum(["typed", "audio_transcript"]),
  source_text: nonempty(60000).nullable(),
  audio_job_id: uuid.nullable(),
  source_note: nonempty(1000),
  attest_authorized: z.literal(true),
}).strict().refine(
  (v) =>
    v.source_kind === "typed"
      ? v.source_text !== null && v.audio_job_id === null
      : v.source_text === null && v.audio_job_id !== null,
  "Exact source kind and identity required.",
);
export const noteIntentSchema = z.object({
  job_id: uuid,
  attempt_id: uuid,
  retry_of: uuid.nullable(),
  reason: text(1000),
  ack_cost: z.boolean(),
}).strict();
export const noteAttemptSchema = audioAttemptSchema.omit({
  stage: true,
  intent: true,
}).extend({
  intent: noteIntentSchema.omit({ attempt_id: true }),
}).strict();
export const noteJobSchema = z.object({
  id: uuid,
  actor_id: uuid,
  pet_id: uuid,
  encounter_id: uuid,
  expected_version: version,
  policy_version: version,
  template_id: uuid,
  template_version: version,
  template_hash: noteHashSchema,
  source_kind: z.enum(["typed", "audio_transcript"]),
  source_text: nonempty(60000),
  source_sha256: noteHashSchema,
  audio_job_id: uuid.nullable(),
  source_audio_policy_version: version.nullable(),
  source_note: nonempty(1000),
  proposal_id: uuid.nullable(),
  created_at: z.string(),
  attempts: z.array(noteAttemptSchema).max(20),
}).strict().superRefine((v, c) => {
  if (
    v.source_kind === "typed"
      ? v.audio_job_id !== null || v.source_audio_policy_version !== null
      : v.audio_job_id === null || v.source_audio_policy_version === null
  ) {
    c.addIssue({ code: "custom", message: "Note source identity differs." });
  }
  if (
    v.attempts.some((a) =>
      a.job_id !== v.id || a.actor_id !== v.actor_id || a.intent.job_id !== v.id
    )
  ) {
    c.addIssue({ code: "custom", message: "Note attempt identity differs." });
  }
});
export const noteJobReadSchema = z.object({
  job: noteJobSchema,
  policy: notePolicySchema,
  template: noteTemplateVersionSchema,
}).strict().superRefine((v, c) => {
  if (
    v.job.template_id !== v.template.id ||
    v.job.template_version !== v.template.version ||
    v.job.template_hash !== v.template.sha256
  ) {
    c.addIssue({
      code: "custom",
      message: "Pinned template differs from the note job.",
    });
  }
});
const claimSchema = z.object({ text: nonempty(500), quote: nonempty(1000) })
  .strict();
export const noteFieldResultSchema = z.object({
  field_id: z.string().regex(/^[a-z][a-z0-9_]{0,47}$/),
  status: z.enum(["supported", "missing", "uncertain"]),
  claims: z.array(claimSchema).max(24),
  uncertainty: text(500),
}).strict().superRefine((v, c) => {
  if (
    v.status === "missing"
      ? v.claims.length !== 0 || v.uncertainty !== ""
      : v.claims.length === 0 ||
        (v.status === "supported"
          ? v.uncertainty !== ""
          : !v.uncertainty.trim())
  ) {
    c.addIssue({
      code: "custom",
      message: "Field evidence and missing/uncertain status differ.",
    });
  }
});
export const notePayloadSchema = z.object({
  fields: z.array(noteFieldResultSchema).min(1).max(48),
  review_flags: z.array(nonempty(500)).max(10),
}).strict();
export function validateNotePayload(
  value: unknown,
  source: string,
  definition: unknown,
) {
  const template = noteTemplateDefinitionSchema.parse(definition),
    payload = notePayloadSchema.parse(value);
  if (payload.fields.length !== template.fields.length) {
    throw Error("Every pinned template field must be returned exactly once.");
  }
  const counts = { subjective: 0, objective: 0, assessment: 0, plan: 0 };
  let total = 0;
  payload.fields.forEach((f, index) => {
    const field = template.fields[index];
    if (f.field_id !== field.id) {
      throw Error("Template field identity/order differs.");
    }
    total += f.claims.length;
    counts[field.destination] += f.claims.length;
    for (const claim of f.claims) {
      if (!source.includes(claim.quote)) {
        throw Error("Clinical claim lacks a literal source excerpt.");
      }
    }
  });
  if (total < 1 || total > 96 || Object.values(counts).some((n) => n > 24)) {
    throw Error("Clinical claim budget exceeded or no usable claims.");
  }
  return payload;
}
export function assembleNoteSections(
  value: unknown,
  source: string,
  definition: unknown,
) {
  const template = noteTemplateDefinitionSchema.parse(definition),
    payload = validateNotePayload(value, source, template);
  const result = {
    subjective: { text: "", quote: "" },
    objective: { text: "", quote: "" },
    assessment: { text: "", quote: "" },
    plan: { text: "", quote: "" },
  };
  payload.fields.forEach((f, index) => {
    if (!f.claims.length) return;
    const field = template.fields[index], section = result[field.destination];
    if (section.text) section.text += "\n\n";
    section.text += field.label + ":\n" +
      f.claims.map((c) => c.text).join("\n");
    if (!section.quote) section.quote = f.claims[0].quote;
    if (section.text.length > 50000) {
      throw Error("Assembled SOAP section is too long.");
    }
  });
  return result;
}
export function missingRequiredNoteFields(value: unknown, definition: unknown) {
  const payload = notePayloadSchema.parse(value),
    template = noteTemplateDefinitionSchema.parse(definition);
  return template.fields.filter((f) =>
    f.required &&
    payload.fields.find((r) => r.field_id === f.id)?.status === "missing"
  ).map((f) => ({ id: f.id, label: f.label }));
}
export const noteResultSchema = z.object({
  request_id: text(200),
  response_id: nonempty(200),
  provider_model: text(200),
  contract_version: z.literal(NOTE_CONTRACT),
  prompt_version: z.literal(NOTE_PROMPT_VERSION),
  source_sha256: noteHashSchema,
  template_sha256: noteHashSchema,
  language_context: audioLanguageContextSchema,
  payload: notePayloadSchema,
}).strict();

export const noteProvenanceSchema = z.object({
  proposal_id: uuid,
  job_id: uuid,
  attempt_id: uuid,
  template_snapshot: noteTemplateVersionSchema.omit({ status: true }),
  source_sha256: noteHashSchema,
  payload: notePayloadSchema,
  manifest: noteResultSchema.omit({ payload: true }),
  created_at: z.string(),
  source_kind: z.enum(["typed", "audio_transcript"]),
  source_note: nonempty(1000),
  audio_job_id: uuid.nullable(),
  source_audio_policy_version: version.nullable(),
  policy_version: version,
}).strict().superRefine((v, c) => {
  if (
    v.source_sha256 !== v.manifest.source_sha256 ||
    v.template_snapshot.sha256 !== v.manifest.template_sha256 ||
    (v.source_kind === "typed"
      ? v.audio_job_id !== null || v.source_audio_policy_version !== null
      : v.audio_job_id === null || v.source_audio_policy_version === null)
  ) {
    c.addIssue({
      code: "custom",
      message: "Note provenance identity differs.",
    });
  }
});
