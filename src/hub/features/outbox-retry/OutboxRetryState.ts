import { z } from "zod";
const id = z.string().uuid(),
  hash = z.string().regex(/^[a-f0-9]{64}$/),
  count = z.number().int().nonnegative().safe(),
  time = z.string().refine((v) => Number.isFinite(Date.parse(v)));
export const reasons = {
  configuration_repaired: "Configuration repaired",
  recipient_reverified: "Recipient reverified",
  source_reverified: "Source reverified",
};
const reason = z.enum([
  "configuration_repaired",
  "recipient_reverified",
  "source_reverified",
]);
export const intentSchema = z
  .object({
    p_id: id,
    p_outbox_id: id,
    p_expected_work_hash: hash,
    p_reason: reason,
    p_attest: z.literal(true),
  })
  .strict();
export const storedIntentSchema = z
  .object({ intent: intentSchema, reviewed_revision: count })
  .strict();
export interface RetryIntent {
  p_id: string;
  p_outbox_id: string;
  p_expected_work_hash: string;
  p_reason: keyof typeof reasons;
  p_attest: true;
}
export const actionSchema = z
  .object({
    id,
    actor_id: id,
    outbox_id: id,
    expected_work_hash: hash,
    reason,
    previous_revision: count,
    queued_revision: count,
    created_at: time,
  })
  .refine((r) => r.queued_revision === r.previous_revision + 1);
export interface RetryAction {
  id: string;
  actor_id: string;
  outbox_id: string;
  expected_work_hash: string;
  reason: keyof typeof reasons;
  previous_revision: number;
  queued_revision: number;
  created_at: string;
}
export const outboxSchema = z.object({
  id,
  conversation_id: id,
  client_id: id,
  message_id: id,
  created_by: id,
  channel: z.enum(["EMAIL", "SMS"]),
  state: z.enum([
    "pending",
    "claimed",
    "accepted",
    "delivered",
    "failed",
    "uncertain",
  ]),
  provider: z.enum(["resend", "twilio"]),
  created_at: time,
  updated_at: time,
  revision: count,
  attempt_count: count,
  reason: z
    .enum([
      "worker_lease_expired",
      "idempotency_window_expired",
      "recipient_suppressed",
      "recipient_or_actor_ineligible",
      "processing_review_required",
    ])
    .nullable(),
});
export const labels = {
  eligible_for_requeue: "Eligible to return to the queue",
  not_failed: "Only failed work can be reviewed here",
  provider_evidence_requires_reconciliation:
    "Provider evidence requires separate reconciliation",
  original_actor_unavailable: "Original staff member is unavailable",
  recipient_or_conversation_changed: "Recipient or conversation changed",
  recipient_suppressed: "Recipient is suppressed",
  source_ineligible: "Original source is ineligible",
  source_association_ambiguous: "Source association requires separate review",
};
const previewSchema = z.object({
  outbox: outboxSchema,
  eligible: z.boolean(),
  reason: z.enum([
    "eligible_for_requeue",
    "not_failed",
    "provider_evidence_requires_reconciliation",
    "original_actor_unavailable",
    "recipient_or_conversation_changed",
    "recipient_suppressed",
    "source_ineligible",
    "source_association_ambiguous",
  ]),
  expected_work_hash: hash,
  source: z.object({
    family: z.enum([
      "message",
      "reminder",
      "invoice_email",
      "release_email",
      "document_link",
      "payment_delivery",
    ]),
    source_id: id.nullable(),
    eligible: z.boolean(),
  }),
  history: z.array(actionSchema).max(100),
  history_has_more: z.boolean(),
});
export interface Preview {
  outbox: z.infer<typeof outboxSchema>;
  eligible: boolean;
  reason: keyof typeof labels;
  expected_work_hash: string;
  source: { family: string; source_id: string | null; eligible: boolean };
  history: RetryAction[];
  history_has_more: boolean;
}
export interface ActionPage {
  items: RetryAction[];
  has_more: boolean;
}
export function action(
  value: unknown,
  actor: string,
  requestId: string,
  intent?: RetryIntent,
): RetryAction | null {
  if (value === null) return null;
  const r = actionSchema.parse(value) as RetryAction;
  if (
    r.actor_id !== actor ||
    r.id !== requestId ||
    (intent &&
      (r.outbox_id !== intent.p_outbox_id ||
        r.expected_work_hash !== intent.p_expected_work_hash ||
        r.reason !== intent.p_reason ||
        r.id !== intent.p_id))
  )
    throw new Error("Original retry differs");
  return r;
}
export function preview(
  value: unknown,
  outboxId: string,
  actor: string,
): Preview | null {
  if (value === null) return null;
  const p = previewSchema.parse(value) as Preview;
  if (
    p.outbox.id !== outboxId ||
    p.history.some((r) => r.actor_id !== actor || r.outbox_id !== outboxId)
  )
    throw new Error("Review target differs");
  if (
    p.eligible &&
    (p.reason !== "eligible_for_requeue" ||
      p.outbox.state !== "failed" ||
      p.outbox.attempt_count !== 0 ||
      !p.source.eligible)
  )
    throw new Error("Contradictory eligibility");
  return p;
}
export function actions(value: unknown, actor: string): ActionPage {
  const page = z
    .object({ items: z.array(actionSchema).max(100), has_more: z.boolean() })
    .parse(value) as ActionPage;
  page.items.forEach((r) => action(r, actor, r.id));
  return page;
}
export function outboxId(value: string) {
  return id.parse(value);
}
