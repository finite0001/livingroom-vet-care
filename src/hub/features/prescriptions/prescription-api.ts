import { z } from "zod";
import type { PrescriptionOperation } from "./prescription-state.ts";
const uuid = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), revision = z.number().int().min(1).max(2147483647);
const instant = z.string().datetime({ offset: true }).refine(v => Number.isFinite(Date.parse(v)) && !/\.\d{7}/.test(v));
const text = (max: number) => z.string().min(1).refine(v => Array.from(v).length <= max).refine(v => v === v.trim() && ![...v].some(c => { const n = c.charCodeAt(0); return (n < 32 && n !== 9 && n !== 10) || n === 127; }));
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => Number.isFinite(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v);
const quantity = z.string().regex(/^(?:0|[1-9]\d{0,10})(?:\.\d{1,3})?$/).refine(v => /[1-9]/.test(v));
export const prescriptionMedicationSchema = z.object({ name: text(200), strength: text(200), form: text(100), directions: text(4000), route: text(100) }).strict();
export const prescriptionFieldsSchema = z.object({ encounter_id: uuid.nullable(), medication: prescriptionMedicationSchema, quantity_per_fill: quantity, unit: text(50), refills_authorized: z.number().int().min(0).max(1000), fulfillment_mode: z.enum(["practice_stock", "external_pharmacy"]), product_id: uuid.nullable(), starts_on: day, expires_on: day }).strict().refine(v => v.expires_on >= v.starts_on && (v.fulfillment_mode === "practice_stock" ? v.product_id !== null : v.product_id === null));
export const prescriberFieldsSchema = z.object({ active: z.boolean(), license_number: text(100), license_state: text(100), license_expires_on: day, practice_name: text(200), practice_address: text(1000), practice_phone: text(100).nullable(), clinical_review_note: text(2000) }).strict();
const configurationSchema = z.object({ user_id: uuid, version: revision, fields: prescriberFieldsSchema, configured_by: uuid, configured_at: instant }).strict();
const draftSchema = z.object({ id: uuid, pet_id: uuid, client_id: uuid, version: revision, fields: prescriptionFieldsSchema, status: z.enum(["draft", "signed"]), authorization_id: uuid.nullable(), created_by: uuid, updated_by: uuid, created_at: instant, updated_at: instant }).strict().refine(v => (v.status === "draft") === (v.authorization_id === null) && /^\d+\.\d{3}$/.test(v.fields.quantity_per_fill));
const alertSchema = z.object({ source_hash: hash, snapshot: z.object({ schema_version: z.literal(1), pet_id: uuid, patient_version: revision, important_problems: z.array(z.object({ id: uuid, version: revision, title: z.string(), notes: z.string(), status: z.enum(["active", "resolved"]), importance: z.literal("high"), onset_date: day.nullable(), updated_at: instant }).strict()), legacy_allergies: z.object({ text: z.string().nullable(), provenance: z.string().min(1) }).strict() }).strict() }).strict();
const signContextSchema = z.object({ version: z.literal(1), draft: draftSchema, patient: z.object({ id: uuid, version: revision, name: text(200), species: text(100) }).strict(), household: z.object({ id: uuid, version: revision, name: text(200), address: z.string() }).strict(), prescriber: z.object({ user_id: uuid, name: text(200), configuration: configurationSchema }).strict(), product: z.object({ id: uuid, version: revision, name: text(200), unit: text(50) }).strict().nullable(), alerts: alertSchema }).strict();
const artifactSchema = z.object({ schema_version: z.literal(1), authorization_id: uuid, authorization_hash: hash, signed_at: instant, signature_name: text(200), patient: z.object({ id: uuid, name: text(200), species: text(100) }).strict(), household: z.object({ id: uuid, name: text(200), address: z.string() }).strict(), prescriber: z.object({ user_id: uuid, name: text(200), license_number: text(100), license_state: text(100), practice_name: text(200), practice_address: text(1000), practice_phone: text(100).nullable() }).strict(), medication: prescriptionMedicationSchema, quantity_per_fill: quantity, unit: text(50), refills_authorized: z.number().int().min(0).max(1000), fulfillment_mode: z.enum(["practice_stock", "external_pharmacy"]), starts_on: day, expires_on: day }).strict();
const authorizationSchema = z.object({ id: uuid, pet_id: uuid, client_id: uuid, draft_id: uuid, draft_version: revision, signed_by: uuid, signed_at: instant, context_hash: hash, context: signContextSchema, authorization_hash: hash, artifact: artifactSchema }).strict();
const configureRequestSchema = z.object({ user_id: uuid, expected_version: revision.nullable(), fields: prescriberFieldsSchema, attest_review: z.literal(true) }).strict();
const saveRequestSchema = z.object({ draft_id: uuid, pet_id: uuid, client_id: uuid, expected_version: revision.nullable(), fields: prescriptionFieldsSchema }).strict();
const signRequestSchema = z.object({ draft_id: uuid, pet_id: uuid, expected_version: revision, expected_context_hash: hash, signature_name: text(200), attest_review: z.literal(true) }).strict();
const usageV1Schema = z.object({ version: z.literal(1), native_fill_accounting: z.literal("not_implemented"), dispensed_quantity: z.null(), used_fill_slots: z.null(), remaining_quantity: z.null(), external_fulfillment: z.literal("unknown") }).strict();
const aggregateQuantitySchema = z.string().regex(/^(?:0|[1-9]\d{0,14})\.\d{3}$/);
const slotQuantitySchema = z.string().regex(/^(?:0|[1-9]\d{0,10})\.\d{3}$/);
function quantityMilli(value: string): bigint { return BigInt(value.replace(".", "")); }
export const prescriptionUsageV2Schema = z.object({ version: z.literal(2), native_fill_accounting: z.literal("implemented"), dispensed_quantity: aggregateQuantitySchema, used_fill_slots: z.number().int().min(0).max(1001), remaining_quantity: aggregateQuantitySchema.nullable(), forfeited_quantity: aggregateQuantitySchema, unopened_fill_slots: z.number().int().min(0).max(1001).nullable(), allowance_basis: z.enum(["native_practice_stock", "external_unknown"]), open_slot: z.object({ id: uuid, index: z.number().int().min(0).max(1000), version: revision, remaining_quantity: slotQuantitySchema.refine(v => quantityMilli(v) > 0n) }).strict().nullable(), fulfillment_head: z.object({ event_id: uuid.nullable(), version: z.number().int().min(0).max(2147483647) }).strict(), external_fulfillment: z.literal("unknown") }).strict().refine(v => {
  if ((v.fulfillment_head.event_id === null) !== (v.fulfillment_head.version === 0)) return false;
  if (!v.used_fill_slots && (quantityMilli(v.dispensed_quantity) !== 0n || quantityMilli(v.forfeited_quantity) !== 0n || v.open_slot !== null || v.fulfillment_head.version !== 0)) return false;
  if (v.used_fill_slots && (v.fulfillment_head.version < v.used_fill_slots || quantityMilli(v.dispensed_quantity) === 0n)) return false;
  if (v.allowance_basis === "external_unknown") return v.remaining_quantity === null && v.unopened_fill_slots === null && v.open_slot === null;
  return v.remaining_quantity !== null && v.unopened_fill_slots !== null && v.used_fill_slots + v.unopened_fill_slots <= 1001 && (!v.open_slot || (v.open_slot.index === v.used_fill_slots - 1 && quantityMilli(v.remaining_quantity) >= quantityMilli(v.open_slot.remaining_quantity)));
});
export const prescriptionUsageSchema = z.union([usageV1Schema, prescriptionUsageV2Schema]);
export function validatePrescriptionUsage(usage: z.infer<typeof prescriptionUsageSchema>, prior: PrescriptionAuthorization): void {
  if (usage.version === 1) return; // Immutable pre-ledger receipts retain their unknown accounting.
  const a = prior.artifact;
  if (a.fulfillment_mode === "external_pharmacy") { if (usage.allowance_basis !== "external_unknown") throw new Error("External allowance is unknown"); return; }
  const slots = a.refills_authorized + 1, maximum = quantityMilli(normalizedPrescriptionQuantity(a.quantity_per_fill));
  if (usage.allowance_basis !== "native_practice_stock" || usage.unopened_fill_slots === null || usage.remaining_quantity === null || usage.used_fill_slots + usage.unopened_fill_slots !== slots || (usage.open_slot !== null && quantityMilli(usage.open_slot.remaining_quantity) >= maximum) || quantityMilli(usage.remaining_quantity) !== maximum * BigInt(usage.unopened_fill_slots) + (usage.open_slot ? quantityMilli(usage.open_slot.remaining_quantity) : 0n) || quantityMilli(usage.dispensed_quantity) + quantityMilli(usage.forfeited_quantity) + quantityMilli(usage.remaining_quantity) !== maximum * BigInt(slots)) throw new Error("Native allowance accounting differs");
}
const usageSchema = prescriptionUsageSchema;
const printStatusSchema = z.object({ authorization_id: uuid, authorization_hash: hash, checked_at: instant, state: z.enum(["active", "expired", "cancelled", "replaced"]), reason: text(2000).nullable(), replacement_id: uuid.nullable() }).strict().refine(v => (v.state === "replaced") === (v.replacement_id !== null) && (["cancelled", "replaced"].includes(v.state) === (v.reason !== null)));
const headSchema = z.object({ id: uuid.nullable(), version: z.number().int().min(0).max(2147483647), state: z.enum(["active", "expired", "cancelled", "replaced"]), reason: text(2000).nullable(), replacement_id: uuid.nullable() }).strict().refine(v => (v.id === null) === (v.version === 0) && (v.state === "replaced") === (v.replacement_id !== null) && (["cancelled", "replaced"].includes(v.state) === (v.reason !== null)) && (["active", "expired"].includes(v.state) === (v.id === null)));
const changeContextSchema = z.object({ version: z.literal(1), authorization: authorizationSchema, head: headSchema, patient_current: z.object({ id: uuid, client_id: uuid, version: revision, archived_at: instant.nullable(), deceased_at: day.nullable() }).strict(), prescriber: signContextSchema.shape.prescriber, alerts: alertSchema, usage: usageSchema }).strict();
const replacementContextSchema = z.object({ version: z.literal(1), prior: changeContextSchema, new_sign: signContextSchema, new_sign_context_hash: hash }).strict();
export const prescriptionChangeReasonSchema = text(2000);
export const reconciliationSchema = z.object({ native_use_note: text(2000), external_use_status: z.enum(["unknown", "reconciled"]), external_use_note: text(2000), remaining_allowance_note: text(2000), attest_review: z.literal(true) }).strict();
const cancelRequestSchema = z.object({ authorization_id: uuid, pet_id: uuid, expected_event_id: uuid.nullable(), expected_context_hash: hash, reason: text(2000), attest_review: z.literal(true) }).strict();
const replaceRequestSchema = cancelRequestSchema.extend({ draft_id: uuid, expected_version: revision, signature_name: text(200), reconciliation: reconciliationSchema }).strict();
const eventCommon = { version: z.literal(1), id: uuid, authorization_id: uuid, authorization_hash: hash, pet_id: uuid, prior_event_id: uuid.nullable(), event_version: revision, actor_id: uuid, reason: text(2000), reviewed_context_hash: hash, record_hash: hash, created_at: instant };
const eventSchema = z.discriminatedUnion("action", [z.object({ ...eventCommon, action: z.literal("cancel"), replacement_id: z.null(), reviewed_context: changeContextSchema, reconciliation: z.null() }).strict(), z.object({ ...eventCommon, action: z.literal("replace"), replacement_id: uuid, reviewed_context: replacementContextSchema, reconciliation: reconciliationSchema }).strict()]);
const changePreviewSchema = z.object({ version: z.literal(1), actor_id: uuid, pet_id: uuid, context: changeContextSchema, context_hash: hash, observed_at: instant }).strict();
const replacementPreviewSchema = changePreviewSchema.extend({ context: replacementContextSchema }).strict();
const currentStatusSchema = z.object({ version: z.literal(1), pet_id: uuid, status: printStatusSchema, head_id: uuid.nullable(), head_version: z.number().int().min(0).max(2147483647), usage: usageSchema }).strict();
const commonReceipt = { version: z.literal(1), id: uuid, actor_id: uuid, request_hash: hash, created_at: instant };
const receiptSchema = z.discriminatedUnion("operation", [
  z.object({ ...commonReceipt, operation: z.literal("configure_prescriber"), pet_id: z.null(), request: configureRequestSchema, result: configurationSchema }).strict(),
  z.object({ ...commonReceipt, operation: z.literal("save_draft"), pet_id: uuid, request: saveRequestSchema, result: draftSchema }).strict(),
  z.object({ ...commonReceipt, operation: z.literal("sign"), pet_id: uuid, request: signRequestSchema, result: authorizationSchema }).strict(),
  z.object({ ...commonReceipt, operation: z.literal("cancel"), pet_id: uuid, request: cancelRequestSchema, result: eventSchema }).strict(),
  z.object({ ...commonReceipt, operation: z.literal("replace"), pet_id: uuid, request: replaceRequestSchema, result: z.object({ authorization: authorizationSchema, event: eventSchema }).strict() }).strict(),
]);
const cursorSchema = z.object({ before_at: instant, before_id: uuid }).strict();
const entrySchema = z.object({ user_id: uuid, name: z.string(), active_staff: z.boolean(), has_dvm_role: z.boolean(), configuration: configurationSchema.nullable(), eligible: z.boolean() }).strict();
export interface PrescriptionCurrentStatus extends z.infer<typeof currentStatusSchema> {}
export interface PrescriptionChangePreview extends z.infer<typeof changePreviewSchema> {}
export interface PrescriptionReplacementPreview extends z.infer<typeof replacementPreviewSchema> {}
export interface PrescriptionReconciliation extends z.infer<typeof reconciliationSchema> {}
export type PrescriptionEvent = z.infer<typeof eventSchema>;
export interface PrescriptionFields extends z.infer<typeof prescriptionFieldsSchema> {}
export interface PrescriberFields extends z.infer<typeof prescriberFieldsSchema> {}
export interface PrescriptionDraft extends z.infer<typeof draftSchema> {}
export interface PrescriberEntry extends z.infer<typeof entrySchema> {}
export interface PrescriptionAuthorization extends z.infer<typeof authorizationSchema> {}
export interface PrescriptionCursor extends z.infer<typeof cursorSchema> {}
export interface PrescriptionSignPreview extends z.infer<typeof signPreviewSchema> {}
export interface PrescriptionRpc { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> }
export type PrescriptionReceipt = z.infer<typeof receiptSchema>;
const signPreviewSchema = z.object({ version: z.literal(1), actor_id: uuid, draft_id: uuid, pet_id: uuid, context: signContextSchema, context_hash: hash, observed_at: instant }).strict();
function canonical(value: unknown): string { return JSON.stringify(value && typeof value === "object" ? Array.isArray(value) ? value.map(v => JSON.parse(canonical(v))) : Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, JSON.parse(canonical(v))])) : value); }
function same(a: unknown, b: unknown) { return canonical(a) === canonical(b); }
export function normalizedPrescriptionQuantity(value: string): string { quantity.parse(value); const [whole, fraction = ""] = value.split("."); return `${whole}.${fraction.padEnd(3, "0")}`; }
function contextIdentity(context: z.infer<typeof signContextSchema>) {
  const { draft: d, patient: p, household: h, prescriber: s, product, alerts } = context;
  if (d.status !== "draft" || d.pet_id !== p.id || d.client_id !== h.id || s.user_id !== s.configuration.user_id || !s.configuration.fields.active || alerts.snapshot.pet_id !== p.id || alerts.snapshot.patient_version !== p.version || (d.fields.fulfillment_mode === "practice_stock" ? !product || product.id !== d.fields.product_id || product.unit !== d.fields.unit : product !== null)) throw new Error("Signing context identity differs");
}
function authorization(value: unknown, patientId: string, authorizationId: string): PrescriptionAuthorization {
  const r = authorizationSchema.parse(value), c = r.context, a = r.artifact;
  contextIdentity(c);
  const fields = c.draft.fields, conf = c.prescriber.configuration.fields;
  if (r.id !== authorizationId || r.pet_id !== patientId || r.client_id !== c.household.id || r.pet_id !== c.patient.id || r.draft_id !== c.draft.id || r.draft_version !== c.draft.version || r.signed_by !== c.prescriber.user_id ||
    a.authorization_id !== r.id || a.authorization_hash !== r.authorization_hash || a.signed_at !== r.signed_at || a.signature_name !== c.prescriber.name || !same(a.patient, { id: c.patient.id, name: c.patient.name, species: c.patient.species }) || !same(a.household, { id: c.household.id, name: c.household.name, address: c.household.address }) ||
    !same(a.prescriber, { user_id: c.prescriber.user_id, name: c.prescriber.name, license_number: conf.license_number, license_state: conf.license_state, practice_name: conf.practice_name, practice_address: conf.practice_address, practice_phone: conf.practice_phone }) ||
    !same(a.medication, fields.medication) || a.quantity_per_fill !== normalizedPrescriptionQuantity(fields.quantity_per_fill) || a.unit !== fields.unit || a.refills_authorized !== fields.refills_authorized || a.fulfillment_mode !== fields.fulfillment_mode || a.starts_on !== fields.starts_on || a.expires_on !== fields.expires_on) throw new Error("Signed authorization snapshot differs");
  return r;
}
function changeIdentity(context: z.infer<typeof changeContextSchema>, patientId: string, authorizationId: string) {
  authorization(context.authorization, patientId, authorizationId);
  validatePrescriptionUsage(context.usage, context.authorization);
  if (context.patient_current.id !== patientId || context.alerts.snapshot.pet_id !== patientId || context.alerts.snapshot.patient_version !== context.patient_current.version || context.prescriber.user_id !== context.prescriber.configuration.user_id || !context.prescriber.configuration.fields.active) throw new Error("Change context identity differs");
}
function replacementIdentity(context: z.infer<typeof replacementContextSchema>, patientId: string, authorizationId: string) {
  changeIdentity(context.prior, patientId, authorizationId); contextIdentity(context.new_sign);
  if (context.new_sign.patient.id !== patientId || context.new_sign.household.id !== context.prior.authorization.client_id || context.new_sign.household.id !== context.prior.patient_current.client_id || context.new_sign.patient.version !== context.prior.patient_current.version || !same(context.new_sign.prescriber, context.prior.prescriber) || !same(context.new_sign.alerts, context.prior.alerts)) throw new Error("Replacement context identity differs");
}
function eventIdentity(event: PrescriptionEvent, patientId: string, authorizationId: string) {
  const context = event.action === "cancel" ? event.reviewed_context : event.reviewed_context.prior;
  if (event.action === "cancel") changeIdentity(context, patientId, authorizationId); else replacementIdentity(event.reviewed_context, patientId, authorizationId);
  if (event.authorization_id !== authorizationId || event.pet_id !== patientId || event.authorization_hash !== context.authorization.authorization_hash || event.actor_id !== context.prescriber.user_id || event.prior_event_id !== context.head.id || event.event_version !== context.head.version + 1 || !["active", "expired"].includes(context.head.state) || (event.action === "replace" && (event.replacement_id !== event.id || (context.authorization.artifact.fulfillment_mode === "external_pharmacy" && event.reconciliation.external_use_status !== "reconciled")))) throw new Error("Authorization event identity differs");
}
function micros(value: string): bigint { const fraction = /\.(\d+)(?:Z|[+-]\d{2}:?\d{2})$/.exec(value)?.[1] ?? ""; return BigInt(Date.parse(value)) * 1000n + BigInt(fraction.padEnd(6, "0").slice(3)); }
export function createPrescriptionApi(client: PrescriptionRpc, actor: string, patientId: string) {
  uuid.parse(actor); uuid.parse(patientId);
  async function rpc(name: string, args: Record<string, unknown>) { const { data, error } = await client.rpc(name, args); if (error) throw error; return data; }
  function parseOperation(operation: Readonly<PrescriptionOperation>) {
    uuid.parse(operation.id);
    if (operation.kind === "configure_prescriber") return configureRequestSchema.parse(operation.payload);
    const request = operation.kind === "save_draft" ? saveRequestSchema.parse(operation.payload) : operation.kind === "sign" ? signRequestSchema.parse(operation.payload) : operation.kind === "cancel" ? cancelRequestSchema.parse(operation.payload) : operation.kind === "replace" ? replaceRequestSchema.parse(operation.payload) : null;
    if (!request || request.pet_id !== patientId) throw new Error("Prescription operation target differs");
    return request;
  }
  function receipt(value: unknown, operation: Readonly<PrescriptionOperation>) {
    const request = parseOperation(operation), r = receiptSchema.parse(value);
    if (r.id !== operation.id || r.actor_id !== actor || r.operation !== operation.kind || !same(r.request, request) || r.pet_id !== (r.operation === "configure_prescriber" ? null : patientId)) throw new Error("Prescription operation receipt differs");
    if (r.operation === "configure_prescriber") {
      if (r.result.user_id !== r.request.user_id || r.result.configured_by !== actor || r.result.version !== (r.request.expected_version ?? 0) + 1 || !same(r.result.fields, r.request.fields)) throw new Error("Prescriber configuration receipt differs");
    } else if (r.operation === "save_draft") {
      if (r.result.id !== r.request.draft_id || r.result.pet_id !== patientId || r.result.client_id !== r.request.client_id || r.result.status !== "draft" || r.result.updated_by !== actor || r.result.version !== (r.request.expected_version ?? 0) + 1 || (r.request.expected_version === null && r.result.created_by !== actor) || !same(r.result.fields, { ...r.request.fields, quantity_per_fill: normalizedPrescriptionQuantity(r.request.fields.quantity_per_fill) })) throw new Error("Saved draft receipt differs");
    } else if (r.operation === "sign") {
      authorization(r.result, patientId, r.id);
      if (r.result.signed_by !== actor || r.result.context_hash !== r.request.expected_context_hash || r.result.draft_id !== r.request.draft_id || r.result.draft_version !== r.request.expected_version || r.result.artifact.signature_name !== r.request.signature_name) throw new Error("Signed operation receipt differs");
    } else {
      const event = r.operation === "cancel" ? r.result : r.result.event;
      eventIdentity(event, patientId, r.request.authorization_id);
      if (event.id !== r.id || event.actor_id !== actor || event.action !== r.operation || event.prior_event_id !== r.request.expected_event_id || event.reviewed_context_hash !== r.request.expected_context_hash || event.reason !== r.request.reason) throw new Error("Changed authorization receipt differs");
      if (r.operation === "replace") {
        if (r.result.event.action !== "replace") throw new Error("Replacement event required");
        const replacement = authorization(r.result.authorization, patientId, r.id);
        if (replacement.draft_id !== r.request.draft_id || replacement.draft_version !== r.request.expected_version || replacement.signed_by !== actor || replacement.artifact.signature_name !== r.request.signature_name || replacement.context_hash !== r.result.event.reviewed_context.new_sign_context_hash || !same(replacement.context, r.result.event.reviewed_context.new_sign) || !same(r.result.event.reconciliation, r.request.reconciliation)) throw new Error("Atomic replacement receipt differs");
      }
    }
    return r;
  }
  return {
    async execute(operation: Readonly<PrescriptionOperation>) { const request = parseOperation(operation); const names = { configure_prescriber: "configure_native_prescriber", save_draft: "save_native_prescription_draft", sign: "sign_native_prescription", cancel: "cancel_native_prescription", replace: "replace_native_prescription" }; return receipt(await rpc(names[operation.kind as keyof typeof names], { p_id: operation.id, p_request: request }), operation); },
    async recover(operation: Readonly<PrescriptionOperation>) { parseOperation(operation); const result = await rpc("recover_native_prescription_operation", { p_id: operation.id }); return result === null ? null : receipt(result, operation); },
    async readDraft(id: string) { uuid.parse(id); const result = await rpc("read_native_prescription_draft", { p_id: id, p_pet_id: patientId }); if (result === null) return null; const d = draftSchema.parse(result); if (d.id !== id || d.pet_id !== patientId) throw new Error("Draft identity differs"); return d; },
    async readAuthorization(id: string) { uuid.parse(id); const result = await rpc("read_native_prescription_authorization", { p_id: id, p_pet_id: patientId }); return result === null ? null : authorization(result, patientId, id); },
    async preview(draft: PrescriptionDraft) { if (draft.pet_id !== patientId || draft.status !== "draft") throw new Error("Unsigned patient draft required"); const result = signPreviewSchema.parse(await rpc("preview_native_prescription_sign", { p_draft_id: draft.id, p_expected_version: draft.version })); contextIdentity(result.context); if (result.actor_id !== actor || result.pet_id !== patientId || result.draft_id !== draft.id || result.context.prescriber.user_id !== actor || !same(result.context.draft, draft)) throw new Error("Signing preview differs from saved draft"); return result; },
    async previewCancel(prior: PrescriptionAuthorization) {
      authorization(prior, patientId, prior.id);
      const result = changePreviewSchema.parse(await rpc("preview_native_prescription_cancel", { p_authorization_id: prior.id, p_pet_id: patientId }));
      changeIdentity(result.context, patientId, prior.id);
      if (result.actor_id !== actor || result.pet_id !== patientId || result.context.prescriber.user_id !== actor || !same(result.context.authorization, prior)) throw new Error("Cancellation preview differs"); return result;
    },
    async previewReplacement(prior: PrescriptionAuthorization, draft: PrescriptionDraft) {
      authorization(prior, patientId, prior.id); if (draft.pet_id !== patientId || draft.status !== "draft") throw new Error("Unsigned patient draft required");
      const result = replacementPreviewSchema.parse(await rpc("preview_native_prescription_replacement", { p_authorization_id: prior.id, p_pet_id: patientId, p_draft_id: draft.id, p_expected_version: draft.version }));
      replacementIdentity(result.context, patientId, prior.id);
      if (result.actor_id !== actor || result.pet_id !== patientId || result.context.prior.prescriber.user_id !== actor || !same(result.context.prior.authorization, prior) || !same(result.context.new_sign.draft, draft)) throw new Error("Replacement preview differs"); return result;
    },
    async readStatus(prior: PrescriptionAuthorization) {
      authorization(prior, patientId, prior.id);
      const result = await rpc("read_native_prescription_status", { p_authorization_id: prior.id, p_pet_id: patientId }); if (result === null) return null;
      const parsed = currentStatusSchema.parse(result), status = parsed.status;
      validatePrescriptionUsage(parsed.usage, prior);
      if (parsed.pet_id !== patientId || status.authorization_id !== prior.id || status.authorization_hash !== prior.authorization_hash || (parsed.head_id === null) !== (parsed.head_version === 0) || (["active", "expired"].includes(status.state) !== (parsed.head_id === null))) throw new Error("Current prescription status differs"); return parsed;
    },
    async readPrint(prior: PrescriptionAuthorization) {
      authorization(prior, patientId, prior.id);
      const result = z.object({ prescription: artifactSchema, status: printStatusSchema, dispense: z.null() }).strict().parse(await rpc("read_native_prescription_print", { p_authorization_id: prior.id, p_dispense_id: null }));
      if (!same(result.prescription, prior.artifact) || result.status.authorization_id !== prior.id || result.status.authorization_hash !== prior.authorization_hash) throw new Error("Print copy differs from signed authorization"); return result;
    },
    async listEvents(prior: PrescriptionAuthorization, cursor: PrescriptionCursor | null = null, limit = 20) {
      authorization(prior, patientId, prior.id); if (cursor) cursorSchema.parse(cursor); z.number().int().min(1).max(100).parse(limit);
      const page = z.object({ version: z.literal(1), pet_id: uuid, authorization_id: uuid, events: z.array(eventSchema).max(100), has_more: z.boolean(), next_cursor: cursorSchema.nullable() }).strict().parse(await rpc("list_native_prescription_events", { p_authorization_id: prior.id, p_pet_id: patientId, p_before_at: cursor?.before_at ?? null, p_before_id: cursor?.before_id ?? null, p_limit: limit }));
      if (page.pet_id !== patientId || page.authorization_id !== prior.id || page.events.length > limit) throw new Error("Event history target differs");
      let previous = cursor; const ids = new Set<string>();
      for (const event of page.events) { eventIdentity(event, patientId, prior.id); if (event.authorization_hash !== prior.authorization_hash || ids.has(event.id) || (previous && !(micros(event.created_at) < micros(previous.before_at) || (micros(event.created_at) === micros(previous.before_at) && event.id < previous.before_id)))) throw new Error("Event history order differs"); previous = { before_at: event.created_at, before_id: event.id }; ids.add(event.id); }
      if (page.has_more !== !!page.next_cursor || (page.has_more && (page.events.length !== limit || !same(page.next_cursor, previous)))) throw new Error("Event continuation differs"); return page;
    },
    async listDrafts(cursor: PrescriptionCursor | null = null, limit = 20) {
      if (cursor) cursorSchema.parse(cursor); z.number().int().min(1).max(100).parse(limit);
      const page = z.object({ version: z.literal(1), pet_id: uuid, drafts: z.array(draftSchema).max(100), has_more: z.boolean(), next_cursor: cursorSchema.nullable() }).strict().parse(await rpc("list_native_prescription_drafts", { p_pet_id: patientId, p_before_at: cursor?.before_at ?? null, p_before_id: cursor?.before_id ?? null, p_limit: limit }));
      if (page.pet_id !== patientId || page.drafts.length > limit) throw new Error("Draft list patient differs");
      let previous = cursor; const ids = new Set<string>();
      for (const d of page.drafts) { if (d.pet_id !== patientId || ids.has(d.id) || (previous && !(micros(d.created_at) < micros(previous.before_at) || (micros(d.created_at) === micros(previous.before_at) && d.id < previous.before_id)))) throw new Error("Draft list order differs"); previous = { before_at: d.created_at, before_id: d.id }; ids.add(d.id); }
      if (page.has_more !== !!page.next_cursor || (page.has_more && (page.drafts.length !== limit || !same(page.next_cursor, previous)))) throw new Error("Draft continuation differs"); return page;
    },
    async listPrescribers(after: string | null = null, limit = 20) {
      if (after) uuid.parse(after); z.number().int().min(1).max(100).parse(limit);
      const page = z.object({ version: z.literal(1), entries: z.array(entrySchema).max(100), has_more: z.boolean(), next_after_id: uuid.nullable() }).strict().parse(await rpc("list_native_prescribers", { p_after_id: after, p_limit: limit }));
      let previous = after;
      for (const e of page.entries) { if ((previous && e.user_id <= previous) || (e.configuration && e.configuration.user_id !== e.user_id) || (e.eligible && (!e.active_staff || !e.has_dvm_role || !e.configuration?.fields.active))) throw new Error("Prescriber entry differs"); previous = e.user_id; }
      if (page.entries.length > limit || page.has_more !== !!page.next_after_id || (page.has_more && (page.entries.length !== limit || page.next_after_id !== previous))) throw new Error("Prescriber continuation differs"); return page;
    },
  };
}
export interface PrescriptionApi extends ReturnType<typeof createPrescriptionApi> {}

export { authorization as parsePrescriptionAuthorization, artifactSchema as nativePrescriptionArtifactSchema, alertSchema as prescriptionAlertSchema, printStatusSchema as nativePrescriptionStatusSchema };
