import { bookingValuesSchema } from "./catalog-model.ts";
import { z } from "zod";
import {
  nextVisitOutcomeValuesSchema,
  nextVisitContextSchema,
  nextVisitCompletionReceiptSchema,
  customBookingSchema,
  nextVisitAppointmentSchema,
} from "./next-visit-model.ts";
const uuid = z.string().uuid();
export const completionRequestSchema = z
  .object({ id: uuid, expected_version: z.number().int().positive() })
  .strict();
export const outcomeRequestSchema = z
  .object({
    occurrence_id: uuid,
    expected_version: z.number().int().nonnegative(),
    values: nextVisitOutcomeValuesSchema,
  })
  .strict();
export const reviewMetadataSchema = z
  .object({
    id: uuid,
    actor_id: uuid,
    operation: z.enum(["complete", "decide", "editor"]),
  })
  .strict();
export interface ReviewMetadata extends z.infer<typeof reviewMetadataSchema> {}
export interface CompletionRequest extends z.infer<
  typeof completionRequestSchema
> {}
export interface OutcomeRequest extends z.infer<typeof outcomeRequestSchema> {}
export const editorCompletionRequestSchema = z
  .object({
    id: uuid.nullable(),
    expected_version: z.number().int().positive().nullable(),
    booking: z.discriminatedUnion("mode", [
      z
        .object({ mode: z.literal("custom"), values: customBookingSchema })
        .strict(),
      z
        .object({ mode: z.literal("catalog"), values: bookingValuesSchema })
        .strict(),
    ]),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      (value.id === null) !== (value.expected_version === null) ||
      (value.booking.mode === "catalog" &&
        value.booking.values.status !== "COMPLETED")
    )
      ctx.addIssue({
        code: "custom",
        message: "Review one completed editor identity/version",
      });
  });
export interface EditorCompletionRequest extends z.infer<
  typeof editorCompletionRequestSchema
> {}
export const editorCompletionReceiptSchema = z
  .object({
    appointment: nextVisitAppointmentSchema,
    context: nextVisitContextSchema.nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.appointment.status !== "COMPLETED" ||
      (value.context &&
        (value.context.occurrence.appointment_id !== value.appointment.id ||
          value.context.occurrence.appointment_version !==
            value.appointment.version ||
          value.context.occurrence.pet_id !== value.appointment.pet_id ||
          value.context.occurrence.client_id !== value.appointment.client_id))
    )
      ctx.addIssue({
        code: "custom",
        message: "Editor completion differs from its exact occurrence",
      });
  });
export type ReviewRequest =
  CompletionRequest | OutcomeRequest | EditorCompletionRequest;
export const nextVisitReviewSchema = z
  .discriminatedUnion("operation", [
    z
      .object({
        id: uuid,
        actor_id: uuid,
        operation: z.literal("editor"),
        request: editorCompletionRequestSchema,
        expires_at: z.string().datetime({ offset: true }),
        state: z.enum(["prepared", "saved", "expired", "cancelled"]),
        receipt: editorCompletionReceiptSchema.nullable(),
      })
      .strict(),
    z
      .object({
        id: uuid,
        actor_id: uuid,
        operation: z.literal("complete"),
        request: completionRequestSchema,
        expires_at: z.string().datetime({ offset: true }),
        state: z.enum(["prepared", "saved", "expired", "cancelled"]),
        receipt: nextVisitCompletionReceiptSchema.nullable(),
      })
      .strict(),
    z
      .object({
        id: uuid,
        actor_id: uuid,
        operation: z.literal("decide"),
        request: outcomeRequestSchema,
        expires_at: z.string().datetime({ offset: true }),
        state: z.enum(["prepared", "saved", "expired", "cancelled"]),
        receipt: nextVisitContextSchema.nullable(),
      })
      .strict(),
  ])
  .superRefine((value, ctx) => {
    if (value.receipt) {
      const matches =
        value.operation === "decide"
          ? value.receipt.occurrence.id === value.request.occurrence_id &&
            value.receipt.version === value.request.expected_version + 1
          : value.operation === "complete"
            ? value.receipt.appointment.id === value.request.id
            : (!value.request.id ||
                value.receipt.appointment.id === value.request.id) &&
              value.receipt.appointment.pet_id ===
                value.request.booking.values.pet_id &&
              value.receipt.appointment.client_id ===
                value.request.booking.values.client_id;
      if (!matches)
        ctx.addIssue({
          code: "custom",
          message: "Review receipt differs from its exact request",
        });
    }
    if ((value.state === "saved") !== Boolean(value.receipt))
      ctx.addIssue({
        code: "custom",
        message: "Saved review must contain its receipt",
      });
  });
export type NextVisitReview = z.infer<typeof nextVisitReviewSchema>;
export function validateReviewRequest(
  operation: ReviewMetadata["operation"],
  request: ReviewRequest,
) {
  if (operation === "editor")
    return editorCompletionRequestSchema.parse(request);
  return operation === "complete"
    ? completionRequestSchema.parse(request)
    : outcomeRequestSchema.parse(request);
}
// Only identifiers cross the browser-storage boundary, even if a caller passes extra fields.
export function reviewStorageKey(actorId: string) {
  return "lrv:next-visit-reviews:" + uuid.parse(actorId);
}
export function readReviewMetadata(
  storage: Pick<Storage, "getItem">,
  actorId: string,
): ReviewMetadata[] {
  const raw = storage.getItem(reviewStorageKey(actorId));
  if (!raw) return [];
  const parsed = z
    .array(reviewMetadataSchema)
    .max(64)
    .safeParse(JSON.parse(raw));
  if (!parsed.success || parsed.data.some((v) => v.actor_id !== actorId))
    throw new Error(
      "Stored review identifiers need recovery; no draft was submitted.",
    );
  return parsed.data;
}
export function rememberReview(
  storage: Pick<Storage, "getItem" | "setItem">,
  meta: ReviewMetadata,
) {
  const checked = reviewMetadataSchema.parse(meta),
    rows = readReviewMetadata(storage, checked.actor_id);
  storage.setItem(
    reviewStorageKey(checked.actor_id),
    JSON.stringify([...rows.filter((v) => v.id !== checked.id), checked]),
  );
}
export function forgetReview(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  meta: ReviewMetadata,
) {
  const rows = readReviewMetadata(storage, meta.actor_id).filter(
    (v) => v.id !== meta.id,
  );
  if (rows.length)
    storage.setItem(reviewStorageKey(meta.actor_id), JSON.stringify(rows));
  else storage.removeItem(reviewStorageKey(meta.actor_id));
}
