import { z } from "zod";
import { administrationStaffRoleList, administrationText, administrationUuid } from "./primitives.ts";
export const reviewAdministrationCapabilities = ["audit", "manage_eligibility", "manage_escalation", "publish_calendar", "publish_policy", "publish_routing"] as const;
export const reviewAdministrationMemberSchema = z.object({ actor_id: administrationUuid, roles: administrationStaffRoleList,
  capabilities: z.array(z.enum(reviewAdministrationCapabilities)).max(6).refine(values => values.every((value, index) => index === 0 || values[index - 1] < value)) }).strict();
export const reviewAdministrationMembersSchema = z.array(reviewAdministrationMemberSchema).max(100).refine(values => values.every((value, index) => index === 0 || values[index - 1].actor_id < value.actor_id));
export const reviewAdministrationDefinitionSchema = z.object({ expected_predecessor_id: administrationUuid.nullable(), enabled: z.boolean(),
  members: reviewAdministrationMembersSchema, approval_reference: administrationText(200, 800),
}).strict().refine(value => !value.enabled || value.members.length > 0);
export interface ReviewAdministrationDefinition extends z.infer<typeof reviewAdministrationDefinitionSchema> {}
