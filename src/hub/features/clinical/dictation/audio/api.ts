import { supabase } from "@/integrations/supabase/client";
import {
  audioIntentSchema,
  audioJobReadSchema,
  audioJobSchema,
  audioProvenanceSchema,
  audioReadSchema,
  audioReserveSchema,
} from "../../../../../../supabase/functions/_shared/clinical-audio-model.ts";
import { z } from "zod";
interface AudioRpc {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}
async function call(name: string, args: Record<string, unknown>) {
  const { data, error } = await (supabase as unknown as AudioRpc).rpc(
    name,
    args,
  );
  if (error) throw error;
  return data;
}
const uuid = z.string().uuid();
export async function readAudio(actor: string, pet: string, encounter: string) {
  const v = audioReadSchema.parse(
    await call("read_clinical_audio", {
      p_actor_id: uuid.parse(actor),
      p_pet_id: uuid.parse(pet),
      p_encounter_id: uuid.parse(encounter),
    }),
  );
  if (
    v.actor_id !== actor ||
    v.pet_id !== pet ||
    v.encounter_id !== encounter ||
    v.jobs.some((j) => j.pet_id !== pet || j.encounter_id !== encounter)
  )
    throw Error("Audio patient/encounter differs.");
  return v;
}
export async function reserveAudio(
  actor: string,
  id: string,
  request: unknown,
) {
  const input = audioReserveSchema.parse(request),
    v = audioJobSchema.parse(
      await call("reserve_clinical_audio", {
        p_actor_id: uuid.parse(actor),
        p_id: uuid.parse(id),
        p_request: input,
      }),
    );
  if (
    v.id !== id ||
    v.actor_id !== actor ||
    v.pet_id !== input.pet_id ||
    v.encounter_id !== input.encounter_id ||
    v.sha256 !== input.sha256 ||
    v.frames !== input.frames ||
    v.expected_version !== input.expected_version ||
    v.policy_version !== input.policy_version
  )
    throw Error("Reserved audio source differs.");
  return v;
}
export async function readAudioJob(actor: string, id: string) {
  const v = audioJobReadSchema.parse(
    await call("read_clinical_audio_job", {
      p_actor_id: uuid.parse(actor),
      p_id: uuid.parse(id),
    }),
  );
  if (v.job.id !== id) throw Error("Audio job differs.");
  return v;
}
export async function processAudio(input: unknown, bytes?: Uint8Array) {
  const intent = audioIntentSchema.parse(input);
  const { data, error } = await supabase.functions.invoke(
    "clinical-audio-process",
    {
      body:
        intent.stage === "transcribe"
          ? new Blob([new Uint8Array(bytes ?? [])], {
              type: "application/octet-stream",
            })
          : {},
      headers: {
        "x-audio-intent": encodeURIComponent(JSON.stringify(intent)),
        ...(intent.stage === "transcribe"
          ? { "Content-Type": "application/octet-stream" }
          : {}),
      },
    },
  );
  if (error) {
    let message =
      "Processing could not be confirmed. Recover the original attempt before retrying.";
    if (error.context instanceof Response)
      try {
        const value = z
          .object({ error: z.string().max(500) })
          .parse(await error.context.clone().json());
        message = value.error;
      } catch {
        /* Keep sanitized fallback. */
      }
    throw new Error(message);
  }
  const value = audioJobReadSchema.parse(data);
  if (value.job.id !== intent.job_id) throw Error("Processing source differs.");
  return value;
}
export async function readAudioProvenance(actor: string, proposal: string) {
  const v = await call("read_clinical_audio_provenance", {
    p_actor_id: uuid.parse(actor),
    p_proposal_id: uuid.parse(proposal),
  });
  if (v === null) return null;
  const parsed = audioProvenanceSchema.parse(v);
  if (parsed.proposal_id !== proposal)
    throw Error("AI provenance belongs to another proposal.");
  return parsed;
}
