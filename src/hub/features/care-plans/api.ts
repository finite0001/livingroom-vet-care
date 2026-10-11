import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import {
  templateValuesSchema, planValuesSchema, completionValuesSchema, policyValuesSchema,
  templateSchema, planSchema, completionReceiptSchema, policyReceiptSchema,
  templatePageSchema, planPageSchema, displaySchema, sourceCursorSchema, sourcePageSchema,
  previewSchema, historyPageSchema, duePageSchema, dueCursorSchema, windowSchema, sourceSchema,
  type TemplateValues, type PlanValues, type CompletionValues, type DeliveryPolicyValues, type CompletionSource,
} from "./model";
const uuid = z.string().uuid();
const version = z.number().int().positive().nullable();
interface CareRpc {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}
const db = supabase as unknown as CareRpc;
export async function careRpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw error;
  return data;
}
export async function templatesPage(after: string | null = null) {
  return templatePageSchema.parse(await careRpc("list_recurring_care_templates", { p_after: uuid.nullable().parse(after), p_limit: 50 }));
}
export async function readTemplate(id: string) {
  return templateSchema.nullable().parse(await careRpc("read_recurring_care_template", { p_id: uuid.parse(id) }));
}
export async function patientPlansPage(petId: string, after: string | null = null) {
  return planPageSchema.parse(await careRpc("list_patient_care_plans", { p_pet_id: uuid.parse(petId), p_after: uuid.nullable().parse(after), p_limit: 50 }));
}
export async function readPlan(id: string, petId: string) {
  const data = displaySchema.nullable().parse(await careRpc("read_patient_care_plan", { p_plan_id: uuid.parse(id), p_pet_id: uuid.parse(petId) }));
  if (data && (data.plan.id !== id || data.plan.pet_id !== petId)) throw new Error("Care plan identity changed");
  return data;
}
export async function completionSources(petId: string, planId: string, kind: "service" | "vaccine" | "lab" | null, before: z.infer<typeof sourceCursorSchema> | null) {
  return sourcePageSchema.parse(await careRpc("list_care_completion_sources", {
    p_pet_id: uuid.parse(petId), p_plan_id: uuid.parse(planId), p_source_kind: z.enum(["service", "vaccine", "lab"]).nullable().parse(kind),
    p_before: sourceCursorSchema.nullable().parse(before), p_limit: 50,
  }));
}
export async function previewCompletion(planId: string, petId: string, expectedVersion: number, source: CompletionSource) {
  const values = sourceSchema.parse(source);
  if (values.pet_id !== petId) throw new Error("Completed care belongs to another patient");
  const result = previewSchema.parse(await careRpc("preview_care_plan_completion", {
    p_plan_id: uuid.parse(planId), p_pet_id: uuid.parse(petId), p_expected_version: version.parse(expectedVersion),
    p_source_kind: values.source_kind, p_source_id: values.id, p_source_version: values.source_version,
  }));
  if (result.source.id !== values.id || result.source.pet_id !== petId || result.source.source_kind !== values.source_kind
    || result.source.source_version !== values.source_version) throw new Error("Completed care identity changed");
  return result;
}
export async function careHistory(planId: string, petId: string, before: number | null) {
  return historyPageSchema.parse(await careRpc("list_care_plan_history", {
    p_plan_id: uuid.parse(planId), p_pet_id: uuid.parse(petId), p_before_version: version.parse(before), p_limit: 20,
  }));
}
export async function duePage(filter: string, before: z.infer<typeof dueCursorSchema> | null) {
  return duePageSchema.parse(await careRpc("list_recurring_care_due", {
    p_filter: z.enum(["upcoming", "overdue", "all", "review"]).parse(filter), p_before: dueCursorSchema.nullable().parse(before), p_limit: 50,
  }));
}
export async function deliveryWindows() {
  return z.array(windowSchema).max(2).parse(await careRpc("list_care_plan_delivery_windows", {}));
}
export type CareActionKind = "template" | "plan" | "completion" | "delivery_policy";
export interface CareAction {
  kind: CareActionKind;
  entityId: string;
  petId: string | null;
  expectedVersion: number | null;
  values: TemplateValues | PlanValues | CompletionValues | DeliveryPolicyValues;
}
export function validateAction(action: CareAction): CareAction {
  const kind = z.enum(["template", "plan", "completion", "delivery_policy"]).parse(action.kind);
  const values = kind === "template" ? templateValuesSchema.parse(action.values)
    : kind === "plan" ? planValuesSchema.parse(action.values)
    : kind === "completion" ? completionValuesSchema.parse(action.values) : policyValuesSchema.parse(action.values);
  const petId = uuid.nullable().parse(action.petId);
  if ((kind === "plan" || kind === "completion") && !petId) throw new Error("Patient required");
  return { kind, entityId: uuid.parse(action.entityId), petId, expectedVersion: version.parse(action.expectedVersion), values };
}
function receiptSchema(kind: CareActionKind) {
  return kind === "template" ? templateSchema : kind === "plan" ? planSchema : kind === "completion" ? completionReceiptSchema : policyReceiptSchema;
}
export async function saveCareAction(actionId: string, submitted: CareAction) {
  const action = validateAction(submitted);
  const args: Record<string, unknown> = { p_action_id: uuid.parse(actionId), p_expected_version: action.expectedVersion, p_request: action.values };
  args[action.kind === "completion" ? "p_plan_id" : "p_id"] = action.entityId;
  if (action.petId) args.p_pet_id = action.petId;
  const names = { template: "save_recurring_care_template", plan: "save_patient_care_plan", completion: "complete_patient_care_plan", delivery_policy: "save_care_plan_delivery_policy" };
  return receiptSchema(action.kind).parse(await careRpc(names[action.kind], args));
}
export async function readCareAction(actionId: string, submitted: CareAction) {
  const action = validateAction(submitted);
  return receiptSchema(action.kind).nullable().parse(await careRpc("read_care_workflow_action", {
    p_action_id: uuid.parse(actionId), p_kind: action.kind, p_entity_id: action.entityId, p_pet_id: action.petId,
    p_request: { expected_version: action.expectedVersion, values: action.values },
  }));
}
