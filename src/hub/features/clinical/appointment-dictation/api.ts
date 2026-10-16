import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { appointmentDictationSchema } from "./model";
interface AppointmentRpc {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}
const uuid = z.string().uuid();
const encounterSchema = z.object({
  id: uuid, pet_id: uuid, visit_at: z.string().datetime({ offset: true }),
  visit_type: z.enum(["clinic", "housecall"]), location: z.string(),
  subjective: z.string(), objective: z.string(), assessment: z.string(), plan: z.string(),
  status: z.enum(["draft", "signed"]), version: z.number().int().positive(),
  created_by: uuid, updated_by: uuid, signed_by: uuid.nullable(), signed_at: z.string().nullable(),
  created_at: z.string(), updated_at: z.string(),
});
async function call(name: string, args: Record<string, unknown>) {
  const { data, error } = await (supabase as unknown as AppointmentRpc).rpc(name, args);
  if (error) throw error;
  return data;
}
function identity(actor: string, pet: string, appointment: string) {
  return { p_actor_id: uuid.parse(actor), p_pet_id: uuid.parse(pet), p_appointment_id: uuid.parse(appointment) };
}
export async function readAppointmentDictation(actor: string, pet: string, appointment: string) {
  const data = appointmentDictationSchema.parse(await call("read_appointment_dictation", identity(actor, pet, appointment)));
  if (data.actor_id !== actor || data.pet_id !== pet || data.appointment_id !== appointment)
    throw Error("Appointment patient or staff identity differs. Reload before recording.");
  return data;
}
export async function prepareAppointmentDictation(actor: string, pet: string, appointment: string, version: number, existing: string | null) {
  const data = encounterSchema.parse(await call("prepare_appointment_dictation", {
    ...identity(actor, pet, appointment), p_expected_version: z.number().int().positive().parse(version),
    p_existing_encounter_id: existing === null ? null : uuid.parse(existing),
  }));
  if (data.pet_id !== pet || (existing !== null && data.id !== existing))
    throw Error("Returned encounter differs from the confirmed patient. Reload before recording.");
  return data as Tables<"clinical_encounters">;
}
