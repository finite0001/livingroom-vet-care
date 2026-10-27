import { z } from "zod";

/** Local wire admission only. No policy, actor, hold or execution authority. */
export type CountManagementMutationAction = "reconciliation_prepare" | "reconciliation_approve" | "reconciliation_execute" | "reconciliation_confirm" | "cause_resolve";
export type CountManagementAction = CountManagementMutationAction | "read" | "recover";
interface ManagementPrincipal {
  readonly schema_version: 1; readonly actor_id: string; readonly product_id: string; readonly site_id: string;
}
interface ManagementOperation extends ManagementPrincipal { readonly operation_id: string }
export interface ReconciliationPrepareRequest extends ManagementOperation {
  readonly reconciliation_id: string; readonly preparation_id: string; readonly parent_action_id: string;
  readonly target_cause_ids: readonly string[]; readonly lot_id: string; readonly quantity_delta: string; readonly reason: string;
}
export interface ReconciliationApproveRequest extends ManagementOperation { readonly approval_id: string; readonly preparation_id: string }
export interface ReconciliationExecuteRequest extends ManagementOperation { readonly execution_id: string; readonly preparation_id: string; readonly approval_id: string }
export interface ReconciliationConfirmRequest extends ManagementOperation { readonly confirmation_id: string; readonly execution_id: string }
export interface ReconciledAvailableEvidence { readonly kind: "reconciled_available"; readonly confirmation_id: string; readonly post_count_id: string }
export interface FreshAgreementEvidence { readonly kind: "fresh_agreement"; readonly post_count_id: string }
export interface CauseResolveRequest extends ManagementOperation {
  readonly resolution_id: string; readonly cause_id: string; readonly evidence: ReconciledAvailableEvidence | FreshAgreementEvidence;
}
export interface CountManagementReadRequest extends ManagementPrincipal { readonly reconciliation_id: string }
export interface CountManagementRecoverRequest extends ManagementOperation {}
export interface CountManagementRequestMap {
  reconciliation_prepare: ReconciliationPrepareRequest; reconciliation_approve: ReconciliationApproveRequest;
  reconciliation_execute: ReconciliationExecuteRequest; reconciliation_confirm: ReconciliationConfirmRequest;
  cause_resolve: CauseResolveRequest; read: CountManagementReadRequest; recover: CountManagementRecoverRequest;
}
type ManagementResultKind = "reconciliation_preparation" | "reconciliation_approval" | "reconciliation_execution" | "reconciliation_confirmation" | "cause_resolution";
export interface CountManagementResultRef<K extends ManagementResultKind = ManagementResultKind> {
  readonly kind: K; readonly id: string; readonly opaque_commitment: string;
}
interface ManagementReceiptFields extends ManagementOperation { readonly request_digest: string; readonly receipt_digest: string }
export interface ReconciliationPrepareReceipt extends ManagementReceiptFields { readonly action: "reconciliation_prepare"; readonly result_ref: CountManagementResultRef<"reconciliation_preparation"> }
export interface ReconciliationApproveReceipt extends ManagementReceiptFields { readonly action: "reconciliation_approve"; readonly result_ref: CountManagementResultRef<"reconciliation_approval"> }
export interface ReconciliationExecuteReceipt extends ManagementReceiptFields { readonly action: "reconciliation_execute"; readonly result_ref: CountManagementResultRef<"reconciliation_execution"> }
export interface ReconciliationConfirmReceipt extends ManagementReceiptFields { readonly action: "reconciliation_confirm"; readonly result_ref: CountManagementResultRef<"reconciliation_confirmation"> }
export interface CauseResolveReceipt extends ManagementReceiptFields { readonly action: "cause_resolve"; readonly result_ref: CountManagementResultRef<"cause_resolution"> }
export type CountManagementPublicReceipt = ReconciliationPrepareReceipt | ReconciliationApproveReceipt | ReconciliationExecuteReceipt | ReconciliationConfirmReceipt | CauseResolveReceipt;
export interface CountManagementSavedReply { readonly schema_version: 1; readonly state: "saved"; readonly data: { readonly receipt: CountManagementPublicReceipt } }
export interface CountManagementNotFoundReply {
  readonly schema_version: 1; readonly state: "not_found";
  readonly data: { readonly operation_id: string; readonly product_id: string; readonly site_id: string };
}
export interface CountManagementReadData {
  readonly product_id: string; readonly site_id: string; readonly reconciliation_id: string; readonly preparation_id: string;
  readonly parent_action_id: string; readonly recorder_id: string; readonly lot_id: string; readonly quantity_delta: string;
  readonly reason: string; readonly parent_expires_at: string; readonly approval_id: string | null; readonly execution_id: string | null;
  readonly confirmation_id: string | null; readonly history_state: "prepared" | "approved" | "executed" | "confirmed";
  readonly current_state: "current" | "stale" | "expired" | "cancelled" | "blocked"; readonly target_cause_ids: readonly string[];
}
export interface CountManagementReadReply { readonly schema_version: 1; readonly state: "available"; readonly data: CountManagementReadData }
export type CountManagementReply = CountManagementSavedReply | CountManagementNotFoundReply | CountManagementReadReply;

const REQUEST_BYTE_LIMIT = 16384;
const RECEIPT_BYTE_LIMIT = 4096;
const READ_BYTE_LIMIT = 16384;
// Raw JSON escapes may be longer than the admitted parsed JSONB text.
const RAW_BYTE_LIMIT = 131072;
const encoder = new TextEncoder();
const UUID_PATTERN = /^(?!00000000-0000-0000-0000-000000000000$)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const QUANTITY_PATTERN = /^-?(0|[1-9][0-9]{0,10})([.][0-9]{1,3})?$/;
function invalid(): never { throw new Error("Invalid count management wire value"); }
function scalarUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code === 0) return false;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
function wireBlank(code: number): boolean {
  return (code >= 9 && code <= 13) || [0x20, 0x85, 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff].includes(code) || (code >= 0x2000 && code <= 0x200b);
}
function parentBlank(code: number): boolean {
  return (code >= 9 && code <= 13) || [0x20, 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff].includes(code) || (code >= 0x2000 && code <= 0x200a);
}
function cleanReason(value: string): boolean {
  const characters = [...value];
  return characters.length >= 1 && characters.length <= 2000 && characters.some(c => !wireBlank(c.codePointAt(0)!)) &&
    !parentBlank(characters[0].codePointAt(0)!) && !parentBlank(characters[characters.length - 1].codePointAt(0)!) &&
    characters.every(c => { const code = c.codePointAt(0)!; return code === 9 || code === 10 || (code >= 32 && code !== 127); });
}
function microsecondUtc(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.\d{6}Z$/.exec(value);
  if (!match) return false;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] && hour <= 23 && minute <= 59 && second <= 59;
}

// Fixed shape snapshot precedes Zod; no generic validator is exported.
interface ObjectShape { readonly fields: Readonly<Record<string, Shape>> }
interface ArrayShape { readonly item: Shape; readonly maximum: number }
interface NullableShape { readonly nullable: Shape }
interface ChoiceShape { readonly discriminator: "kind"; readonly variants: Readonly<Record<string, ObjectShape>> }
type Shape = number | "one" | ObjectShape | ArrayShape | NullableShape | ChoiceShape;
const base = { schema_version: "one", actor_id: 36, product_id: 36, site_id: 36 } as const;
const operation = { ...base, operation_id: 36 };
const evidenceShape: ChoiceShape = { discriminator: "kind", variants: {
  reconciled_available: { fields: { kind: 20, confirmation_id: 36, post_count_id: 36 } },
  fresh_agreement: { fields: { kind: 20, post_count_id: 36 } },
} };
const requestShapes: Readonly<Record<CountManagementAction, ObjectShape>> = {
  reconciliation_prepare: { fields: { ...operation, reconciliation_id: 36, preparation_id: 36, parent_action_id: 36, target_cause_ids: { item: 36, maximum: 64 }, lot_id: 36, quantity_delta: 16, reason: 8000 } },
  reconciliation_approve: { fields: { ...operation, approval_id: 36, preparation_id: 36 } },
  reconciliation_execute: { fields: { ...operation, execution_id: 36, preparation_id: 36, approval_id: 36 } },
  reconciliation_confirm: { fields: { ...operation, confirmation_id: 36, execution_id: 36 } },
  cause_resolve: { fields: { ...operation, resolution_id: 36, cause_id: 36, evidence: evidenceShape } },
  read: { fields: { ...base, reconciliation_id: 36 } }, recover: { fields: operation },
};
const receiptShape: ObjectShape = { fields: { ...operation, action: 22, request_digest: 64, receipt_digest: 64, result_ref: { fields: { kind: 27, id: 36, opaque_commitment: 64 } } } };
const savedShape: ObjectShape = { fields: { schema_version: "one", state: 9, data: { fields: { receipt: receiptShape } } } };
const notFoundShape: ObjectShape = { fields: { schema_version: "one", state: 9, data: { fields: { operation_id: 36, product_id: 36, site_id: 36 } } } };
const availableShape: ObjectShape = { fields: { schema_version: "one", state: 9, data: { fields: {
  product_id: 36, site_id: 36, reconciliation_id: 36, preparation_id: 36, parent_action_id: 36, recorder_id: 36, lot_id: 36,
  quantity_delta: 16, reason: 8000, parent_expires_at: 27, approval_id: { nullable: 36 }, execution_id: { nullable: 36 },
  confirmation_id: { nullable: 36 }, history_state: 9, current_state: 9, target_cause_ids: { item: 36, maximum: 64 },
} } } };
function dataField(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) invalid();
  return descriptor.value;
}
function plain(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function snapshot(value: unknown, shape: Shape, limit: number): unknown {
  let bytes = 0, nodes = 0;
  const ancestors = new Set<object>();
  function add(size: number) { bytes += size; if (bytes > limit) invalid(); }
  function visit(input: unknown, expected: Shape, depth: number): unknown {
    if (++nodes > 4096 || depth > 6) invalid();
    if (expected === "one") { if (input !== 1 || typeof input !== "number") invalid(); add(1); return 1; }
    if (typeof expected === "number") {
      if (typeof input !== "string" || input.length > expected || !scalarUnicode(input)) invalid();
      if (encoder.encode(input).length > expected) invalid();
      add(encoder.encode(JSON.stringify(input)).length);
      return input;
    }
    if ("nullable" in expected) { if (input === null) { add(4); return null; } return visit(input, expected.nullable, depth + 1); }
    if ("variants" in expected) {
      if (!plain(input)) invalid();
      const keys = Reflect.ownKeys(input);
      if (keys.length > 3 || keys.some(k => typeof k !== "string")) invalid();
      const kind = dataField(input, expected.discriminator);
      if (typeof kind !== "string" || !Object.prototype.hasOwnProperty.call(expected.variants, kind)) invalid();
      return visit(input, expected.variants[kind], depth + 1);
    }
    if (!input || typeof input !== "object" || ancestors.has(input)) invalid();
    ancestors.add(input);
    let result: unknown;
    if ("maximum" in expected) {
      if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) invalid();
      const lengthDescriptor = Object.getOwnPropertyDescriptor(input, "length");
      if (!lengthDescriptor || !("value" in lengthDescriptor) || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value > expected.maximum) invalid();
      const length = lengthDescriptor.value as number, keys = Reflect.ownKeys(input);
      if (keys.length !== length + 1 || keys.some(k => typeof k !== "string" || (k !== "length" && !/^(0|[1-9][0-9]*)$/.test(k)))) invalid();
      add(2 + Math.max(0, length - 1) * 2);
      const items: unknown[] = [];
      for (let index = 0; index < length; index++) items.push(visit(dataField(input, String(index)), expected.item, depth + 1));
      result = Object.freeze(items);
    } else {
      if (!plain(input)) invalid();
      const keys = Reflect.ownKeys(input), fields = Object.keys(expected.fields);
      if (keys.length !== fields.length || keys.some(k => typeof k !== "string" || !Object.prototype.hasOwnProperty.call(expected.fields, k))) invalid();
      add(2 + Math.max(0, fields.length - 1) * 2);
      const record: Record<string, unknown> = Object.create(null);
      for (const key of fields) { add(key.length + 4); record[key] = visit(dataField(input, key), expected.fields[key], depth + 1); }
      result = Object.freeze(record);
    }
    ancestors.delete(input);
    return result;
  }
  return visit(value, shape, 0);
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
const uuid = z.string().regex(UUID_PATTERN), digest = z.string().regex(DIGEST_PATTERN);
const quantity = z.string().regex(QUANTITY_PATTERN).refine(v => !/^-?0(?:\.0{1,3})?$/.test(v));
const reason = z.string().refine(cleanReason);
const causes = z.array(uuid).min(1).max(64).refine(values => values.every((v, i) => i === 0 || values[i - 1] < v));
const common = { schema_version: z.literal(1), actor_id: uuid, product_id: uuid, site_id: uuid };
const op = { ...common, operation_id: uuid };
const evidence = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("reconciled_available"), confirmation_id: uuid, post_count_id: uuid }).strict(),
  z.object({ kind: z.literal("fresh_agreement"), post_count_id: uuid }).strict(),
]);
const requestSchemas = {
  reconciliation_prepare: z.object({ ...op, reconciliation_id: uuid, preparation_id: uuid, parent_action_id: uuid, target_cause_ids: causes, lot_id: uuid, quantity_delta: quantity, reason }).strict(),
  reconciliation_approve: z.object({ ...op, approval_id: uuid, preparation_id: uuid }).strict(),
  reconciliation_execute: z.object({ ...op, execution_id: uuid, preparation_id: uuid, approval_id: uuid }).strict(),
  reconciliation_confirm: z.object({ ...op, confirmation_id: uuid, execution_id: uuid }).strict(),
  cause_resolve: z.object({ ...op, resolution_id: uuid, cause_id: uuid, evidence }).strict(),
  read: z.object({ ...common, reconciliation_id: uuid }).strict(), recover: z.object(op).strict(),
};
const receiptBase = { ...op, request_digest: digest, receipt_digest: digest };
const receiptSchema = z.discriminatedUnion("action", [
  z.object({ ...receiptBase, action: z.literal("reconciliation_prepare"), result_ref: z.object({ kind: z.literal("reconciliation_preparation"), id: uuid, opaque_commitment: digest }).strict() }).strict(),
  z.object({ ...receiptBase, action: z.literal("reconciliation_approve"), result_ref: z.object({ kind: z.literal("reconciliation_approval"), id: uuid, opaque_commitment: digest }).strict() }).strict(),
  z.object({ ...receiptBase, action: z.literal("reconciliation_execute"), result_ref: z.object({ kind: z.literal("reconciliation_execution"), id: uuid, opaque_commitment: digest }).strict() }).strict(),
  z.object({ ...receiptBase, action: z.literal("reconciliation_confirm"), result_ref: z.object({ kind: z.literal("reconciliation_confirmation"), id: uuid, opaque_commitment: digest }).strict() }).strict(),
  z.object({ ...receiptBase, action: z.literal("cause_resolve"), result_ref: z.object({ kind: z.literal("cause_resolution"), id: uuid, opaque_commitment: digest }).strict() }).strict(),
]);
const savedSchema = z.object({ schema_version: z.literal(1), state: z.literal("saved"), data: z.object({ receipt: receiptSchema }).strict() }).strict();
const notFoundSchema = z.object({ schema_version: z.literal(1), state: z.literal("not_found"), data: z.object({ operation_id: uuid, product_id: uuid, site_id: uuid }).strict() }).strict();
const availableSchema = z.object({ schema_version: z.literal(1), state: z.literal("available"), data: z.object({
  product_id: uuid, site_id: uuid, reconciliation_id: uuid, preparation_id: uuid, parent_action_id: uuid, recorder_id: uuid, lot_id: uuid,
  quantity_delta: quantity, reason, parent_expires_at: z.string().refine(microsecondUtc), approval_id: uuid.nullable(), execution_id: uuid.nullable(), confirmation_id: uuid.nullable(),
  history_state: z.enum(["prepared", "approved", "executed", "confirmed"]), current_state: z.enum(["current", "stale", "expired", "cancelled", "blocked"]), target_cause_ids: causes,
}).strict().refine(value => {
  const stage = ["prepared", "approved", "executed", "confirmed"].indexOf(value.history_state);
  return (value.approval_id !== null) === (stage >= 1) && (value.execution_id !== null) === (stage >= 2) && (value.confirmation_id !== null) === (stage >= 3);
}) }).strict();

export function parseCountManagementRequest<K extends CountManagementAction>(action: K, value: unknown): CountManagementRequestMap[K] {
  if (typeof action !== "string" || !Object.prototype.hasOwnProperty.call(requestShapes, action)) invalid();
  const parsed = requestSchemas[action].safeParse(snapshot(value, requestShapes[action], REQUEST_BYTE_LIMIT));
  if (!parsed.success) invalid();
  return freeze(parsed.data) as CountManagementRequestMap[K];
}
export function parseCountManagementReceipt(value: unknown): CountManagementPublicReceipt {
  const parsed = receiptSchema.safeParse(snapshot(value, receiptShape, RECEIPT_BYTE_LIMIT));
  if (!parsed.success) invalid();
  return freeze(parsed.data) as CountManagementPublicReceipt;
}
export function parseCountManagementReply(value: unknown): CountManagementReply {
  if (!plain(value)) invalid();
  const state = dataField(value, "state");
  const shape = state === "saved" ? savedShape : state === "not_found" ? notFoundShape : state === "available" ? availableShape : invalid();
  const schema = state === "saved" ? savedSchema : state === "not_found" ? notFoundSchema : availableSchema;
  const parsed = schema.safeParse(snapshot(value, shape, state === "available" ? READ_BYTE_LIMIT : RECEIPT_BYTE_LIMIT));
  if (!parsed.success) invalid();
  return freeze(parsed.data) as CountManagementReply;
}

// Duplicate-aware UTF8 boundary; numeric output must be exactly PG numeric1.
function decode(raw: Uint8Array, limit: number): unknown {
  let byteLength: number;
  try { byteLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), "byteLength")!.get!.call(raw) as number; }
  catch { return invalid(); }
  if (!byteLength || byteLength > limit) invalid();
  const copy = new Uint8Array(byteLength); copy.set(raw);
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(copy);
  let offset = 0, nodes = 0;
  function space() { while (/[\x20\t\r\n]/.test(text[offset] ?? "!")) offset++; }
  function string(): string {
    const start = offset++;
    while (offset < text.length) {
      const code = text.charCodeAt(offset++);
      if (code === 34) { const value: unknown = JSON.parse(text.slice(start, offset)); if (typeof value !== "string" || !scalarUnicode(value)) invalid(); return value; }
      if (code === 92) {
        const escape = text[offset++];
        if (escape === "u") { if (!/^[0-9a-fA-F]{4}$/.test(text.slice(offset, offset + 4))) invalid(); offset += 4; }
        else if (!escape || !'"\\/bfnrt'.includes(escape)) invalid();
      } else if (code < 32) invalid();
    }
    return invalid();
  }
  function value(depth: number): unknown {
    if (depth > 6 || ++nodes > 4096) invalid();
    space(); const char = text[offset];
    if (char === '"') return string();
    if (char === "{" || char === "[") {
      offset++; space(); const isArray = char === "[";
      const record: Record<string, unknown> = Object.create(null), items: unknown[] = [];
      if (text[offset] === (isArray ? "]" : "}")) { offset++; return isArray ? items : record; }
      for (let members = 0; ; members++) {
        if (members >= (isArray ? 64 : 24)) invalid();
        if (isArray) items.push(value(depth + 1));
        else { space(); if (text[offset] !== '"') invalid(); const key = string(); if (Object.prototype.hasOwnProperty.call(record, key)) invalid(); space(); if (text[offset++] !== ":") invalid(); record[key] = value(depth + 1); }
        space(); const next = text[offset++];
        if (next === (isArray ? "]" : "}")) return isArray ? items : record;
        if (next !== ",") invalid();
      }
    }
    for (const [literal, result] of [["null", null], ["true", true], ["false", false]] as const) if (text.startsWith(literal, offset)) { offset += literal.length; return result; }
    const match = /^-?(0|[1-9][0-9]*)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?/.exec(text.slice(offset));
    if (!match || match[0].startsWith("-")) invalid();
    const fraction = match[2] ?? "", exponent = match[3] ?? "0";
    const magnitude = exponent.replace(/^[+-]/, "").replace(/^0+/, "") || "0";
    if ((exponent.startsWith("-") && magnitude !== "0") || magnitude !== String(fraction.length) || (match[1] + fraction).replace(/^0+/, "") !== "1") invalid();
    offset += match[0].length; return 1;
  }
  const result = value(0); space(); if (offset !== text.length) invalid(); return result;
}
export function decodeCountManagementRequest<K extends CountManagementAction>(action: K, raw: Uint8Array): CountManagementRequestMap[K] {
  return parseCountManagementRequest(action, decode(raw, RAW_BYTE_LIMIT));
}
export function decodeCountManagementReply(raw: Uint8Array): CountManagementReply { return parseCountManagementReply(decode(raw, RAW_BYTE_LIMIT)); }
/** The management mutation facade returns this direct thin receipt. */
export function decodeCountManagementReceipt(raw: Uint8Array): CountManagementPublicReceipt { return parseCountManagementReceipt(decode(raw, RECEIPT_BYTE_LIMIT)); }
