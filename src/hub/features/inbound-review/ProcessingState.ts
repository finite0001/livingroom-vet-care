import { z } from "zod";
const id = z.string().uuid(),
  hash = z.string().regex(/^[a-f0-9]{64}$/),
  date = z.string().datetime({ offset: true }),
  count = z.number().int().nonnegative();
const state = z.enum(["pending", "claimed", "processed", "review"]),
  error = z
    .enum([
      "provider_content_requires_review",
      "provider_fetch_or_persistence_retry",
      "worker_lease_expired",
      "legacy_review_required",
    ])
    .nullable();
export const eventSchema = z.object({
  id,
  provider: z.enum(["resend", "twilio"]),
  event_id: z.string(),
  resource_id: z.string(),
  event_type: z.enum([
    "inbound",
    "sent",
    "delivered",
    "bounced",
    "complained",
    "failed",
    "undelivered",
    "queued",
    "sending",
  ]),
  state,
  attempts: count,
  cycle_no: count,
  cycle_attempts: count.max(10),
  received_at: date,
  available_at: date,
  last_error: error,
  revision: z.number().int().positive(),
});
export const retrySchema = z.object({
  id,
  actor_id: id,
  event_id: id,
  expected_work_hash: hash,
  reason: z.enum([
    "provider_recovered",
    "configuration_repaired",
    "processor_repaired",
  ]),
  previous_cycle_no: count,
  cycle_no: count,
  lifetime_attempts: count,
  created_at: date,
});
const historySchema = z.object({
  id: z.number().int().positive(),
  event_id: id,
  action: z.enum([
    "legacy_snapshot",
    "received",
    "claimed",
    "processed",
    "lease_expired",
    "review",
    "retry_scheduled",
    "admin_requeued",
  ]),
  state,
  attempts: count,
  cycle_no: count,
  cycle_attempts: count.max(10),
  revision: z.number().int().positive(),
  last_error: error,
  created_at: date,
});
export const intentSchema = z
  .object({
    p_id: id,
    p_event_id: id,
    p_expected_work_hash: hash,
    p_reason: z.enum([
      "provider_recovered",
      "configuration_repaired",
      "processor_repaired",
    ]),
    p_attest: z.literal(true),
  })
  .strict();
export interface ProcessingEvent
  extends Required<z.infer<typeof eventSchema>> {}
export interface RetryReceipt extends Required<z.infer<typeof retrySchema>> {}
export interface ProcessingHistory
  extends Required<z.infer<typeof historySchema>> {}
export interface RetryIntent extends Required<z.infer<typeof intentSchema>> {}
export interface Preview {
  event: ProcessingEvent;
  eligible: boolean;
  expected_work_hash: string;
  history: ProcessingHistory[];
  history_has_more: boolean;
  retries: RetryReceipt[];
}
export interface Queue {
  events: ProcessingEvent[];
  has_more: boolean;
}
export interface RetryPage {
  retries: RetryReceipt[];
  has_more: boolean;
}
export function queue(value: unknown): Queue {
  return z
    .object({ events: z.array(eventSchema), has_more: z.boolean() })
    .parse(value) as Queue;
}
export function retryReceipt(
  value: unknown,
  actor?: string,
  p?: RetryIntent,
): RetryReceipt | null {
  if (value === null) return null;
  const r = retrySchema.parse(value) as RetryReceipt;
  if ((actor && r.actor_id !== actor) || r.cycle_no !== r.previous_cycle_no + 1)
    throw new Error("Retry actor or cycle differs");
  if (
    p &&
    (r.id !== p.p_id ||
      r.event_id !== p.p_event_id ||
      r.expected_work_hash !== p.p_expected_work_hash ||
      r.reason !== p.p_reason)
  )
    throw new Error("Original retry differs");
  return r;
}
export function retryPage(value: unknown, actor: string): RetryPage {
  const r = z
    .object({ retries: z.array(retrySchema), has_more: z.boolean() })
    .parse(value) as RetryPage;
  r.retries.forEach((v) => retryReceipt(v, actor));
  return r;
}
export function preview(value: unknown, eventId: string): Preview | null {
  if (value === null) return null;
  const p = z
    .object({
      event: eventSchema,
      eligible: z.boolean(),
      expected_work_hash: hash,
      history: z.array(historySchema),
      history_has_more: z.boolean(),
      retries: z.array(retrySchema),
    })
    .parse(value) as Preview;
  if (
    p.event.id !== eventId ||
    p.history.some((h) => h.event_id !== eventId) ||
    p.retries.some((r) => r.event_id !== eventId)
  )
    throw new Error("Processing preview differs");
  p.retries.forEach((r) => retryReceipt(r));
  if (
    p.eligible &&
    (p.event.state !== "review" ||
      p.event.cycle_attempts !== 10 ||
      p.event.last_error !== "provider_fetch_or_persistence_retry")
  )
    throw new Error("Contradictory retry eligibility");
  return p;
}
export const failureLabel = (value: ProcessingEvent["last_error"]) =>
  ({
    provider_content_requires_review:
      "Provider content requires separate review",
    provider_fetch_or_persistence_retry: "Provider fetch or persistence failed",
    worker_lease_expired:
      "Worker stopped before finishing; separate review required",
    legacy_review_required: "Legacy failure requires separate review",
  })[value ?? ""] ?? "No recorded processing error";
export const reasonLabels = {
  provider_recovered: "Provider availability restored",
  configuration_repaired: "Configuration repaired",
  processor_repaired: "Processing implementation repaired",
};
