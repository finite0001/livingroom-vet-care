import { z } from "zod";
import type { PrescriptionOperation } from "../prescriptions/prescription-state.ts";
import type { PrescriptionRpc } from "../prescriptions/prescription-api.ts";
const uuid = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), revision = z.number().int().min(1).max(2147483647);
const instant = z.string().datetime({ offset: true }).refine(v => Number.isFinite(Date.parse(v)) && !/\.\d{7}/.test(v));
const text = (max: number) => z.string().min(1).refine(v => Array.from(v).length <= max && v === v.trim() && ![...v].some(c => { const n = c.charCodeAt(0); return (n < 32 && n !== 9 && n !== 10) || n === 127; }));
const channel = z.enum(["phone", "email", "text", "in_person", "other"]);
const refillSchema = z.object({ id: uuid, pet_id: uuid, client_id: uuid, version: revision, state: z.enum(["open", "closed", "denied"]), medication_requested: text(500), requester_note: text(4000).nullable(), channel, assigned_to: uuid.nullable(), authorization_id: uuid.nullable(), authorization_hash: hash.nullable(), created_by: uuid, created_at: instant, updated_by: uuid, updated_at: instant }).strict().refine(v => (v.authorization_id === null) === (v.authorization_hash === null));
const statusSchema = z.object({ authorization_id: uuid, authorization_hash: hash, checked_at: instant, state: z.enum(["active", "expired", "cancelled", "replaced"]), reason: text(2000).nullable(), replacement_id: uuid.nullable() }).strict().refine(v => (v.state === "replaced") === (v.replacement_id !== null) && (["cancelled", "replaced"].includes(v.state) === (v.reason !== null)));
const usageSchema = z.object({ version: z.literal(1), native_fill_accounting: z.literal("not_implemented"), dispensed_quantity: z.null(), used_fill_slots: z.null(), remaining_quantity: z.null(), external_fulfillment: z.literal("unknown") }).strict();
const readSchema = z.object({ version: z.literal(1), refill: refillSchema, head_id: uuid, current_household_id: uuid, household_matches: z.boolean(), authorization_status: statusSchema.nullable(), authorization_usage: usageSchema.nullable(), operational_only: z.literal(true) }).strict();
const linkSchema = z.object({ version: z.literal(1), refill_id: uuid, refill_version: revision, pet_id: uuid, client_id: uuid, patient_version: revision, authorization_id: uuid, authorization_hash: hash, authorization_head_id: uuid.nullable(), authorization_head_version: z.number().int().min(0).max(2147483647), authorization_state: z.enum(["active", "expired", "cancelled", "replaced"]) }).strict().refine(v => (v.authorization_head_id === null) === (v.authorization_head_version === 0));
export const refillReasonSchema = text(2000);
export const refillAuthorizationIdSchema = uuid;
export const refillCreateSchema = z.object({ refill_id: uuid, pet_id: uuid, client_id: uuid, medication_requested: text(500), requester_note: text(4000).nullable(), channel, reason: text(2000) }).strict();
export const refillTransitionSchema = z.object({ refill_id: uuid, pet_id: uuid, expected_version: revision, action: z.enum(["assign", "link", "close", "deny"]), reason: text(2000), assigned_to: uuid.nullable(), authorization_id: uuid.nullable(), expected_link_context_hash: hash.nullable() }).strict().refine(v => (v.action === "link" ? v.authorization_id !== null && v.expected_link_context_hash !== null : v.authorization_id === null && v.expected_link_context_hash === null) && (v.action === "assign" || v.assigned_to === null));
const eventSchema = z.object({ version: z.literal(1), id: uuid, refill_id: uuid, revision, action: z.enum(["create", "assign", "link", "close", "deny"]), actor_id: uuid, reason: text(2000), prior_event_id: uuid.nullable(), before: refillSchema.nullable(), after: refillSchema, link_context: linkSchema.nullable(), created_at: instant }).strict();
const receiptSchema = z.object({ version: z.literal(1), id: uuid, actor_id: uuid, request: z.union([refillCreateSchema, refillTransitionSchema]), request_hash: hash, result: eventSchema, created_at: instant }).strict();
const cursorSchema = z.object({ before_at: instant, before_id: uuid }).strict();
const previewSchema = z.object({ version: z.literal(1), actor_id: uuid, context: linkSchema, context_hash: hash, observed_at: instant }).strict();
const legacySchema = z.object({ record: z.object({ id: uuid, client_id: uuid, pet_id: uuid.nullable(), conversation_id: uuid.nullable(), medication_name: z.string().nullable(), original_message: z.string().nullable(), status: z.enum(["REQUESTED", "APPROVED", "DENIED", "READY", "PICKED_UP"]), assigned_to_id: uuid.nullable(), notes: z.string().nullable(), requested_at: instant, approved_at: instant.nullable(), ready_at: instant.nullable(), picked_up_at: instant.nullable(), created_at: instant, updated_at: instant }).strict(), client_name: z.string(), pet_name: z.string().nullable(), assigned_to_name: z.string().nullable(), read_only: z.literal(true), clinical_authority: z.literal("unverified") }).strict();
export interface LegacyRefillRead extends z.infer<typeof legacySchema> {}
export interface NativeRefill extends z.infer<typeof refillSchema> {}
export interface NativeRefillRead extends z.infer<typeof readSchema> {}
export interface NativeRefillEvent extends z.infer<typeof eventSchema> {}
export interface NativeRefillReceipt extends z.infer<typeof receiptSchema> {}
export interface NativeRefillCursor extends z.infer<typeof cursorSchema> {}
export interface NativeRefillLinkPreview extends z.infer<typeof previewSchema> {}
function canonical(value: unknown): string { return JSON.stringify(value && typeof value === "object" ? Array.isArray(value) ? value.map(v => JSON.parse(canonical(v))) : Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, JSON.parse(canonical(v))])) : value); }
function same(a: unknown, b: unknown) { return canonical(a) === canonical(b); }
function micros(v: string): bigint { const fraction = /\.(\d+)(?:Z|[+-]\d{2}:?\d{2})$/.exec(v)?.[1] ?? ""; return BigInt(Date.parse(v)) * 1000n + BigInt(fraction.padEnd(6, "0").slice(3)); }
function earlier(at: string, id: string, before: NativeRefillCursor) { return micros(at) < micros(before.before_at) || (micros(at) === micros(before.before_at) && id < before.before_id); }
function checkRead(value: unknown): NativeRefillRead {
  const row = readSchema.parse(value), r = row.refill;
  if (row.household_matches !== (r.client_id === row.current_household_id) || (r.authorization_id === null) !== (row.authorization_status === null) || (row.authorization_status === null) !== (row.authorization_usage === null) || (row.authorization_status && (row.authorization_status.authorization_id !== r.authorization_id || row.authorization_status.authorization_hash !== r.authorization_hash))) throw new Error("Refill current disclosure differs"); return row;
}
function checkEvent(value: unknown): NativeRefillEvent {
  const e = eventSchema.parse(value), a = e.after, b = e.before;
  if (e.refill_id !== a.id || e.revision !== a.version || e.actor_id !== a.updated_by || (e.action === "link") !== (e.link_context !== null)) throw new Error("Refill event identity differs");
  if (e.action === "create") { if (b !== null || e.prior_event_id !== null || a.version !== 1 || a.state !== "open" || a.assigned_to !== null || a.authorization_id !== null || a.created_by !== e.actor_id) throw new Error("Invalid intake event"); }
  else {
    if (!b || !e.prior_event_id || b.state !== "open" || a.version !== b.version + 1) throw new Error("Refill predecessor differs");
    for (const key of ["id", "pet_id", "client_id", "medication_requested", "requester_note", "channel", "created_by", "created_at"] as const) if (a[key] !== b[key]) throw new Error("Immutable refill input changed");
    if (a.state !== (e.action === "close" ? "closed" : e.action === "deny" ? "denied" : "open") || (e.action !== "assign" && a.assigned_to !== b.assigned_to) || (e.action !== "link" && (a.authorization_id !== b.authorization_id || a.authorization_hash !== b.authorization_hash))) throw new Error("Refill transition differs");
    if (e.link_context) { const c = e.link_context; if (c.refill_id !== a.id || c.refill_version !== b.version || c.pet_id !== a.pet_id || c.client_id !== a.client_id || c.authorization_id !== a.authorization_id || c.authorization_hash !== a.authorization_hash || c.authorization_state !== "active") throw new Error("Reviewed authorization link differs"); }
  }
  return e;
}
export function createNativeRefillApi(client: PrescriptionRpc, actor: string) {
  uuid.parse(actor);
  async function rpc(name: string, args: Record<string, unknown>) { const { data, error } = await client.rpc(name, args); if (error) throw error; return data; }
  function parseOperation(op: Readonly<PrescriptionOperation>) { uuid.parse(op.id); if (op.kind === "create_refill") return refillCreateSchema.parse(op.payload); if (op.kind === "transition_refill") return refillTransitionSchema.parse(op.payload); throw new Error("Unknown refill operation"); }
  function receipt(value: unknown, op: Readonly<PrescriptionOperation>) {
    const request = parseOperation(op), r = receiptSchema.parse(value), e = checkEvent(r.result), a = e.after;
    if (r.id !== op.id || r.actor_id !== actor || e.id !== r.id || e.actor_id !== actor || !same(r.request, request) || e.refill_id !== request.refill_id || a.pet_id !== request.pet_id || e.reason !== request.reason) throw new Error("Refill operation receipt differs");
    if (op.kind === "create_refill") { const create = refillCreateSchema.parse(request); if (e.action !== "create" || a.client_id !== create.client_id || a.medication_requested !== create.medication_requested || a.requester_note !== create.requester_note || a.channel !== create.channel) throw new Error("Intake receipt differs"); }
    else { const transition = refillTransitionSchema.parse(request); if (e.action !== transition.action || e.before?.version !== transition.expected_version || (transition.action === "assign" && a.assigned_to !== transition.assigned_to) || (transition.action === "link" && a.authorization_id !== transition.authorization_id)) throw new Error("Transition receipt differs"); }
    return { ...r, result: e };
  }
  return {
    async execute(op: Readonly<PrescriptionOperation>) { const request = parseOperation(op); return receipt(await rpc(op.kind === "create_refill" ? "create_native_refill" : "transition_native_refill", { p_id: op.id, p_request: request }), op); },
    async recover(op: Readonly<PrescriptionOperation>) { parseOperation(op); const result = await rpc("recover_native_refill_operation", { p_id: op.id }); return result === null ? null : receipt(result, op); },
    async read(id: string, petId: string) { uuid.parse(id); uuid.parse(petId); const data = await rpc("read_native_refill", { p_refill_id: id, p_pet_id: petId }); if (data === null) return null; const row = checkRead(data); if (row.refill.id !== id || row.refill.pet_id !== petId) throw new Error("Refill target differs"); return row; },
    async previewLink(refill: NativeRefill, authorizationId: string) { uuid.parse(authorizationId); refillSchema.parse(refill); const result = previewSchema.parse(await rpc("preview_native_refill_link", { p_refill_id: refill.id, p_pet_id: refill.pet_id, p_authorization_id: authorizationId })); const c = result.context; if (result.actor_id !== actor || c.refill_id !== refill.id || c.refill_version !== refill.version || c.pet_id !== refill.pet_id || c.client_id !== refill.client_id || c.authorization_id !== authorizationId || c.authorization_state !== "active") throw new Error("Refill link preview differs"); return result; },
    async list(cursor: NativeRefillCursor | null = null, petId: string | null = null, limit = 20) {
      if (cursor) cursorSchema.parse(cursor); if (petId) uuid.parse(petId); z.number().int().min(1).max(100).parse(limit);
      const page = z.object({ version: z.literal(1), refills: z.array(readSchema).max(100), has_more: z.boolean(), next_cursor: cursorSchema.nullable() }).strict().parse(await rpc("list_native_refills", { p_pet_id: petId, p_before_at: cursor?.before_at ?? null, p_before_id: cursor?.before_id ?? null, p_limit: limit }));
      let previous = cursor; const ids = new Set<string>();
      for (const value of page.refills) { const r = checkRead(value).refill; if ((petId && r.pet_id !== petId) || ids.has(r.id) || (previous && !earlier(r.created_at, r.id, previous))) throw new Error("Refill list order differs"); previous = { before_at: r.created_at, before_id: r.id }; ids.add(r.id); }
      if (page.refills.length > limit || page.has_more !== !!page.next_cursor || (page.has_more && (page.refills.length !== limit || !same(page.next_cursor, previous)))) throw new Error("Refill continuation differs"); return page;
    },
    async legacy(cursor: NativeRefillCursor | null = null, limit = 20) {
      if (cursor) cursorSchema.parse(cursor); z.number().int().min(1).max(100).parse(limit);
      const page = z.object({ version: z.literal(1), records: z.array(legacySchema).max(100), has_more: z.boolean(), next_cursor: cursorSchema.nullable() }).strict().parse(await rpc("list_legacy_refills", { p_before_at: cursor?.before_at ?? null, p_before_id: cursor?.before_id ?? null, p_limit: limit }));
      let previous = cursor; const ids = new Set<string>(); for (const { record: r } of page.records) { if (ids.has(r.id) || (previous && !earlier(r.created_at, r.id, previous))) throw new Error("Legacy refill order differs"); previous = { before_at: r.created_at, before_id: r.id }; ids.add(r.id); }
      if (page.records.length > limit || page.has_more !== !!page.next_cursor || (page.has_more && (page.records.length !== limit || !same(page.next_cursor, previous)))) throw new Error("Legacy refill continuation differs"); return page;
    },
    async history(refill: NativeRefill, cursor: NativeRefillCursor | null = null, limit = 20) {
      refillSchema.parse(refill); if (cursor) cursorSchema.parse(cursor); z.number().int().min(1).max(100).parse(limit);
      const page = z.object({ version: z.literal(1), refill_id: uuid, pet_id: uuid, events: z.array(eventSchema).max(100), has_more: z.boolean(), next_cursor: cursorSchema.nullable() }).strict().parse(await rpc("list_native_refill_events", { p_refill_id: refill.id, p_pet_id: refill.pet_id, p_before_at: cursor?.before_at ?? null, p_before_id: cursor?.before_id ?? null, p_limit: limit }));
      if (page.refill_id !== refill.id || page.pet_id !== refill.pet_id) throw new Error("Refill history target differs"); let previous = cursor; const ids = new Set<string>();
      for (const value of page.events) { const e = checkEvent(value); if (e.refill_id !== refill.id || e.after.pet_id !== refill.pet_id || ids.has(e.id) || (previous && !earlier(e.created_at, e.id, previous))) throw new Error("Refill event order differs"); previous = { before_at: e.created_at, before_id: e.id }; ids.add(e.id); }
      if (page.events.length > limit || page.has_more !== !!page.next_cursor || (page.has_more && (page.events.length !== limit || !same(page.next_cursor, previous)))) throw new Error("Refill history continuation differs"); return page;
    },
  };
}
export interface NativeRefillApi extends ReturnType<typeof createNativeRefillApi> {}
