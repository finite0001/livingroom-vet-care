import { z } from "zod";
import { reviewEventKindSchema } from "../record-review/queue-model.ts";
import { administrationDigest, administrationInstant, administrationName, administrationReference, administrationUuid } from "./primitives.ts";
export const stockPermissionRoles = ["ADMIN", "DVM", "STAFF"] as const;
export type StockPermissionRole = typeof stockPermissionRoles[number];
export type StockPermissionBasis = "physical_record" | "correction_assertion" | "annotation" | "discrepancy_assertion";
export function stockPermissionBasis(kind: z.infer<typeof reviewEventKindSchema>): StockPermissionBasis {
  if (kind.startsWith("record_native_dispense_return_v2:retract_")) return "correction_assertion";
  if (kind.startsWith("append_native_dispense_correction:")) return "annotation";
  if (kind.startsWith("record_native_return_discrepancy:")) return "discrepancy_assertion";
  return "physical_record";
}
export const stockPermissionRuleSchema = z.object({ enabled: z.boolean(), roles: z.array(z.enum(stockPermissionRoles)).max(3)
  .refine(values => values.every((value, index) => index === 0 || values[index - 1] < value)),
  basis: z.enum(["physical_record", "correction_assertion", "annotation", "discrepancy_assertion"]), witness: z.enum(["none", "c2_required"]), secondary_review: z.boolean(),
  location_kinds: z.array(z.enum(["clinic", "mobile_kit"])).max(2).refine(values => values.every((value, index) => index === 0 || values[index - 1] < value)),
}).strict().refine(value => !value.enabled || value.roles.length > 0 && value.location_kinds.length > 0);
export interface StockPermissionRule extends z.infer<typeof stockPermissionRuleSchema> {}
export const stockPermissionRulesSchema = z.record(reviewEventKindSchema, stockPermissionRuleSchema).superRefine((values, context) => {
  const keys = Object.keys(values);
  if (keys.length !== reviewEventKindSchema.options.length || keys.some(kind => values[kind as z.infer<typeof reviewEventKindSchema>]!.basis !== stockPermissionBasis(kind as z.infer<typeof reviewEventKindSchema>)))
    context.addIssue({ code: "custom", message: "Every stock action needs its exact source-defined permission basis." });
});
export const stockPolicyDefinitionSchema = z.object({ site_ids: z.array(administrationUuid).min(1).max(256).refine(values => values.every((value, index) => index === 0 || values[index - 1] < value)),
  permissions: stockPermissionRulesSchema, clinic_retained_return_permitted: z.boolean(), review_reference: administrationReference }).strict();
export interface StockPolicyDefinition extends z.infer<typeof stockPolicyDefinitionSchema> {}
export const openingSlotSchema = z.object({ channel: z.enum(["available", "prepared", "return_held"]), lot_id: administrationUuid,
  dispense_id: administrationUuid.nullable(), allocation_id: administrationUuid.nullable(), intake_id: administrationUuid.nullable() }).strict();
export interface OpeningSlot extends z.infer<typeof openingSlotSchema> {}
export const openingQuantitySchema = z.string().regex(/^(0|[1-9][0-9]{0,10})\.[0-9]{3}$/);
export const openingPlacementSchema = z.object({ slot: openingSlotSchema, label: administrationName, location_id: administrationUuid,
  custodian_id: administrationUuid.nullable(), status: z.enum(["onsite", "handed_off", "disposed"]), quantity: openingQuantitySchema.nullable(), observed_at: administrationInstant.nullable() }).strict()
  .refine(value => value.status === "onsite" ? value.quantity !== null && value.observed_at !== null : value.quantity === null && value.observed_at === null);
export interface OpeningPlacement extends z.infer<typeof openingPlacementSchema> {}
export function openingSlotIdentity(slot: OpeningSlot): string {
  return [slot.channel, slot.lot_id, slot.dispense_id ?? "", slot.allocation_id ?? "", slot.intake_id ?? ""].join("\0");
}
export const stockOpeningDefinitionSchema = z.object({ draft_version_id: administrationUuid, expected_basis_digest: administrationDigest,
  policy: stockPolicyDefinitionSchema, completed_at: administrationInstant, note: administrationReference,
  placements: z.array(openingPlacementSchema).min(1).max(512),
}).strict().superRefine((value, context) => {
  if (value.placements.some((item, index) => index > 0 && openingSlotIdentity(value.placements[index - 1].slot) >= openingSlotIdentity(item.slot)) ||
    value.placements.some(item => item.observed_at !== null && item.observed_at > value.completed_at))
    context.addIssue({ code: "custom", message: "Opening placements must retain the complete source order and be observed before completion." });
});
export interface StockOpeningDefinition extends z.infer<typeof stockOpeningDefinitionSchema> {}

export const stockPolicyRevisionDefinitionSchema = z.object({ draft_version_id: administrationUuid, expected_policy_version_id: administrationUuid, policy: stockPolicyDefinitionSchema, reason: administrationReference }).strict();
export interface StockPolicyRevisionDefinition extends z.infer<typeof stockPolicyRevisionDefinitionSchema> {}
