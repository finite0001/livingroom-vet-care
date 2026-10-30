import { z } from "zod";
import { administrationInstant, administrationName, administrationText, administrationUuid, administrationRecordVersion, freezeAdministration } from "./primitives.ts";
import { administrationPrincipal } from "./queries.ts";
import { administrationProtocolValue } from "./schema.ts";
import { reviewAdministrationMembersSchema } from "./review-administration-definition.ts";
import { reviewCalendarBodySchema, reviewConfigurationScopeSchema, reviewMembersSchema, reviewPolicyBodySchema } from "./review-configuration-definition.ts";
import type { ExactJson } from "../record-review/exact-json.ts";
export const administrationConfigurationKinds = ["administration", "policy", "eligibility", "calendar", "routing"] as const;
export const administrationConfigurationRequestSchema = z.object({ ...administrationPrincipal, kind: z.enum(administrationConfigurationKinds), scope: reviewConfigurationScopeSchema }).strict()
  .superRefine((value, context) => {
    const scope = value.scope;
    const valid = value.kind === "administration" ? scope.site_id === null && scope.event_kind === null && scope.capability === null :
      value.kind === "eligibility" ? scope.capability === "exception_read" ? scope.site_id === null && scope.event_kind === null :
        scope.site_id !== null && scope.event_kind !== null && ["read", "review"].includes(scope.capability ?? "") : scope.site_id !== null && scope.event_kind === null && scope.capability === null;
    if (!valid) context.addIssue({ code: "custom", message: "Configuration lookup scope differs from its kind." });
  });
export interface AdministrationConfigurationRequest extends z.infer<typeof administrationConfigurationRequestSchema> {}
const storedPolicy = reviewPolicyBodySchema.innerType().extend({ effective_from: administrationInstant }).strict().superRefine((body, context) => {
  if (!reviewPolicyBodySchema.safeParse({ ...body, effective_from: { mode: "at", at: body.effective_from } }).success) context.addIssue({ code: "custom", message: "Stored review policy differs from the original rule grammar." });
});
const body = z.union([z.object({ members: reviewAdministrationMembersSchema }).strict(), z.object({ members: reviewMembersSchema }).strict(), storedPolicy, reviewCalendarBodySchema]);
const current = z.object({ id: administrationUuid, version: administrationRecordVersion, enabled: z.boolean(), body,
  approval_reference: administrationText(200, 800), published_at: administrationInstant, publisher: z.object({ id: administrationUuid.nullable(), name: administrationName }).strict() }).strict();
export const administrationConfigurationReplySchema = z.object({ schema_version: z.literal(1), state: z.enum(["configured", "unconfigured"]), data: z.object({ kind: z.enum(administrationConfigurationKinds), scope: reviewConfigurationScopeSchema, current: current.nullable() }).strict() }).strict()
  .superRefine((value, context) => {
    if ((value.state === "configured") !== (value.data.current !== null)) context.addIssue({ code: "custom", message: "Configuration existence differs." });
    if (!value.data.current) return;
    const shape = value.data.kind === "administration" ? z.object({ members: reviewAdministrationMembersSchema }).strict() : value.data.kind === "policy" ? storedPolicy :
      value.data.kind === "calendar" ? reviewCalendarBodySchema : z.object({ members: reviewMembersSchema }).strict();
    if (!shape.safeParse(value.data.current.body).success) context.addIssue({ code: "custom", message: "Current configuration body differs from its kind." });
  });
export interface AdministrationConfiguration extends z.infer<typeof administrationConfigurationReplySchema> {}
export function parseAdministrationConfiguration(raw: ExactJson, input: unknown): Readonly<AdministrationConfiguration> {
  const request = administrationConfigurationRequestSchema.parse(input), value = administrationConfigurationReplySchema.parse(administrationProtocolValue(raw));
  if (value.data.kind !== request.kind || Object.keys(request.scope).some(key => value.data.scope[key as keyof typeof request.scope] !== request.scope[key as keyof typeof request.scope])) throw new Error("Configuration response belongs to another scope.");
  return freezeAdministration(value);
}
