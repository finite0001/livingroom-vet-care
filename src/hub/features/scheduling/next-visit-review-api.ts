import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import {
  nextVisitContextSchema,
  nextVisitQueueSchema,
  nextVisitCompletionReceiptSchema,
  nextVisitCursorSchema,
} from "./next-visit-model";
import {
  nextVisitReviewSchema,
  editorCompletionReceiptSchema,
  reviewMetadataSchema,
  validateReviewRequest,
  type ReviewMetadata,
  type ReviewRequest,
} from "./next-visit-review-model";
interface ReviewRpc {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}
const db = supabase as unknown as ReviewRpc;
async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw error;
  return data;
}
function args(meta: ReviewMetadata) {
  const v = reviewMetadataSchema.parse(meta);
  return { p_actor_id: v.actor_id, p_action_id: v.id };
}
export async function prepareNextVisitReview(
  meta: ReviewMetadata,
  request: ReviewRequest,
) {
  const result = nextVisitReviewSchema.parse(
    await rpc("prepare_next_visit_review", {
      ...args(meta),
      p_operation: meta.operation,
      p_request: validateReviewRequest(meta.operation, request),
    }),
  );
  if (
    result.id !== meta.id ||
    result.actor_id !== meta.actor_id ||
    result.operation !== meta.operation
  )
    throw new Error("Review acknowledgment differs from this action");
  if (
    JSON.stringify(result.request) !==
    JSON.stringify(validateReviewRequest(meta.operation, request))
  )
    throw new Error("Prepared review differs from the reviewed request");
  return result;
}
export async function readNextVisitReview(meta: ReviewMetadata) {
  const result = nextVisitReviewSchema
    .nullable()
    .parse(await rpc("read_next_visit_review", args(meta)));
  if (
    result &&
    (result.id !== meta.id ||
      result.actor_id !== meta.actor_id ||
      result.operation !== meta.operation)
  )
    throw new Error("Review belongs to different work");
  return result;
}
export async function executeNextVisitReview(meta: ReviewMetadata) {
  const data = await rpc("execute_next_visit_review", args(meta));
  if (meta.operation === "editor")
    return editorCompletionReceiptSchema.parse(data);
  return meta.operation === "complete"
    ? nextVisitCompletionReceiptSchema.parse(data)
    : nextVisitContextSchema.parse(data);
}
export async function cancelNextVisitReview(meta: ReviewMetadata) {
  const data = z
    .object({
      cancelled: z.boolean(),
      operation: z.enum(["complete", "decide", "editor"]).nullable(),
      receipt: z.unknown().nullable(),
    })
    .strict()
    .parse(await rpc("cancel_next_visit_review", args(meta)));
  if (data.cancelled) {
    if (data.receipt !== null)
      throw new Error("Cancelled review cannot erase a receipt");
    return null;
  }
  if (data.operation !== meta.operation || !data.receipt)
    throw new Error("Saved action differs from review");
  if (meta.operation === "editor")
    return editorCompletionReceiptSchema.parse(data.receipt);
  return meta.operation === "complete"
    ? nextVisitCompletionReceiptSchema.parse(data.receipt)
    : nextVisitContextSchema.parse(data.receipt);
}
export async function appointmentCompletion(id: string, version: number) {
  return nextVisitContextSchema.nullable().parse(
    await rpc("read_appointment_completion", {
      p_appointment_id: z.string().uuid().parse(id),
      p_completed_version: z.number().int().positive().parse(version),
    }),
  );
}
export async function patientNextVisits(
  petId: string,
  after: z.infer<typeof nextVisitCursorSchema> | null = null,
) {
  return nextVisitQueueSchema.parse(
    await rpc("list_patient_next_visits", {
      p_pet_id: z.string().uuid().parse(petId),
      p_after_at: after?.at ?? null,
      p_after_id: after?.id ?? null,
      p_limit: 50,
    }),
  );
}
