import { z } from "zod";
import { reviewEventKindSchema } from "../record-review/queue-model.ts";
import { administrationInstant, administrationStaffRoleList, administrationText, administrationUuid } from "./primitives.ts";
import { sourceReviewPolicyRules } from "./review-policy-grammar.ts";
export const reviewConfigurationKinds = ["policy", "eligibility", "calendar", "routing"] as const;
export const reviewConfigurationScopeSchema = z.object({ product_id: administrationUuid, site_id: administrationUuid.nullable(), event_kind: reviewEventKindSchema.nullable(),
  capability: z.enum(["read", "review", "exception_read"]).nullable() }).strict();
export interface ReviewConfigurationScope extends z.infer<typeof reviewConfigurationScopeSchema> {}
export const reviewMemberSchema = z.object({ actor_id: administrationUuid, roles: administrationStaffRoleList }).strict();
export const reviewMembersSchema = z.array(reviewMemberSchema).max(100).refine(values => values.every((value, index) => index === 0 || values[index - 1].actor_id < value.actor_id));
export const reviewPolicyRuleSchema = z.object({ enabled: z.boolean(), adapter_version: z.literal(1), meaning: z.literal("independent_record_review_v1"), quorum: z.literal(1),
  deadline_mode: z.enum(["not_configured", "next_staffed_day_close"]), deadline_anchor: z.enum(["observed_at", "recorded_at"]),
  escalation_mode: z.enum(["not_configured", "overdue", "immediate_on_record"]) }).strict();
export interface ReviewPolicyRule extends z.infer<typeof reviewPolicyRuleSchema> {}
export type NativeDeadlineKind = "record_native_dispense" | "record_native_pickup" | null;
export function sourceReviewPolicyRule(eventKind: z.infer<typeof reviewEventKindSchema>, enabled: boolean, nativeKind: NativeDeadlineKind): ReviewPolicyRule {
  const row = sourceReviewPolicyRules.find(item => item.event_kind === eventKind && item.enabled === enabled && item.native_deadline_kind === nativeKind);
  if (!row || !row.valid_selected_kind_enabled) throw new Error("The selected native deadline action must be enabled.");
  return reviewPolicyRuleSchema.parse({ enabled: row.enabled, adapter_version: row.adapter_version, meaning: row.meaning, quorum: row.quorum,
    deadline_mode: row.deadline_mode, deadline_anchor: row.deadline_anchor, escalation_mode: row.escalation_mode });
}
export const reviewPolicyBodySchema = z.object({ effective_from: z.object({ mode: z.enum(["now", "at"]), at: administrationInstant.nullable() }).strict().refine(value => (value.mode === "now") === (value.at === null)),
  calendar_id: administrationUuid.nullable(), routing_id: administrationUuid.nullable(), native_deadline_kind: z.enum(["record_native_dispense", "record_native_pickup"]).nullable(),
  rules: z.record(reviewEventKindSchema, reviewPolicyRuleSchema),
}).strict().superRefine((value, context) => {
  if (Object.keys(value.rules).length !== reviewEventKindSchema.options.length) { context.addIssue({ code: "custom", message: "Every record kind needs an explicit review rule." }); return; }
  for (const kind of reviewEventKindSchema.options) {
    const actual = value.rules[kind]!;
    try {
      const expected = sourceReviewPolicyRule(kind, actual.enabled, value.native_deadline_kind);
      if (Object.keys(expected).some(key => expected[key as keyof ReviewPolicyRule] !== actual[key as keyof ReviewPolicyRule])) throw new Error("Rule differs");
    } catch { context.addIssue({ code: "custom", message: "Review timing and escalation must match the original source rule." }); }
    if (actual.deadline_mode === "next_staffed_day_close" && value.calendar_id === null || actual.escalation_mode !== "not_configured" && value.routing_id === null)
      context.addIssue({ code: "custom", message: "The selected rules need actual published calendar and routing records." });
  }
});
export interface ReviewPolicyBody extends z.infer<typeof reviewPolicyBodySchema> {}
export const calendarDateSchema = z.string().regex(/^(20[2-9][0-9]|2100)-\d\d-\d\d$/).refine(value => value >= "2026-01-01" && Number.isFinite(Date.parse(value + "T00:00:00Z")) && new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value);
export const calendarZoneSchema = z.string().regex(/^[A-Za-z0-9_+./-]{1,100}$/).refine(value => value === "UTC" || value.includes("/") && !value.startsWith("posix/") && !value.startsWith("right/"));
export const calendarClockSchema = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/);
export const calendarBoundaryInstantSchema = z.string().regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/).refine(value => Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 23) === value.slice(0, 23) && value >= "2025-12-31T00:00:00.000000Z" && value <= "2101-01-02T00:00:00.000000Z");
export const reviewCalendarDaySchema = z.object({ date: calendarDateSchema, staffed: z.boolean(), start_utc: calendarBoundaryInstantSchema, end_utc: calendarBoundaryInstantSchema,
  close_local: calendarClockSchema.nullable(), close_fold: z.union([z.literal(0), z.literal(1)]).nullable(), close_utc: calendarBoundaryInstantSchema.nullable() }).strict().refine(value =>
    value.end_utc > value.start_utc && (value.staffed ? value.close_local !== null && value.close_fold !== null && value.close_utc !== null && value.close_utc > value.start_utc && value.close_utc < value.end_utc :
      value.close_local === null && value.close_fold === null && value.close_utc === null));
export const reviewCalendarBodySchema = z.object({ zone: calendarZoneSchema, first_date: calendarDateSchema, last_date: calendarDateSchema, days: z.array(reviewCalendarDaySchema).min(1).max(31) }).strict()
  .superRefine((value, context) => {
    const span = (Date.parse(value.last_date + "T00:00:00Z") - Date.parse(value.first_date + "T00:00:00Z")) / 86400000;
    if (!Number.isInteger(span) || span < 0 || span > 30 || value.days.length !== span + 1 || value.days.some((day, index) =>
      day.date !== new Date(Date.parse(value.first_date + "T00:00:00Z") + index * 86400000).toISOString().slice(0, 10) || index > 0 && value.days[index - 1].end_utc !== day.start_utc))
      context.addIssue({ code: "custom", message: "Calendar days must cover the complete consecutive date range." });
  });
export interface ReviewCalendarBody extends z.infer<typeof reviewCalendarBodySchema> {}
const common = { scope: reviewConfigurationScopeSchema, expected_predecessor_id: administrationUuid.nullable(), enabled: z.boolean(), approval_reference: administrationText(200, 800) };
export const reviewConfigurationDefinitionSchema = z.discriminatedUnion("kind", [
  z.object({ ...common, kind: z.literal("eligibility"), body: z.object({ members: reviewMembersSchema }).strict() }).strict(),
  z.object({ ...common, kind: z.literal("routing"), body: z.object({ members: reviewMembersSchema }).strict() }).strict(),
  z.object({ ...common, kind: z.literal("policy"), body: reviewPolicyBodySchema }).strict(),
  z.object({ ...common, kind: z.literal("calendar"), body: reviewCalendarBodySchema }).strict(),
]).superRefine((value, context) => {
  const scope = value.scope;
  if (value.kind === "eligibility" ? scope.capability === "exception_read" ? scope.site_id !== null || scope.event_kind !== null :
    !["read", "review"].includes(scope.capability ?? "") || scope.site_id === null || scope.event_kind === null : scope.site_id === null || scope.event_kind !== null || scope.capability !== null)
    context.addIssue({ code: "custom", message: "Review configuration scope differs from its kind." });
  if ((value.kind === "eligibility" || value.kind === "routing") && value.enabled && !value.body.members.length)
    context.addIssue({ code: "custom", message: "Enabled access or routing needs explicit staff members." });
});
export type ReviewConfigurationDefinition = z.infer<typeof reviewConfigurationDefinitionSchema>;
