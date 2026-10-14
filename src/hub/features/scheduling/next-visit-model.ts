import { z } from "zod";
import { bindingSchema, bookingValuesSchema } from "./catalog-model.ts";
const uuid = z.string().uuid();
const instant = z.string().datetime({ offset: true });
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(value + "T12:00:00Z");
    return (
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    );
  }, "Valid calendar date required");
export const nextVisitAppointmentSchema = z
  .object({
    id: uuid,
    version: z.number().int().positive(),
    client_id: uuid,
    pet_id: uuid,
    status: z.enum([
      "SCHEDULED",
      "CONFIRMED",
      "COMPLETED",
      "CANCELLED",
      "NO_SHOW",
    ]),
    scheduled_at: instant,
    duration_minutes: z.number().int().positive(),
    appointment_type: z.string(),
    assigned_dvm_id: uuid.nullable(),
  })
  .passthrough();
export const completionOccurrenceSchema = z
  .object({
    id: uuid,
    appointment_id: uuid,
    appointment_version: z.number().int().positive(),
    client_id: uuid,
    pet_id: uuid,
    snapshot: nextVisitAppointmentSchema,
    binding: bindingSchema.nullable(),
    actor_id: uuid.nullable(),
    recorded_at: instant,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.snapshot.id !== value.appointment_id ||
      value.snapshot.version !== value.appointment_version ||
      value.snapshot.client_id !== value.client_id ||
      value.snapshot.pet_id !== value.pet_id ||
      value.snapshot.status !== "COMPLETED"
    )
      ctx.addIssue({
        code: "custom",
        message: "Completion snapshot differs from its occurrence",
      });
  });
const followupReceiptSchema = z
  .object({
    appointment: nextVisitAppointmentSchema,
    binding: bindingSchema.nullable(),
    existing: z.literal(true).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!["SCHEDULED", "CONFIRMED"].includes(value.appointment.status))
      ctx.addIssue({
        code: "custom",
        message: "Follow-up receipt must contain an active booking",
      });
    if (value.binding)
      for (const [key, field] of Object.entries(value.binding.fields)) {
        if (value.appointment[key] !== field)
          ctx.addIssue({
            code: "custom",
            message: "Follow-up differs from its frozen booking settings",
          });
      }
  });
export const nextVisitDecisionSchema = z
  .object({
    id: uuid,
    occurrence_id: uuid,
    version: z.number().int().positive(),
    kind: z.enum(["later", "declined", "booked"]),
    note: z.string().max(2000),
    followup_on: day.nullable(),
    appointment_id: uuid.nullable(),
    booking_receipt: followupReceiptSchema.nullable(),
    actor_id: uuid,
    recorded_at: instant,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      (value.kind === "booked") !==
        Boolean(value.appointment_id && value.booking_receipt) ||
      (value.kind !== "booked" &&
        (value.appointment_id || value.booking_receipt)) ||
      (value.kind !== "later" && value.followup_on)
    )
      ctx.addIssue({
        code: "custom",
        message: "Decision fields do not match its outcome",
      });
    if (
      value.booking_receipt &&
      value.booking_receipt.appointment.id !== value.appointment_id
    )
      ctx.addIssue({
        code: "custom",
        message: "Decision links a different booking",
      });
  });
export const nextVisitContextSchema = z
  .object({
    occurrence: completionOccurrenceSchema,
    version: z.number().int().nonnegative(),
    decision: nextVisitDecisionSchema.nullable(),
    current: z.boolean(),
    source_status: nextVisitAppointmentSchema.shape.status,
    patient_name: z.string(),
    client_name: z.string(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      (value.version === 0) !== (value.decision === null) ||
      (value.decision &&
        (value.decision.version !== value.version ||
          value.decision.occurrence_id !== value.occurrence.id))
    )
      ctx.addIssue({
        code: "custom",
        message: "Outcome head differs from immutable decision",
      });
    if (
      value.decision?.booking_receipt &&
      (value.decision.booking_receipt.appointment.client_id !==
        value.occurrence.client_id ||
        value.decision.booking_receipt.appointment.pet_id !==
          value.occurrence.pet_id ||
        value.decision.appointment_id === value.occurrence.appointment_id)
    )
      ctx.addIssue({
        code: "custom",
        message: "Follow-up does not match the completed patient",
      });
    if (value.current && value.source_status !== "COMPLETED")
      ctx.addIssue({
        code: "custom",
        message: "Current occurrence must belong to a completed visit",
      });
  });
export interface NextVisitContext extends z.infer<
  typeof nextVisitContextSchema
> {}
export const nextVisitCursorSchema = z
  .object({ at: instant, id: uuid })
  .strict();
export const nextVisitQueueSchema = z
  .object({
    items: z.array(nextVisitContextSchema).max(100),
    next: nextVisitCursorSchema.nullable(),
  })
  .strict();
export const futureVisitPageSchema = z
  .object({
    as_of: instant,
    items: z.array(nextVisitAppointmentSchema).max(100),
    next: nextVisitCursorSchema.nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.items.some(
        (row) =>
          !["SCHEDULED", "CONFIRMED"].includes(row.status) ||
          Date.parse(row.scheduled_at) <= Date.parse(value.as_of),
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Future page contains inactive or past appointments",
      });
  });
const dueKind = z.enum(["care_plan", "vaccine_plan", "lab"]);
export const dueCareCursorSchema = z
  .object({ due_on: day, kind: dueKind, id: uuid })
  .strict();
export const nextVisitDueCareSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            kind: dueKind,
            id: uuid,
            version: z.number().int().positive(),
            label: z.string(),
            due_on: day,
            review_state: z.enum(["reviewed", "planned", "ordered"]),
          })
          .strict()
          .superRefine((row, ctx) => {
            if ((row.kind === "lab") === (row.review_state === "reviewed"))
              ctx.addIssue({
                code: "custom",
                message: "Planned labs are not reviewed care recommendations",
              });
          }),
      )
      .max(100),
    next: dueCareCursorSchema.nullable(),
  })
  .strict();
export const customBookingSchema = z
  .object({
    client_id: uuid,
    pet_id: uuid,
    scheduled_at: instant,
    duration_minutes: z.number().int().min(15).max(480),
    appointment_type: z.string().trim().min(1).max(150),
    assigned_dvm_id: uuid,
    visit_type: z.enum(["clinic", "housecall"]),
    address_snapshot: z.string().trim().min(1).max(1000),
    travel_before_minutes: z.number().int().min(0).max(240),
    travel_after_minutes: z.number().int().min(0).max(240),
    resource_name: z.string().max(150).nullable(),
    notes: z.string().max(20000).nullable(),
    reminder_offsets: z.array(z.number().int().min(1).max(720)).max(5),
  })
  .strict();
export const nextVisitOutcomeValuesSchema = z
  .object({
    action: z.enum(["later", "declined", "book", "existing"]),
    note: z.string().max(2000),
    followup_on: day.nullable(),
    booking: z
      .discriminatedUnion("mode", [
        z
          .object({ mode: z.literal("catalog"), values: bookingValuesSchema })
          .strict(),
        z
          .object({ mode: z.literal("custom"), values: customBookingSchema })
          .strict(),
      ])
      .nullable(),
    appointment_id: uuid.nullable(),
    appointment_version: z.number().int().positive().nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const selected = value.action === "existing";
    if (
      selected !== Boolean(value.appointment_id && value.appointment_version) ||
      (!selected && (value.appointment_id || value.appointment_version)) ||
      (value.action === "book") !== Boolean(value.booking) ||
      (value.action !== "later" && value.followup_on)
    )
      ctx.addIssue({
        code: "custom",
        message: "Choose one explicit next-visit outcome",
      });
    if (
      value.booking?.mode === "catalog" &&
      !["SCHEDULED", "CONFIRMED"].includes(value.booking.values.status)
    )
      ctx.addIssue({
        code: "custom",
        message: "Follow-up must be an active booking",
      });
  });
export interface NextVisitOutcomeValues extends z.infer<
  typeof nextVisitOutcomeValuesSchema
> {}
export const nextVisitCompletionReceiptSchema = z
  .object({
    appointment: nextVisitAppointmentSchema,
    context: nextVisitContextSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.appointment.id !== value.context.occurrence.appointment_id ||
      value.appointment.pet_id !== value.context.occurrence.pet_id ||
      value.appointment.client_id !== value.context.occurrence.client_id ||
      value.appointment.status !== "COMPLETED" ||
      value.context.source_status !== "COMPLETED"
    )
      ctx.addIssue({
        code: "custom",
        message: "Completion acknowledgment differs from its occurrence",
      });
  });
