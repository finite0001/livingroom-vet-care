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
const commonReceipt = { version: z.literal(1), id: uuid, actor_id: uuid, request_hash: hash, created_at: instant };
const receiptSchema = z.discriminatedUnion("operation", [
  z.object({ ...commonReceipt, operation: z.literal("configure_prescriber"), pet_id: z.null(), request: configureRequestSchema, result: configurationSchema }).strict(),
  z.object({ ...commonReceipt, operation: z.literal("save_draft"), pet_id: uuid, request: saveRequestSchema, result: draftSchema }).strict(),
  z.object({ ...commonReceipt, operation: z.literal("sign"), pet_id: uuid, request: signRequestSchema, result: authorizationSchema }).strict(),
]);
const cursorSchema = z.object({ before_at: instant, before_id: uuid }).strict();
const entrySchema = z.object({ user_id: uuid, name: z.string(), active_staff: z.boolean(), has_dvm_role: z.boolean(), configuration: configurationSchema.nullable(), eligible: z.boolean() }).strict();
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
function micros(value: string): bigint { const fraction = /\.(\d+)(?:Z|[+-]\d{2}:?\d{2})$/.exec(value)?.[1] ?? ""; return BigInt(Date.parse(value)) * 1000n + BigInt(fraction.padEnd(6, "0").slice(3)); }
export function createPrescriptionApi(client: PrescriptionRpc, actor: string, patientId: string) {
  uuid.parse(actor); uuid.parse(patientId);
  async function rpc(name: string, args: Record<string, unknown>) { const { data, error } = await client.rpc(name, args); if (error) throw error; return data; }
  function parseOperation(operation: Readonly<PrescriptionOperation>) {
    uuid.parse(operation.id);
    if (operation.kind === "configure_prescriber") return configureRequestSchema.parse(operation.payload);
    const request = operation.kind === "save_draft" ? saveRequestSchema.parse(operation.payload) : operation.kind === "sign" ? signRequestSchema.parse(operation.payload) : null;
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
    } else {
      authorization(r.result, patientId, r.id);
      if (r.result.signed_by !== actor || r.result.context_hash !== r.request.expected_context_hash || r.result.draft_id !== r.request.draft_id || r.result.draft_version !== r.request.expected_version || r.result.artifact.signature_name !== r.request.signature_name) throw new Error("Signed operation receipt differs");
    }
    return r;
  }
  return {
    async execute(operation: Readonly<PrescriptionOperation>) { const request = parseOperation(operation); const names = { configure_prescriber: "configure_native_prescriber", save_draft: "save_native_prescription_draft", sign: "sign_native_prescription" }; return receipt(await rpc(names[operation.kind as keyof typeof names], { p_id: operation.id, p_request: request }), operation); },
    async recover(operation: Readonly<PrescriptionOperation>) { parseOperation(operation); const result = await rpc("recover_native_prescription_operation", { p_id: operation.id }); return result === null ? null : receipt(result, operation); },
    async readDraft(id: string) { uuid.parse(id); const result = await rpc("read_native_prescription_draft", { p_id: id, p_pet_id: patientId }); if (result === null) return null; const d = draftSchema.parse(result); if (d.id !== id || d.pet_id !== patientId) throw new Error("Draft identity differs"); return d; },
    async readAuthorization(id: string) { uuid.parse(id); const result = await rpc("read_native_prescription_authorization", { p_id: id, p_pet_id: patientId }); return result === null ? null : authorization(result, patientId, id); },
    async preview(draft: PrescriptionDraft) { if (draft.pet_id !== patientId || draft.status !== "draft") throw new Error("Unsigned patient draft required"); const result = signPreviewSchema.parse(await rpc("preview_native_prescription_sign", { p_draft_id: draft.id, p_expected_version: draft.version })); contextIdentity(result.context); if (result.actor_id !== actor || result.pet_id !== patientId || result.draft_id !== draft.id || result.context.prescriber.user_id !== actor || !same(result.context.draft, draft)) throw new Error("Signing preview differs from saved draft"); return result; },
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
