import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import {
  configurationRequestSchemas,
  configurationSchema,
  notesReadSchema,
  noteReserveSchema,
  noteJobSchema,
  noteJobReadSchema,
  noteIntentSchema,
  noteProvenanceSchema,
  noteTemplateVersionSchema,
  type ConfigurationAction,
} from "./model";
interface RpcClient {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}
const uuid = z.string().uuid();
async function call(name: string, args: Record<string, unknown>) {
  const { data, error } = await (supabase as unknown as RpcClient).rpc(
    name,
    args,
  );
  if (error) throw error;
  return data;
}
export async function readNoteConfiguration(actor: string) {
  const value = configurationSchema.parse(
    await call("read_clinical_note_configuration", {
      p_actor_id: uuid.parse(actor),
    }),
  );
  if (value.actor_id !== actor) throw Error("Template operator differs.");
  return value;
}
function configurationArgs(action: ConfigurationAction) {
  return {
    p_actor_id: uuid.parse(action.actor),
    p_id: uuid.parse(action.id),
    p_operation: action.operation,
    p_request: configurationRequestSchemas[action.operation].parse(
      action.request,
    ),
  };
}
const receiptSchema = z.union([
  z.object({ cancelled: z.literal(true) }).strict(),
  z
    .object({ cancelled: z.literal(false), configuration: configurationSchema })
    .strict(),
]);
export async function configurationAction(
  action: ConfigurationAction,
  mode: "save" | "recover" | "cancel",
) {
  const value = await call(
    `${mode}_clinical_note_configuration`,
    configurationArgs(action),
  );
  if (value === null && mode === "recover") return null;
  const parsed = receiptSchema.parse(value);
  if (
    'configuration' in parsed &&
    (!parsed.configuration || parsed.configuration.actor_id !== action.actor)
  )
    throw Error("Template receipt operator differs.");
  return parsed;
}
export async function readNotes(actor: string, pet: string, encounter: string) {
  const value = notesReadSchema.parse(
    await call("read_clinical_notes", {
      p_actor_id: uuid.parse(actor),
      p_pet_id: uuid.parse(pet),
      p_encounter_id: uuid.parse(encounter),
    }),
  );
  if (
    value.actor_id !== actor ||
    value.pet_id !== pet ||
    value.encounter_id !== encounter ||
    value.jobs.some((j) => j.pet_id !== pet || j.encounter_id !== encounter)
  )
    throw Error("Clinical note destination differs.");
  return value;
}
export async function reserveNote(actor: string, id: string, request: unknown) {
  const input = noteReserveSchema.parse(request);
  const value = noteJobSchema.parse(
    await call("reserve_clinical_note", {
      p_actor_id: uuid.parse(actor),
      p_id: uuid.parse(id),
      p_request: input,
    }),
  );
  if (
    value.id !== id ||
    value.actor_id !== actor ||
    value.pet_id !== input.pet_id ||
    value.encounter_id !== input.encounter_id ||
    value.expected_version !== input.expected_version ||
    value.template_hash !== input.template_hash ||
    value.template_id !== input.template_id ||
    value.template_version !== input.template_version ||
    value.policy_version !== input.policy_version ||
    value.source_kind !== input.source_kind ||
    value.audio_job_id !== input.audio_job_id ||
    (input.source_kind === "typed" && value.source_text !== input.source_text)
  )
    throw Error("Reserved clinical note source differs.");
  return value;
}
export async function readNoteJob(actor: string, id: string) {
  const value = noteJobReadSchema.parse(
    await call("read_clinical_note_job", {
      p_actor_id: uuid.parse(actor),
      p_id: uuid.parse(id),
    }),
  );
  if (value.job.id !== id || value.job.actor_id !== actor)
    throw Error("Clinical note job differs.");
  return value;
}
export async function cancelNoteReservation(actor: string, id: string) {
  const value = z
    .union([
      z.object({ cancelled: z.literal(true), job: z.null() }).strict(),
      z.object({ cancelled: z.literal(false), job: noteJobSchema }).strict(),
    ])
    .parse(
      await call("cancel_clinical_note_reservation", {
        p_actor_id: uuid.parse(actor),
        p_id: uuid.parse(id),
      }),
    );
  if (!value.cancelled && (value.job.id !== id || value.job.actor_id !== actor))
    throw Error("Canceled source reservation identity differs.");
  return value;
}
export async function cancelNoteAttempt(actor: string, input: unknown) {
  const intent = noteIntentSchema.parse(input);
  const value = z
    .object({ cancelled: z.boolean(), job: noteJobSchema })
    .strict()
    .parse(
      await call("cancel_clinical_note_attempt", {
        p_actor_id: uuid.parse(actor),
        p_id: intent.attempt_id,
        p_job_id: intent.job_id,
        p_retry_of: intent.retry_of,
        p_reason: intent.reason,
        p_ack_cost: intent.ack_cost,
      }),
    );
  if (value.job.id !== intent.job_id || value.job.actor_id !== actor)
    throw Error("Canceled note attempt identity differs.");
  return value;
}
export async function readNoteProvenance(actor: string, proposal: string) {
  const value = await call("read_clinical_note_provenance", {
    p_actor_id: uuid.parse(actor),
    p_proposal_id: uuid.parse(proposal),
  });
  if (value === null) return null;
  const parsed = noteProvenanceSchema.parse(value);
  if (parsed.proposal_id !== proposal)
    throw Error("Template provenance proposal differs.");
  return parsed;
}
export async function readTemplateVersions(
  actor: string,
  id: string,
  before: number | null = null,
) {
  const value = z
    .object({
      id: uuid,
      versions: z.array(noteTemplateVersionSchema).max(20),
      has_more: z.boolean(),
    })
    .strict()
    .parse(
      await call("list_clinical_note_template_versions", {
        p_actor_id: uuid.parse(actor),
        p_template_id: uuid.parse(id),
        p_before_version: before,
      }),
    );
  if (value.id !== id || value.versions.some((version) => version.id !== id))
    throw Error("Template version history differs.");
  return value;
}
export async function processNote(input: unknown) {
  const intent = noteIntentSchema.parse(input);
  const { data, error } = await supabase.functions.invoke(
    "clinical-note-process",
    {
      body: {},
      headers: { "x-note-intent": encodeURIComponent(JSON.stringify(intent)) },
    },
  );
  if (error) {
    let message =
      "Processing could not be confirmed. Recover this attempt before starting another.";
    if (error.context instanceof Response)
      try {
        message = z
          .object({ error: z.string().max(500) })
          .parse(await error.context.clone().json()).error;
      } catch {
        /* Keep bounded fallback. */
      }
    throw Error(message);
  }
  const value = noteJobReadSchema.parse(data);
  if (value.job.id !== intent.job_id)
    throw Error("Processing clinical note source differs.");
  return value;
}
