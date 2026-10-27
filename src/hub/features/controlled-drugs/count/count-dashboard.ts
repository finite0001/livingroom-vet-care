import { z } from "zod";
import { decodeExactJson, ExactJsonNumber, protocolInteger, validUnicode, type ExactJson } from "../record-review/exact-json.ts";
import { parseCountManagementReply, type CountManagementReadData } from "./count-management-schema.ts";

const uuid = z.string().regex(/^(?!00000000-0000-0000-0000-000000000000$)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const timestamp = z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$/)
  .refine(value => value.slice(0, 4) !== "0000" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === `${value.slice(0, 23)}Z`);
const scope = { schema_version: z.literal(1), actor_id: uuid, product_id: uuid, site_id: uuid };
const investigationCursor = z.object({ cause_id: uuid }).strict();
const reconciliationCursor = z.object({ prepared_at: timestamp, reconciliation_id: uuid }).strict();
const investigationRequest = z.object({ ...scope, cursor: investigationCursor.nullable(), page_size: z.number().int().min(1).max(100) }).strict();
const reconciliationRequest = z.object({ ...scope, cursor: reconciliationCursor.nullable(), page_size: z.number().int().min(1).max(100) }).strict();
const investigationItem = z.object({ cause_id: uuid, source_count_id: uuid, history_state: z.enum(["open", "agreement", "variance", "stale", "cancelled"]), recorded_at: timestamp }).strict();
const investigationReply = z.object({ schema_version: z.literal(1), product_id: uuid, site_id: uuid, items: z.array(investigationItem).max(64),
  other_scope_causes: z.boolean(), next_cursor: investigationCursor.nullable(), has_more: z.boolean() }).strict();
const managementFields = ["product_id", "site_id", "reconciliation_id", "preparation_id", "parent_action_id", "recorder_id", "lot_id", "quantity_delta", "reason", "parent_expires_at", "approval_id", "execution_id", "confirmation_id", "history_state", "current_state", "target_cause_ids"] as const;
const managementAction = z.enum(["management_read", "reconciliation_approve", "reconciliation_execute", "reconciliation_confirm"]);
export type CountReconciliationAvailableAction = z.infer<typeof managementAction>;
const reconciliationItem = z.object({ ...Object.fromEntries(managementFields.map(key => [key, z.unknown()])), prepared_at: timestamp,
  recorder_name: z.string().min(1).refine(value => validUnicode(value) && !value.includes("\0") && [...value].length <= 200 && new TextEncoder().encode(value).length <= 800),
  available_actions: z.array(managementAction).min(1).max(4) }).strict();
const reconciliationReply = z.object({ schema_version: z.literal(1), product_id: uuid, site_id: uuid, items: z.array(reconciliationItem).max(100),
  next_cursor: reconciliationCursor.nullable(), has_more: z.boolean() }).strict();
export interface CountInvestigationCursor { readonly cause_id: string }
export interface CountReconciliationCursor { readonly prepared_at: string; readonly reconciliation_id: string }
interface DashboardScope { readonly schema_version: 1; readonly actor_id: string; readonly product_id: string; readonly site_id: string; readonly page_size: number }
export interface CountInvestigationRequest extends DashboardScope { readonly cursor: CountInvestigationCursor | null }
export interface CountReconciliationListRequest extends DashboardScope { readonly cursor: CountReconciliationCursor | null }
export interface CountInvestigationItem {
  readonly cause_id: string; readonly source_count_id: string; readonly history_state: "open" | "agreement" | "variance" | "stale" | "cancelled"; readonly recorded_at: string;
}
export interface CountInvestigationReply {
  readonly schema_version: 1; readonly product_id: string; readonly site_id: string; readonly items: readonly CountInvestigationItem[];
  readonly other_scope_causes: boolean; readonly next_cursor: CountInvestigationCursor | null; readonly has_more: boolean;
}
export interface CountReconciliationItem extends CountManagementReadData {
  readonly prepared_at: string; readonly recorder_name: string; readonly available_actions: readonly CountReconciliationAvailableAction[];
}
export interface CountReconciliationListReply {
  readonly schema_version: 1; readonly product_id: string; readonly site_id: string; readonly items: readonly CountReconciliationItem[];
  readonly next_cursor: CountReconciliationCursor | null; readonly has_more: boolean;
}
function invalid(): never { throw new Error("The stock review list could not be verified. Refresh before continuing."); }
function freeze<T>(input: T): T { if (input && typeof input === "object") { Object.values(input).forEach(freeze); Object.freeze(input); } return input; }
function requestSnapshot(input: unknown, cursorKeys: readonly string[]): unknown {
  function snapshot(value: unknown, keys: readonly string[]): Record<string, unknown> {
    if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
    const actual = Reflect.ownKeys(value);
    if (actual.length !== keys.length || actual.some(key => typeof key !== "string" || !keys.includes(key))) invalid();
    const output: Record<string, unknown> = Object.create(null);
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor?.enumerable || !("value" in descriptor)) invalid();
      output[key] = key === "cursor" && descriptor.value !== null ? snapshot(descriptor.value, cursorKeys) : descriptor.value;
    }
    return output;
  }
  return snapshot(input, ["schema_version", "actor_id", "product_id", "site_id", "cursor", "page_size"]);
}
export function parseCountInvestigationRequest(input: unknown): CountInvestigationRequest {
  const value = investigationRequest.safeParse(requestSnapshot(input, ["cause_id"])); if (!value.success) invalid(); return freeze(value.data) as CountInvestigationRequest;
}
export function parseCountReconciliationListRequest(input: unknown): CountReconciliationListRequest {
  const value = reconciliationRequest.safeParse(requestSnapshot(input, ["prepared_at", "reconciliation_id"])); if (!value.success) invalid(); return freeze(value.data) as CountReconciliationListRequest;
}
function decode(raw: Uint8Array, limit: number): unknown {
  const intrinsic = Object.getPrototypeOf(Uint8Array.prototype), length = Object.getOwnPropertyDescriptor(intrinsic, "byteLength")!.get!.call(raw) as number;
  if (Object.getOwnPropertyDescriptor(intrinsic, Symbol.toStringTag)!.get!.call(raw) !== "Uint8Array" || length > limit) invalid();
  const copy = new Uint8Array(length); Uint8Array.prototype.set.call(copy, raw);
  function ordinary(value: ExactJson): unknown {
    if (value instanceof ExactJsonNumber) return protocolInteger(value, 1, 1);
    if (Array.isArray(value)) return value.map(ordinary);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, ordinary(child)]));
    return value;
  }
  return ordinary(decodeExactJson(copy));
}
export function parseCountInvestigationReply(raw: Uint8Array, input: unknown): CountInvestigationReply {
  const request = parseCountInvestigationRequest(input), value = investigationReply.safeParse(decode(raw, 32768)); if (!value.success) invalid();
  const reply = value.data as CountInvestigationReply;
  if (reply.product_id !== request.product_id || reply.site_id !== request.site_id || reply.items.length > request.page_size) invalid();
  let previous = request.cursor?.cause_id ?? "";
  for (const item of reply.items) { if (item.cause_id <= previous) invalid(); previous = item.cause_id; }
  if (reply.has_more ? !reply.items.length || reply.next_cursor?.cause_id !== previous : reply.next_cursor !== null) invalid();
  return freeze(reply);
}
export function parseCountReconciliationListReply(raw: Uint8Array, input: unknown): CountReconciliationListReply {
  const request = parseCountReconciliationListRequest(input), value = reconciliationReply.safeParse(decode(raw, 1048576)); if (!value.success) invalid();
  if (value.data.product_id !== request.product_id || value.data.site_id !== request.site_id || value.data.items.length > request.page_size) invalid();
  const items: CountReconciliationItem[] = [];
  const key = (item: CountReconciliationCursor) => `${item.prepared_at}:${item.reconciliation_id}`;
  let previous = request.cursor ? key(request.cursor) : null;
  for (const item of value.data.items) {
    if (Object.keys(item).length !== 19) invalid();
    const { prepared_at, recorder_name, available_actions, ...body } = item;
    const parsed = parseCountManagementReply({ schema_version: 1, state: "available", data: body }); if (parsed.state !== "available") invalid();
    const data = parsed.data, cursor = { prepared_at, reconciliation_id: data.reconciliation_id };
    if (data.product_id !== request.product_id || data.site_id !== request.site_id || (previous !== null && key(cursor) >= previous) || prepared_at > data.parent_expires_at ||
      !available_actions.includes("management_read") || available_actions.some((action, index) => index > 0 && available_actions[index - 1] >= action)) invalid();
    for (const action of available_actions) {
      if (action === "management_read") continue;
      if (data.current_state !== "current" || (action === "reconciliation_approve" && (data.history_state !== "prepared" || data.recorder_id === request.actor_id)) ||
        (action === "reconciliation_execute" && (data.history_state !== "approved" || data.recorder_id !== request.actor_id)) ||
        (action === "reconciliation_confirm" && (data.history_state !== "executed" || data.recorder_id === request.actor_id))) invalid();
    }
    previous = key(cursor); items.push({ ...data, prepared_at, recorder_name, available_actions });
  }
  if (value.data.has_more ? !items.length || !value.data.next_cursor || key(value.data.next_cursor as CountReconciliationCursor) !== previous : value.data.next_cursor !== null) invalid();
  return freeze({ ...value.data, items }) as CountReconciliationListReply;
}
