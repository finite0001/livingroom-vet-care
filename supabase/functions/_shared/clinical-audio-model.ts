import { z } from "zod";
export const AUDIO_RATE = 16000;
export const AUDIO_MAX_FRAMES = AUDIO_RATE * 600;
export const AUDIO_MAX_BYTES = 44 + AUDIO_MAX_FRAMES * 2;
export const AUDIO_CONTRACT = "clinical-audio-v1";
const uuid = z.string().uuid();
const bounded = (n: number) =>
  z
    .string()
    .max(n)
    .refine((v) => !v.includes("\0"));
const nonempty = (n: number) => bounded(n).refine((v) => Boolean(v.trim()));
export const audioStageSchema = z.enum(["transcribe", "generate"]);
export const audioIntentSchema = z
  .object({
    job_id: uuid,
    attempt_id: uuid,
    stage: audioStageSchema,
    retry_of: uuid.nullable(),
    reason: bounded(1000),
    ack_cost: z.boolean(),
  })
  .strict();
export const audioReserveSchema = z
  .object({
    pet_id: uuid,
    encounter_id: uuid,
    expected_version: z.number().int().min(1).max(2147483646),
    policy_version: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    frames: z.number().int().min(AUDIO_RATE).max(AUDIO_MAX_FRAMES),
    byte_size: z.number().int().min(32044).max(AUDIO_MAX_BYTES),
    source_note: nonempty(1000),
    attest_authorized: z.literal(true),
  })
  .strict()
  .refine(
    (v) => v.byte_size === 44 + 2 * v.frames,
    "Audio size differs from sample count.",
  );
export const audioPolicySchema = z
  .object({
    version: z.number().int().positive(),
    status: z.enum(["draft", "approved"]),
    consent_text: nonempty(4000),
    audio_retention: z.literal("not_stored"),
    transcript_retention: nonempty(2000),
    transcription_model: z.literal("gpt-transcribe"),
    soap_model: z.literal("gpt-6-luna"),
    reviewed_by: uuid.nullable(),
    reviewed_at: z.string().nullable(),
    created_at: z.string(),
  })
  .strict()
  .refine((v) =>
    v.status === "approved"
      ? !!v.reviewed_by && !!v.reviewed_at
      : v.reviewed_by === null && v.reviewed_at === null,
  );
export const audioAttemptSchema = z
  .object({
    id: uuid,
    job_id: uuid,
    actor_id: uuid,
    stage: audioStageSchema,
    model: nonempty(100),
    state: z.enum([
      "claimed",
      "sending",
      "completed",
      "failed",
      "uncertain",
      "superseded",
    ]),
    intent: audioIntentSchema.omit({ attempt_id: true }),
    lease_until: z.string(),
    result_hash: z.string().nullable(),
    error_code: z.string().nullable(),
    failure_details: z
      .object({
        http_status: z.number().int().min(100).max(599).optional(),
        provider_code: z
          .string()
          .regex(/^[a-z0-9_]{1,80}$/)
          .optional(),
        request_id: z.string().max(200).optional(),
        retry_after_seconds: z.number().int().min(0).max(86400).optional(),
      })
      .strict()
      .nullable(),
    provider_request_id: z.string().nullable(),
    created_at: z.string(),
    finished_at: z.string().nullable(),
  })
  .strict();
export const audioJobSchema = z
  .object({
    id: uuid,
    actor_id: uuid,
    pet_id: uuid,
    encounter_id: uuid,
    expected_version: z.number().int().positive(),
    policy_version: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    frames: z.number().int().min(AUDIO_RATE).max(AUDIO_MAX_FRAMES),
    byte_size: z.number().int().min(32044).max(AUDIO_MAX_BYTES),
    source_note: nonempty(1000),
    transcript: nonempty(60000).nullable(),
    transcription_request_id: z.string().nullable(),
    proposal_id: uuid.nullable(),
    created_at: z.string(),
    attempts: z.array(audioAttemptSchema).max(20),
  })
  .strict()
  .superRefine((v, c) => {
    if (
      v.byte_size !== 44 + 2 * v.frames ||
      v.attempts.some((a) => a.job_id !== v.id || a.actor_id !== v.actor_id)
    )
      c.addIssue({
        code: "custom",
        message: "Audio source/attempt identity differs.",
      });
  });
export const audioReadSchema = z
  .object({
    actor_id: uuid,
    pet_id: uuid,
    encounter_id: uuid,
    policy: audioPolicySchema,
    jobs: z.array(audioJobSchema).max(10),
  })
  .strict();
export const audioJobReadSchema = z
  .object({ job: audioJobSchema, policy: audioPolicySchema })
  .strict();
const claim = z.object({ text: nonempty(500), quote: nonempty(1000) }).strict();
export const audioSoapSchema = z
  .object({
    subjective: z.array(claim).max(24),
    objective: z.array(claim).max(24),
    assessment: z.array(claim).max(24),
    plan: z.array(claim).max(24),
    review_flags: z.array(nonempty(500)).max(10),
  })
  .strict();
export const audioSoapFields = [
  "subjective",
  "objective",
  "assessment",
  "plan",
] as const;
export function validateAudioSoap(value: unknown, transcript: string) {
  const parsed = audioSoapSchema.parse(value);
  let count = 0;
  for (const field of audioSoapFields)
    for (const c of parsed[field]) {
      count++;
      if (!transcript.includes(c.quote))
        throw new Error("A clinical claim has no literal transcript excerpt.");
    }
  if (!count) throw new Error("No usable clinical claims were returned.");
  return parsed;
}
export const audioProvenanceSchema = z
  .object({
    proposal_id: uuid,
    job_id: uuid,
    attempt_id: uuid,
    payload: audioSoapSchema,
    transcript_hash: z.string().regex(/^[a-f0-9]{64}$/),
    transcription_model: z.literal("gpt-transcribe"),
    soap_model: z.literal("gpt-6-luna"),
    provider_response_id: bounded(200),
    provider_model: bounded(200),
    contract_version: z.literal(AUDIO_CONTRACT),
    created_at: z.string(),
    audio_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    source_note: nonempty(1000),
  })
  .strict();
export function inspectAudioWav(bytes: Uint8Array) {
  if (bytes.byteLength < 32044 || bytes.byteLength > AUDIO_MAX_BYTES)
    throw new Error(
      "Use a one-second to ten-minute mono16kHz PCM WAV recording.",
    );
  const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (
    tag(0) !== "RIFF" ||
    d.getUint32(4, true) !== bytes.byteLength - 8 ||
    tag(8) !== "WAVE" ||
    tag(12) !== "fmt " ||
    d.getUint32(16, true) !== 16 ||
    d.getUint16(20, true) !== 1 ||
    d.getUint16(22, true) !== 1 ||
    d.getUint32(24, true) !== AUDIO_RATE ||
    d.getUint32(28, true) !== AUDIO_RATE * 2 ||
    d.getUint16(32, true) !== 2 ||
    d.getUint16(34, true) !== 16 ||
    tag(36) !== "data" ||
    d.getUint32(40, true) !== bytes.byteLength - 44 ||
    (bytes.byteLength - 44) % 2
  )
    throw new Error(
      "Audio must be canonical mono16kHz16-bit PCM WAV; the file contents differ.",
    );
  const frames = (bytes.byteLength - 44) / 2;
  let peak = 0;
  for (let i = 44; i < bytes.byteLength; i += 2)
    peak = Math.max(peak, Math.abs(d.getInt16(i, true)));
  if (peak < 16)
    throw new Error(
      "Recording is silent or too quiet. Check the microphone and record again.",
    );
  return { frames, byte_size: bytes.byteLength, seconds: frames / AUDIO_RATE };
}
export function encodeAudioWav(chunks: readonly Int16Array[]) {
  const frames = chunks.reduce((n, c) => n + c.length, 0);
  if (frames < AUDIO_RATE || frames > AUDIO_MAX_FRAMES)
    throw new Error("Record between one second and ten minutes.");
  const bytes = new Uint8Array(44 + frames * 2),
    d = new DataView(bytes.buffer);
  const tag = (at: number, s: string) =>
    [...s].forEach((c, i) => d.setUint8(at + i, c.charCodeAt(0)));
  tag(0, "RIFF");
  d.setUint32(4, bytes.length - 8, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  d.setUint32(16, 16, true);
  d.setUint16(20, 1, true);
  d.setUint16(22, 1, true);
  d.setUint32(24, AUDIO_RATE, true);
  d.setUint32(28, AUDIO_RATE * 2, true);
  d.setUint16(32, 2, true);
  d.setUint16(34, 16, true);
  tag(36, "data");
  d.setUint32(40, frames * 2, true);
  let at = 44;
  for (const chunk of chunks)
    for (const sample of chunk) {
      d.setInt16(at, sample, true);
      at += 2;
    }
  inspectAudioWav(bytes);
  return bytes;
}
export async function audioDigest(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", copy))]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
