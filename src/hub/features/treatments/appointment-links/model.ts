import { z } from "zod";
const uuid = z.string().guid();
const instant = z.string().datetime({ offset: true });
export const appointmentSchema = z.object({
  id: uuid,
  version: z.number().int().positive(),
  scheduled_at: instant,
  appointment_type: z.string(),
  status: z.enum([
    "SCHEDULED",
    "CONFIRMED",
    "COMPLETED",
    "CANCELLED",
    "NO_SHOW",
  ]),
});
const eventSchema = z.object({
  id: uuid,
  treatment_id: uuid,
  appointment_id: uuid.nullable(),
  version: z.number().int().positive(),
  appointment_snapshot: appointmentSchema.nullable(),
  reason: z.string(),
  created_at: instant,
});
export const linkContextSchema = z.object({
  pet_id: uuid,
  treatment_id: uuid,
  current: eventSchema.extend({ context_changed: z.boolean() }).nullable(),
  appointments: z.array(appointmentSchema),
  history: z.array(eventSchema),
});
export const linkRequestSchema = z.object({
  p_actor_id: uuid,
  p_id: uuid,
  p_pet_id: uuid,
  p_treatment_id: uuid,
  p_appointment_id: uuid.nullable(),
  p_appointment_version: z.number().int().positive().nullable(),
  p_expected_version: z.number().int().nonnegative(),
  p_reason: z.string().trim().min(1).max(2000),
});
export { eventSchema };
