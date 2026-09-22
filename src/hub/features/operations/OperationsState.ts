import { z } from "zod";
const count = z.number().int().nonnegative().safe();
const time = z.string().refine((v) => Number.isFinite(Date.parse(v)));
// SQL retains microseconds; comparing only Date.parse would round away evidence.
function micros(value: string) {
  const fraction = value.match(/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/i)?.[1] ?? "";
  return (
    BigInt(Date.parse(value)) * BigInt(1000) +
    BigInt(fraction.padEnd(6, "0").slice(3, 6))
  );
}
const id = z.string().uuid();
const label = z.string().regex(/^[a-z][a-z0-9_]{0,79}$/);
export const runSchema = z
  .object({
    run_id: id,
    requested_limit: z.number().int().min(1).max(100),
    started_at: time,
    outcome: z.enum(["started", "completed", "failed"]),
    finished_at: time.nullable(),
    counts: z
      .object({
        queued: count,
        blocked: count,
        skipped: count,
        dispatched: z.literal(false),
      })
      .nullable(),
    failure_code: z.literal("queue_transaction_rolled_back").nullable(),
  })
  .superRefine((r, ctx) => {
    if (
      (r.finished_at !== null &&
        micros(r.finished_at) < micros(r.started_at)) ||
      (r.counts !== null &&
        r.counts.queued + r.counts.blocked + r.counts.skipped >
          r.requested_limit) ||
      (r.outcome === "started" &&
        (r.finished_at !== null ||
          r.counts !== null ||
          r.failure_code !== null)) ||
      (r.outcome === "completed" &&
        (!r.finished_at || !r.counts || r.failure_code !== null)) ||
      (r.outcome === "failed" &&
        (!r.finished_at ||
          r.counts !== null ||
          r.failure_code !== "queue_transaction_rolled_back"))
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Contradictory run evidence",
      });
  });
export const overviewSchema = z.object({
  observed_at: time,
  outbox: z.object({
    pending: count,
    expired_claims: count,
    uncertain: count,
    failed: count,
    oldest_pending_at: time.nullable(),
  }),
  inbound: z.object({ processing_review: count, unassigned: count }),
  stripe: z.object({
    queued: count,
    processing: count,
    quarantined: count,
    oldest_unfinished_at: time.nullable(),
  }),
  reminders: z.object({
    candidate_count: count,
    blocked_handoffs: count,
    oldest_candidate_at: time.nullable(),
    last_run: runSchema.nullable(),
    last_completed_at: time.nullable(),
    unresolved_runs: count,
  }),
});
export const outboxSchema = z.object({
  id,
  conversation_id: id,
  client_id: id.nullable(),
  message_id: id,
  channel: z.enum(["EMAIL", "SMS"]),
  state: z.enum([
    "pending",
    "claimed",
    "accepted",
    "delivered",
    "failed",
    "uncertain",
  ]),
  reason: z
    .enum([
      "worker_lease_expired",
      "idempotency_window_expired",
      "recipient_suppressed",
      "recipient_or_actor_ineligible",
      "processing_review_required",
    ])
    .nullable(),
  created_at: time,
  updated_at: time,
  attempt_count: count,
  lease_expired: z.boolean(),
  first_attempt_at: time.nullable(),
  accepted_at: time.nullable(),
  delivered_at: time.nullable(),
  delivery_failure_kind: z.enum(["bounced", "complained"]).nullable(),
});
export const candidateSchema = z.object({
  cursor_key: z.string().min(1).max(1000),
  job_kind: label,
  job_id: id.nullable(),
  policy_id: id,
  source_id: id,
  source_kind: label,
  source_version: count,
  template_id: id,
  template_version: count,
  pet_id: id.nullable(),
  channel: z.enum(["EMAIL", "SMS"]),
  eligible_at: time,
});
export const blockSchema = z.object({
  source_kind: z.enum(["lab", "vaccine", "appointment"]).nullable(),
  source_id: id.nullable(),
  pet_id: id.nullable(),
  appointment_id: id.nullable(),
  job_kind: label,
  job_id: id,
  policy_id: id,
  outbox_id: id.nullable(),
  state: label,
  reason: z.enum([
    "final_preflight_source_or_recipient_ineligible",
    "final_preflight_recipient_or_actor_ineligible",
    "reminder_handoff_blocked",
  ]),
  created_at: time,
  invalidated_at: time.nullable(),
});
export const schedulerJobSchema = z
  .object({
    job: z.enum([
      "dispatch-outbox",
      "process-inbound",
      "process-stripe-events",
      "queue-reminders",
      "cleanup-abandoned-attachment",
    ]),
    requested_at: time,
    outcome: z.enum(["dispatched", "ok", "failed", "configuration_missing"]),
    status_code: z.number().int().nullable(),
    error_message: z.string().nullable(),
    stale: z.boolean(),
  })
  .superRefine((j, ctx) => {
    // The same rule the database enforces on the outcome it records: a job that
    // has not been answered yet carries no status, and "ok" means a 2xx.
    if (
      (j.outcome === "ok" &&
        (j.status_code === null ||
          j.status_code < 200 ||
          j.status_code > 299 ||
          j.error_message !== null)) ||
      (j.outcome === "configuration_missing" &&
        (j.status_code !== null || j.error_message === null)) ||
      (j.outcome === "dispatched" && j.status_code !== null)
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Contradictory scheduler evidence",
      });
  });
export const schedulerStatusSchema = z.object({
  observed_at: time,
  jobs: z.array(schedulerJobSchema).max(20),
});
export interface Cursor {
  at?: string;
  id?: string;
  kind?: string;
  key?: string;
}
export function pageSchema<T extends z.ZodTypeAny>(item: T, observed = true) {
  const schema = z.object({
    items: z.array(item).max(100),
    has_more: z.boolean(),
    observed_at: observed ? time : time.optional(),
  });
  return {
    parse(value: unknown) {
      const result = schema.parse(value);
      return {
        items: result.items,
        has_more: result.has_more,
        observed_at: result.observed_at,
      };
    },
  };
}
export function conversationLink(idValue: string) {
  return `/hub/conversation/${id.parse(idValue)}`;
}
export function householdLink(idValue: string) {
  return `/hub/client/${id.parse(idValue)}`;
}
export function patientLink(idValue: string) {
  return `/hub/patient/${id.parse(idValue)}`;
}
export function displayTime(value: string | null) {
  return value
    ? `${new Date(value).toLocaleString("en-US", { timeZone: "America/Denver" })} Mountain`
    : "Not recorded";
}
