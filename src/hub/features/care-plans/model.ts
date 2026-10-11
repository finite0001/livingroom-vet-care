import { z } from "zod";
import { calendarDateSchema, recurrenceSchema, intervalUnitSchema, anchorModeSchema, monthEndSchema } from "./calendar.ts";
const uuid = z.string().uuid();
const instant = z.string().datetime({ offset: true });
const review = z.string().trim().min(1, "Record your review").max(2000);
export const careKindSchema = z.enum(["wellness", "bloodwork", "vaccine", "custom"]);
export const planStatusSchema = z.enum(["proposed", "current", "paused", "retired"]);
export const kindLabels = { wellness: "Wellness", bloodwork: "Bloodwork", vaccine: "Vaccine follow-up", custom: "Custom care" };
export const statusLabels = { proposed: "Awaiting veterinarian review", current: "Reviewed current", paused: "Paused", retired: "Retired" };
export const templateValuesSchema = z.object({
  care_key: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/, "Use a short care key with lowercase letters, numbers or hyphens"),
  name: z.string().trim().min(1, "Enter a care name").max(160),
  care_kind: careKindSchema,
  interval_amount: z.number().int().positive(),
  interval_unit: intervalUnitSchema,
  anchor_mode: anchorModeSchema,
  month_end: monthEndSchema,
  active: z.boolean(),
  review_note: review,
}).strict().superRefine((values, ctx) => {
  const result = recurrenceSchema.safeParse(values);
  if (!result.success) for (const issue of result.error.issues) ctx.addIssue({ ...issue });
});
export interface TemplateValues extends z.infer<typeof templateValuesSchema> {}
export const templateSchema = z.object({
  id: uuid, care_key: z.string(), name: z.string(), care_kind: careKindSchema,
  interval_amount: z.number().int().positive(), interval_unit: intervalUnitSchema,
  anchor_mode: anchorModeSchema, month_end: monthEndSchema, active: z.boolean(),
  review_note: z.string(), version: z.number().int().positive(), approved_by: uuid, approved_at: instant,
}).strict();
export interface CareTemplate extends z.infer<typeof templateSchema> {}
export const planValuesSchema = z.object({
  template_id: uuid, template_version: z.number().int().positive(), name: z.string().trim().min(1).max(160),
  interval_amount: z.number().int().positive(), interval_unit: intervalUnitSchema,
  anchor_mode: anchorModeSchema, month_end: monthEndSchema, anchor_on: calendarDateSchema, due_on: calendarDateSchema,
  status: planStatusSchema, reminders_enabled: z.boolean(), override_reason: z.string().trim().max(2000),
  review_note: review, replace_anchor_evidence: z.boolean(),
}).strict().superRefine((values, ctx) => {
  const result = recurrenceSchema.safeParse(values);
  if (!result.success) for (const issue of result.error.issues) ctx.addIssue({ ...issue });
  if (values.due_on <= values.anchor_on) ctx.addIssue({ code: "custom", path: ["due_on"], message: "Due date must follow the calendar anchor" });
  if (values.replace_anchor_evidence && !values.override_reason) ctx.addIssue({ code: "custom", path: ["override_reason"], message: "Explain the reviewed replacement baseline" });
});
export interface PlanValues extends z.infer<typeof planValuesSchema> {}
export const planSchema = z.object({
  id: uuid, pet_id: uuid, template_id: uuid, template_version: z.number().int().positive(), template_snapshot: templateSchema,
  care_key: z.string(), name: z.string(), care_kind: careKindSchema,
  interval_amount: z.number().int().positive(), interval_unit: intervalUnitSchema, anchor_mode: anchorModeSchema, month_end: monthEndSchema,
  anchor_on: calendarDateSchema, cycle_index: z.number().int().positive(), due_on: calendarDateSchema,
  status: planStatusSchema, reminders_enabled: z.boolean(), override_reason: z.string(), review_note: z.string(),
  approved_by: uuid.nullable(), approved_at: instant.nullable(), last_completion_id: uuid.nullable(), occurrence_id: uuid,
  version: z.number().int().positive(), created_by: uuid, updated_by: uuid, created_at: instant, updated_at: instant,
}).strict();
export interface CarePlan extends z.infer<typeof planSchema> {}
export const displaySchema = z.object({
  plan: planSchema, patient_name: z.string(), patient_inactive: z.boolean(), reminder_reason: z.string(), next_send_at: instant.nullable(),
}).strict();
export interface CarePlanDisplay extends z.infer<typeof displaySchema> {}
export const sourceKindSchema = z.enum(["service", "vaccine", "lab"]);
export const sourceSchema = z.object({
  source_kind: sourceKindSchema, id: uuid, pet_id: uuid, completed_on: calendarDateSchema,
  source_version: z.number().int().positive(), label: z.string(), at: instant,
}).strict();
export interface CompletionSource extends z.infer<typeof sourceSchema> {}
export const sourceCursorSchema = z.object({ at: instant, source_kind: sourceKindSchema, id: uuid }).strict();
export const dueCursorSchema = z.object({ due_on: calendarDateSchema, id: uuid }).strict();
export const completionValuesSchema = z.object({
  source_kind: sourceKindSchema, source_id: uuid, source_version: z.number().int().positive(), review_note: review,
}).strict();
export interface CompletionValues extends z.infer<typeof completionValuesSchema> {}
export const previewSchema = z.object({
  source: sourceSchema, completed_on: calendarDateSchema, next_due_on: calendarDateSchema,
  next_anchor_on: calendarDateSchema, next_cycle_index: z.number().int().positive(),
}).strict();
export const completionSchema = z.object({
  id: uuid, plan_id: uuid, pet_id: uuid, plan_version: z.number().int().positive(),
  source_kind: sourceKindSchema, source_id: uuid, source_version: z.number().int().positive(), source_snapshot: sourceSchema,
  completed_on: calendarDateSchema, next_due_on: calendarDateSchema, review_note: z.string(), created_by: uuid, created_at: instant,
}).strict();
export const completionReceiptSchema = z.object({ plan: planSchema, completion: completionSchema }).strict();
export const historyRowSchema = z.object({
  version: z.number().int().positive(), snapshot: planSchema, actor_id: uuid.nullable(), recorded_at: instant, completion: completionSchema.nullable(),
}).strict();
export const windowSchema = z.object({
  policy_id: uuid, start_minute: z.number().int().min(0).max(1439), end_minute: z.number().int().min(1).max(1440),
}).strict().refine(value => value.end_minute > value.start_minute, "Send-window end must follow its start");
export const policyValuesSchema = z.object({
  channel: z.enum(["EMAIL", "SMS"]), message_template_id: uuid, message_template_version: z.number().int().positive(),
  subject: z.string().max(300), enabled: z.boolean(), review_note: review,
  start_minute: z.number().int().min(0).max(1439), end_minute: z.number().int().min(1).max(1440),
}).strict().refine(value => value.end_minute > value.start_minute, "Send-window end must follow its start");
export interface DeliveryPolicyValues extends z.infer<typeof policyValuesSchema> {}
export const policySchema = z.object({
  id: uuid, source_kind: z.literal("care_plan"), channel: z.enum(["EMAIL", "SMS"]),
  message_template_id: uuid, message_template_version: z.number().int().positive(), subject: z.string(), enabled: z.boolean(),
  review_note: z.string(), version: z.number().int().positive(), approved_by: uuid, approved_at: instant,
}).strict();
export const policyReceiptSchema = z.object({ policy: policySchema, window: windowSchema }).strict();
export const templatePageSchema = z.object({ rows: z.array(templateSchema).max(100), next: uuid.nullable() }).strict();
export const planPageSchema = z.object({ rows: z.array(displaySchema).max(100), next: uuid.nullable() }).strict();
export const sourcePageSchema = z.object({ rows: z.array(sourceSchema).max(100), next: sourceCursorSchema.nullable() }).strict();
export const duePageSchema = z.object({ rows: z.array(displaySchema).max(100), next: dueCursorSchema.nullable() }).strict();
export const historyPageSchema = z.object({ rows: z.array(historyRowSchema).max(100), next: z.number().int().positive().nullable() }).strict();

export function planValues(plan: CarePlan): PlanValues {
  return {
    template_id: plan.template_id, template_version: plan.template_version, name: plan.name,
    interval_amount: plan.interval_amount, interval_unit: plan.interval_unit, anchor_mode: plan.anchor_mode, month_end: plan.month_end,
    anchor_on: plan.anchor_on, due_on: plan.due_on, status: plan.status, reminders_enabled: plan.reminders_enabled,
    override_reason: plan.override_reason, review_note: "", replace_anchor_evidence: false,
  };
}
export function planCycle(plan: CarePlan | null, values: PlanValues): number {
  return plan && plan.anchor_on === values.anchor_on && plan.interval_amount === values.interval_amount && plan.interval_unit === values.interval_unit
    && plan.anchor_mode === values.anchor_mode && plan.month_end === values.month_end ? plan.cycle_index : 1;
}
export function sourceKindFor(kind: CarePlan["care_kind"]) {
  return kind === "wellness" ? "service" : kind === "bloodwork" ? "lab" : kind === "vaccine" ? "vaccine" : null;
}
