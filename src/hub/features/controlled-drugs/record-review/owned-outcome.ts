import { z } from "zod";
import { reviewDigestSchema, reviewUuidSchema } from "./request.ts";
import type { RecordReviewPointer } from "./recovery-pointer.ts";
import { ExactJsonNumber, protocolInteger } from "./exact-json.ts";

const instant = z.string().datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)));
const protocolVersion = z.preprocess(value => value instanceof ExactJsonNumber ? protocolInteger(value, 3, 3) : value, z.literal(3));
const receipt = z.object({
  version: protocolVersion, actor_id: reviewUuidSchema, operation_id: reviewUuidSchema,
  transport_digest: reviewDigestSchema, decision: z.enum(["approve", "reject"]), recorded_at: instant, receipt_hash: reviewDigestSchema,
}).strict();
const saved = z.object({ version: protocolVersion, state: z.literal("saved"), data: z.object({ operation_id: reviewUuidSchema, receipt }).strict() }).strict();
const cancelled = z.object({ version: protocolVersion, state: z.literal("cancelled"), data: z.object({
  operation_id: reviewUuidSchema, actor_id: reviewUuidSchema, cancelled_at: instant,
  cancellation_kind: z.enum(["prepared", "unprepared"]), transport_digest: reviewDigestSchema.nullable(),
}).strict() }).strict();
const resolved = z.discriminatedUnion("state", [saved, cancelled]);

/** This is the minimal owned commitment, not a replacement for packet validation. */
export function verifyOwnedReviewOutcome(pointer: RecordReviewPointer, input: unknown): z.infer<typeof resolved> {
  const outcome = resolved.parse(input);
  if (outcome.data.operation_id !== pointer.operation_id) throw new Error("Saved review operation differs");
  if (outcome.state === "saved") {
    const value = outcome.data.receipt;
    if (value.actor_id !== pointer.actor_id || value.operation_id !== pointer.operation_id || value.transport_digest !== pointer.transport_digest)
      throw new Error("Saved review commitment differs from the original request");
  } else {
    const value = outcome.data;
    if (value.actor_id !== pointer.actor_id || (value.cancellation_kind === "prepared" ? value.transport_digest !== pointer.transport_digest : value.transport_digest !== null))
      throw new Error("Cancellation does not close this original review");
  }
  return outcome;
}
