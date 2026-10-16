import { z } from "zod";

export const appointmentDictationSchema = z.object({
  actor_id: z.string().uuid(), pet_id: z.string().uuid(), appointment_id: z.string().uuid(),
  version: z.number().int().positive(), patient_name: z.string(), species: z.string(),
  household_name: z.string(), scheduled_at: z.string().datetime({ offset: true }),
  visit_type: z.enum(["clinic", "housecall"]), location: z.string().nullable(),
  appointment_type: z.string(), status: z.enum(["SCHEDULED", "CONFIRMED", "COMPLETED", "CANCELLED", "NO_SHOW"]),
  assigned_dvm_id: z.string().uuid().nullable(), assigned_dvm_name: z.string().nullable(), eligible: z.boolean(), context_changed: z.boolean(),
  encounter_id: z.string().uuid().nullable(), encounter_status: z.enum(["draft", "signed"]).nullable(),
});
export type AppointmentDictationContext = z.infer<typeof appointmentDictationSchema>;

export function appointmentDictationHref(petId: string, appointmentId: string) {
  return `/hub/patient/${encodeURIComponent(petId)}?tab=medical&section=soap&dictation_appointment=${encodeURIComponent(appointmentId)}`;
}
export function appointmentDictationBlocked(context: AppointmentDictationContext): string | null {
  if (context.context_changed) return "This appointment changed after its encounter was linked. Review the original encounter from Medical before continuing.";
  if (!context.eligible) return "An active patient and a booked or confirmed appointment are required. A completed appointment can only reopen its existing encounter.";
  if (context.encounter_status === "signed") return "This appointment’s encounter is signed. Review it from Medical; recordings cannot change a signed record.";
  return null;
}
