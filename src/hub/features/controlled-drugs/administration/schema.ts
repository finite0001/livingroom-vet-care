import { z } from "zod";
import { ExactJsonNumber, protocolInteger, type ExactJson } from "../record-review/exact-json.ts";
import { administrationDigest, administrationInstant, administrationName, administrationUuid, administrationRecordVersion, freezeAdministration } from "./primitives.ts";
import { siteRegistrationDefinitionSchema } from "./site-definition.ts";
import { stockOpeningDefinitionSchema, stockPolicyRevisionDefinitionSchema } from "./opening-definition.ts";
import { reviewConfigurationDefinitionSchema, reviewConfigurationScopeSchema } from "./review-configuration-definition.ts";
import { administrationText } from "./primitives.ts";
import { reviewAdministrationDefinitionSchema } from "./review-administration-definition.ts";

export const administrationActions = ["site_register", "stock_opening", "stock_policy", "review_administration", "review_configuration"] as const;
const pointerFields = { schema_version: z.literal(1), actor_id: administrationUuid, operation_id: administrationUuid,
  action: z.enum(administrationActions), product_id: administrationUuid.nullable(), site_id: administrationUuid.nullable() };
export const administrationPointerSchema = z.object(pointerFields).strict().superRefine((value, context) => {
  const valid = value.action === "site_register" ? value.product_id === null && value.site_id === value.operation_id :
    (value.action === "stock_opening" || value.action === "stock_policy") ? value.product_id !== null && value.site_id !== null :
      value.action === "review_administration" ? value.product_id !== null && value.site_id === null : value.product_id !== null;
  if (!valid) context.addIssue({ code: "custom", message: "Administration operation scope differs." });
});
export interface AdministrationPointer extends z.infer<typeof administrationPointerSchema> {}
const requestShape = z.discriminatedUnion("action", [
  z.object({ ...pointerFields, action: z.literal("site_register"), definition: siteRegistrationDefinitionSchema }).strict(),
  z.object({ ...pointerFields, action: z.literal("stock_opening"), definition: stockOpeningDefinitionSchema }).strict(),
  z.object({ ...pointerFields, action: z.literal("stock_policy"), definition: stockPolicyRevisionDefinitionSchema }).strict(),
  z.object({ ...pointerFields, action: z.literal("review_administration"), definition: reviewAdministrationDefinitionSchema }).strict(),
  z.object({ ...pointerFields, action: z.literal("review_configuration"), definition: reviewConfigurationDefinitionSchema }).strict(),
]);
export const administrationRequestSchema = requestShape.superRefine((value, context) => {
  const pointer = Object.fromEntries(Object.keys(pointerFields).map(key => [key, value[key as keyof typeof value]]));
  if (!administrationPointerSchema.safeParse(pointer).success || (value.action === "stock_opening" || value.action === "stock_policy") && !value.definition.policy.site_ids.includes(value.site_id!) ||
    value.action === "review_configuration" && (value.product_id !== value.definition.scope.product_id || value.site_id !== value.definition.scope.site_id))
    context.addIssue({ code: "custom", message: "Administration definition does not match its scope." });
});
export type AdministrationRequest = z.infer<typeof administrationRequestSchema>;
const registrationSummary = z.object({ site: z.object({ id: administrationUuid, label: administrationName }).strict(),
  locations: z.array(z.object({ id: administrationUuid, label: administrationName, kind: z.enum(["clinic", "mobile_kit"]), initial_custodian_id: administrationUuid.nullable() }).strict()).min(1).max(256) }).strict();
const openingSummary = z.object({ product_id: administrationUuid, site_id: administrationUuid, stock_unit: administrationText(50, 200),
  opening_id: administrationUuid, policy_version: administrationRecordVersion, slot_count: z.number().int().min(1).max(512), observation_count: z.number().int().min(0).max(512) }).strict();
const policySummary = openingSummary.omit({ slot_count: true, observation_count: true });
const reviewSummary = z.object({ kind: z.enum(["administration", "policy", "eligibility", "calendar", "routing"]), scope: reviewConfigurationScopeSchema,
  version: administrationRecordVersion, record_id: administrationUuid }).strict();
export const administrationPreparationSchema = z.object({ request: administrationRequestSchema, request_digest: administrationDigest, created_at: administrationInstant, expires_at: administrationInstant,
  source_state: z.enum(["current", "changed"]), summary: z.union([registrationSummary, openingSummary, policySummary, reviewSummary]) }).strict().superRefine((value, context) => {
    const request = value.request;
    let valid = false;
    if (request.action === "site_register") {
      const parsed = registrationSummary.safeParse(value.summary);
      if (parsed.success) {
        const summary = parsed.data, identity = (item: { label?: string; kind?: string; initial_custodian_id?: string | null }) => JSON.stringify([item.label, item.kind, item.initial_custodian_id]);
        const actual = summary.locations.map(identity).sort(), expected = request.definition.locations.map(identity).sort();
        valid = summary.site.id === request.operation_id && summary.site.label === request.definition.site.label && actual.length === expected.length &&
          actual.every((item, index) => item === expected[index]) && new Set(summary.locations.map(item => item.id)).size === summary.locations.length;
      }
    } else if (request.action === "stock_opening") {
      const parsed = openingSummary.safeParse(value.summary);
      if (parsed.success) valid = parsed.data.product_id === request.product_id && parsed.data.site_id === request.site_id && parsed.data.opening_id === request.operation_id &&
        parsed.data.policy_version === "1" && parsed.data.slot_count === request.definition.placements.length && parsed.data.observation_count === request.definition.placements.filter(item => item.observed_at !== null).length;
    } else if (request.action === "stock_policy") {
      const parsed = policySummary.safeParse(value.summary);
      if (parsed.success) valid = parsed.data.product_id === request.product_id && parsed.data.site_id === request.site_id;
    } else {
      const parsed = reviewSummary.safeParse(value.summary);
      if (parsed.success) valid = parsed.data.scope.product_id === request.product_id && parsed.data.scope.site_id === request.site_id && parsed.data.record_id === request.operation_id &&
        (parsed.data.version === "1") === (request.definition.expected_predecessor_id === null) &&
        (request.action === "review_administration" ? parsed.data.kind === "administration" && parsed.data.scope.event_kind === null && parsed.data.scope.capability === null :
          parsed.data.kind === request.definition.kind && parsed.data.scope.event_kind === request.definition.scope.event_kind && parsed.data.scope.capability === request.definition.scope.capability);
    }
    if (!valid) context.addIssue({ code: "custom", message: "Administration summary differs from the retained definition." });
  });
export interface AdministrationPreparation extends z.infer<typeof administrationPreparationSchema> {}
export const administrationReceiptSchema = z.object({ ...pointerFields, request_digest: administrationDigest, preparation_id: administrationUuid,
  result_ref: z.object({ kind: z.enum(["site", "opening", "stock_policy", "configuration"]), id: administrationUuid, version: administrationRecordVersion }).strict(), recorded_at: administrationInstant, receipt_digest: administrationDigest }).strict()
  .superRefine((value, context) => {
    const kind = value.action === "site_register" ? "site" : value.action === "stock_opening" ? "opening" : value.action === "stock_policy" ? "stock_policy" : "configuration";
    if (value.preparation_id !== value.operation_id || value.result_ref.id !== value.operation_id || value.result_ref.kind !== kind ||
      (value.action === "site_register" || value.action === "stock_opening") && value.result_ref.version !== "1")
      context.addIssue({ code: "custom", message: "Administration receipt identities differ." });
  });
export interface AdministrationReceipt extends z.infer<typeof administrationReceiptSchema> {}
export const administrationReplySchema = z.object({ schema_version: z.literal(1), state: z.enum(["not_found", "prepared", "saved", "abandoned", "expired"]),
  data: z.object({ pointer: administrationPointerSchema, preparation: administrationPreparationSchema.nullable(), receipt: administrationReceiptSchema.nullable() }).strict() }).strict()
  .superRefine((value, context) => {
    const { preparation, receipt, pointer } = value.data;
    const same = (candidate: AdministrationPointer) => Object.keys(pointerFields).every(key => pointer[key as keyof AdministrationPointer] === candidate[key as keyof AdministrationPointer]);
    if ((value.state === "saved") !== (receipt !== null) || (value.state === "prepared" || value.state === "expired") && !preparation ||
      value.state === "not_found" && preparation !== null || preparation && (!same(preparation.request) || Date.parse(preparation.expires_at) - Date.parse(preparation.created_at) !== 15 * 60000 ||
        preparation.created_at.slice(20, 26) !== preparation.expires_at.slice(20, 26)) || receipt && (!same(receipt) || !preparation || receipt.request_digest !== preparation.request_digest))
      context.addIssue({ code: "custom", message: "Administration result differs from its original operation." });
  });
export interface AdministrationReply extends z.infer<typeof administrationReplySchema> {}
export function administrationProtocolValue(value: ExactJson): unknown {
  if (value instanceof ExactJsonNumber) return protocolInteger(value, 0, 2147483647);
  if (Array.isArray(value)) return value.map(administrationProtocolValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, administrationProtocolValue(child)]));
  return value;
}
export function parseAdministrationReply(value: ExactJson, original: AdministrationPointer): Readonly<AdministrationReply> {
  const pointer = administrationPointerSchema.parse(original), result = administrationReplySchema.parse(administrationProtocolValue(value));
  if (Object.keys(pointerFields).some(key => pointer[key as keyof AdministrationPointer] !== result.data.pointer[key as keyof AdministrationPointer])) throw new Error("Administration response belongs to another operation.");
  return freezeAdministration(result);
}
