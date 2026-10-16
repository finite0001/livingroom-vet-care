import { z } from "zod";
const uuid = z.string().uuid();
export const policySchema = z
  .object({
    enabled: z.boolean(),
    default_due_days: z.number().int().min(0).max(365),
    offset_days: z
      .array(z.number().int().min(1).max(365))
      .min(1)
      .max(12)
      .refine(
        (v) => v.every((n, i) => i === 0 || n > v[i - 1]),
        "Reminder days must be unique and ascending.",
      ),
    email_subject: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .refine((s) => !/[\r\n]/.test(s)),
    email_body: z.string().trim().min(1).max(6000),
    sms_body: z.string().trim().min(1).max(800),
    practice_contact: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .refine((s) => !/[{}]/.test(s)),
  })
  .strict()
  .superRefine((p, ctx) => {
    for (const key of ["email_subject", "email_body", "sms_body"] as const) {
      if (
        /[{}]/.test(
          p[key].replace(
            /\{\{(invoice_reference|amount_due|due_date|practice_contact)\}\}/g,
            "",
          ),
        )
      )
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: "Use only the supported invoice placeholders.",
        });
    }
  });
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(v + "T12:00:00Z");
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "Enter a valid due date.");
export const termsSchema = z
  .object({
    due_on: calendarDate,
    enabled: z.boolean(),
    channel: z.enum(["EMAIL", "SMS"]),
    hold_kind: z.enum(["none", "paused", "disputed", "bereavement"]),
    hold_reason: z.string().trim().max(1000),
  })
  .strict()
  .refine(
    (t) => (t.hold_kind === "none" ? !t.hold_reason : Boolean(t.hold_reason)),
    "A hold requires a reason; remove the reason when resuming.",
  );
export const defaultPolicy: z.infer<typeof policySchema> = {
  enabled: false,
  default_due_days: 0,
  offset_days: [7, 14, 30],
  email_subject: "The Living Room Vet: unpaid invoice {{invoice_reference}}",
  email_body:
    "Our records show an unpaid balance of ${{amount_due}} for invoice reference {{invoice_reference}}, due on {{due_date}}. Please contact {{practice_contact}} to arrange payment. If you recently paid, please contact us so we can review the payment.",
  sms_body:
    "The Living Room Vet: invoice {{invoice_reference}} has an unpaid balance of ${{amount_due}}, due {{due_date}}. Please contact {{practice_contact}} to arrange payment.",
  practice_contact: "admin@thelivingroom.vet",
};
export const detailSchema = z.object({
  invoice_id: uuid,
  client_id: uuid,
  policy: z
    .object({
      id: uuid,
      version: z.number().int().positive(),
      actor_id: uuid,
      definition: policySchema,
    })
    .passthrough()
    .nullable(),
  terms: z
    .object({
      id: uuid,
      version: z.number().int().positive(),
      due_on: calendarDate,
      enabled: z.boolean(),
      channel: z.enum(["EMAIL", "SMS"]),
      hold_kind: z.enum(["none", "paused", "disputed", "bereavement"]),
      hold_reason: z.string(),
    })
    .passthrough()
    .nullable(),
  context: z
    .object({
      amount_cents: z.string().regex(/^\d+$/),
      offset_days: z.number().int().nullable(),
      reason: z.string().nullable(),
      subject: z.string().nullable(),
      body: z.string().nullable(),
    })
    .passthrough(),
  history: z.array(
    z.object({
      id: uuid,
      created_at: z.string(),
      offset_days: z.number(),
      amount_cents: z.string().regex(/^\d+$/),
      state: z.string(),
      last_error: z.string().nullable(),
      attempt_count: z.number(),
      accepted_at: z.string().nullable(),
      delivered_at: z.string().nullable(),
      outbox_id: uuid,
    }),
  ),
  scheduler: z.object({
    cron_active: z.boolean(),
    last_run: z.string().nullable(),
  }),
  has_more: z.boolean(),
});
export const practicePolicySchema = z
  .object({
    actor_id: uuid,
    policy: detailSchema.shape.policy,
    scheduler: detailSchema.shape.scheduler,
  })
  .strict();
export function policyFromDraft(
  policy: z.infer<typeof policySchema>,
  days: string,
) {
  const offsets = days.split(",").map((v) => v.trim());
  if (offsets.some((v) => !/^\d+$/.test(v)))
    throw new Error("Enter comma-separated whole overdue days.");
  return policySchema.parse({ ...policy, offset_days: offsets.map(Number) });
}
export function proposedDueDate(issuedAt: string | null, days: number): string {
  const time = issuedAt ? new Date(issuedAt) : new Date();
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Denver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(time);
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export const reminderReason: Record<string, string> = {
  not_enrolled: "Not enrolled",
  invoice_not_issued: "Invoice is not issued",
  invoice_reminders_off: "Off for this invoice",
  practice_reminders_off: "Practice automation is off",
  approver_inactive: "Approver access needs review",
  paid_or_credited: "No unpaid balance",
  balance_requires_review: "Balance needs review",
  payment_reconciliation: "Payment needs reconciliation",
  payment_pending: "Payment confirmation pending",
  refund_pending: "Refund pending",
  not_due: "No reminder is due yet",
  contact_or_consent_unavailable: "Contact or consent unavailable",
  paused: "Paused",
  disputed: "Disputed",
  bereavement: "Bereavement hold",
};
