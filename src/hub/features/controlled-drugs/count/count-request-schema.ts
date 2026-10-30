import { z } from "zod";

/** Pure prospective wire admission. No principal, site membership or physical authority. */
export type CountAction = "start" | "statement" | "finalize" | "cancel" | "recover" | "read";
export type CountMutationAction = Exclude<CountAction, "recover" | "read">;
interface CountPrincipal { readonly schema_version: 1; readonly actor_id: string; readonly count_id: string }
interface CountOperation extends CountPrincipal { readonly operation_id: string }
export interface CountStartRequest extends CountOperation { readonly product_id: string; readonly site_id: string; readonly actor_b_id: string }
export interface CountQuantity { readonly cell_id: string; readonly quantity: string }
export interface CountContainerCheck { readonly container_id: string; readonly presence: "present" | "missing" }
export interface CountFinding { readonly description: string; readonly location_id: string }
export interface CountStatementRequest extends CountOperation {
  readonly snapshot_id: string; readonly statement_id: string; readonly observed_at: string; readonly method: "manual_count";
  readonly quantities: readonly CountQuantity[]; readonly container_checks: readonly CountContainerCheck[]; readonly findings: readonly CountFinding[];
}
export interface CountFinalizeRequest extends CountOperation { readonly outcome_id: string }
export interface CountCancelRequest extends CountOperation { readonly cancellation_id: string; readonly reason: string }
export interface CountRecoverRequest extends CountOperation {}
export interface CountReadRequest extends CountPrincipal {}
export interface CountRequestMap {
  start: CountStartRequest; statement: CountStatementRequest; finalize: CountFinalizeRequest;
  cancel: CountCancelRequest; recover: CountRecoverRequest; read: CountReadRequest;
}
export interface CountResultRef { readonly kind: "cycle" | "statement" | "outcome" | "cancellation"; readonly id: string; readonly opaque_commitment: string }
interface CountReceiptFields {
  readonly schema_version: 1; readonly operation_id: string; readonly count_id: string;
  readonly actor_id: string; readonly request_digest: string; readonly receipt_digest: string;
}
interface CountCycleRef extends CountResultRef { readonly kind: "cycle" }
interface CountStatementRef extends CountResultRef { readonly kind: "statement" }
interface CountOutcomeRef extends CountResultRef { readonly kind: "outcome" }
interface CountCancellationRef extends CountResultRef { readonly kind: "cancellation" }
export interface CountStartReceipt extends CountReceiptFields { readonly action: "start"; readonly result_ref: CountCycleRef }
export interface CountStatementReceipt extends CountReceiptFields { readonly action: "statement"; readonly result_ref: CountStatementRef }
export interface CountFinalizeReceipt extends CountReceiptFields { readonly action: "finalize"; readonly result_ref: CountOutcomeRef }
export interface CountCancelReceipt extends CountReceiptFields { readonly action: "cancel"; readonly result_ref: CountCancellationRef }
export type CountPublicReceipt = CountStartReceipt | CountStatementReceipt | CountFinalizeReceipt | CountCancelReceipt;
export interface CountSavedReply { readonly schema_version: 1; readonly state: "saved"; readonly data: { readonly receipt: CountPublicReceipt } }
export interface CountNotFoundReply { readonly schema_version: 1; readonly state: "not_found"; readonly data: { readonly operation_id: string; readonly count_id: string } }
export interface CountNotReadyReply { readonly schema_version: 1; readonly state: "not_ready"; readonly data: { readonly count_id: string } }
export type CountReply = CountSavedReply | CountNotFoundReply | CountNotReadyReply;

const REQUEST_BYTE_LIMIT = 262144;
const REPLY_BYTE_LIMIT = 4096;
const encoder = new TextEncoder();
const UUID_PATTERN = /^(?!00000000-0000-0000-0000-000000000000$)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const QUANTITY_PATTERN = /^(0|[1-9][0-9]{0,10})\.[0-9]{3}$/;
function invalid(): never { throw new Error("Invalid count wire value"); }

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
function blank(code: number): boolean {
  return (code >= 9 && code <= 13) || code === 0x20 || code === 0x85 || code === 0xa0 || code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200b) || code === 0x2028 || code === 0x2029 || code === 0x202f ||
    code === 0x205f || code === 0x3000 || code === 0xfeff;
}
function hasNonblank(value: string): boolean { return [...value].some(character => !blank(character.codePointAt(0)!)); }
function microsecondUtc(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.\d{6}Z$/.exec(value);
  if (!match) return false;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] && hour <= 23 && minute <= 59 && second <= 59;
}

// Shape-directed snapshot BEFORE Zod. Fixed field/array/string ceilings are
// checked before child traversal; accessors, sparse arrays, symbols and cycles
// never become Zod input. Reflection on a Proxy is not a JS sandbox guarantee.
interface ObjectShape { readonly fields: Readonly<Record<string, Shape>> }
interface ArrayShape { readonly item: Shape; readonly maximum: number }
type Shape = number | "one" | ObjectShape | ArrayShape;
const uuidShape = 36;
const base = { schema_version: "one", actor_id: uuidShape, count_id: uuidShape } as const;
const operation = { ...base, operation_id: uuidShape };
const requestShapes: Readonly<Record<CountAction, ObjectShape>> = {
  start: { fields: { ...operation, product_id: uuidShape, site_id: uuidShape, actor_b_id: uuidShape } },
  statement: { fields: { ...operation, snapshot_id: uuidShape, statement_id: uuidShape, observed_at: 27, method: 12,
    quantities: { maximum: 512, item: { fields: { cell_id: uuidShape, quantity: 15 } } },
    container_checks: { maximum: 512, item: { fields: { container_id: uuidShape, presence: 7 } } },
    findings: { maximum: 32, item: { fields: { description: 512, location_id: uuidShape } } } } },
  finalize: { fields: { ...operation, outcome_id: uuidShape } },
  cancel: { fields: { ...operation, cancellation_id: uuidShape, reason: 1024 } },
  recover: { fields: operation }, read: { fields: base },
};
const receiptShape: ObjectShape = { fields: { schema_version: "one", action: 9, operation_id: uuidShape, count_id: uuidShape,
  actor_id: uuidShape, request_digest: 64, result_ref: { fields: { kind: 12, id: uuidShape, opaque_commitment: 64 } }, receipt_digest: 64 } };
const savedShape: ObjectShape = { fields: { schema_version: "one", state: 9, data: { fields: { receipt: receiptShape } } } };
const notFoundShape: ObjectShape = { fields: { schema_version: "one", state: 9, data: { fields: { operation_id: uuidShape, count_id: uuidShape } } } };
const notReadyShape: ObjectShape = { fields: { schema_version: "one", state: 9, data: { fields: { count_id: uuidShape } } } };

function dataField(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) invalid();
  return descriptor.value;
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
      const size = encoder.encode(input).length;
      if (size > expected) invalid();
      add(encoder.encode(JSON.stringify(input)).length); // PG JSONB string escaping, for size only; never a commitment.
      return input;
    }
    if (!input || typeof input !== "object" || ancestors.has(input)) invalid();
    ancestors.add(input);
    let result: unknown;
    if ("maximum" in expected) {
      if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) invalid();
      const lengthDescriptor = Object.getOwnPropertyDescriptor(input, "length");
      if (!lengthDescriptor || !("value" in lengthDescriptor) || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value > expected.maximum) invalid();
      const length = lengthDescriptor.value as number;
      const keys = Reflect.ownKeys(input);
      if (keys.length !== length + 1 || keys.some(key => typeof key !== "string" || (key !== "length" && !/^(0|[1-9][0-9]*)$/.test(key)))) invalid();
      add(2 + Math.max(0, length - 1) * 2);
      const items: unknown[] = [];
      for (let index = 0; index < length; index++) items.push(visit(dataField(input, String(index)), expected.item, depth + 1));
      result = Object.freeze(items);
    } else {
      if (![Object.prototype, null].includes(Object.getPrototypeOf(input))) invalid();
      const keys = Reflect.ownKeys(input), fields = Object.keys(expected.fields);
      if (keys.length !== fields.length || keys.some(key => typeof key !== "string" || !Object.prototype.hasOwnProperty.call(expected.fields, key))) invalid();
      add(2 + Math.max(0, fields.length - 1) * 2);
      const record: Record<string, unknown> = Object.create(null);
      for (const key of fields) {
        add(key.length + 4); // quoted ASCII key + colon/space.
        record[key] = visit(dataField(input, key), expected.fields[key], depth + 1);
      }
      result = Object.freeze(record);
    }
    ancestors.delete(input);
    return result;
  }
  return visit(value, shape, 0);
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
const uuid = z.string().regex(UUID_PATTERN);
const digest = z.string().regex(DIGEST_PATTERN);
const common = { schema_version: z.literal(1), actor_id: uuid, count_id: uuid };
const op = { ...common, operation_id: uuid };
const sortedUnique = (values: readonly string[]) => values.every((value, index) => index === 0 || values[index - 1] < value);
const rawSchemas = {
  start: z.object({ ...op, product_id: uuid, site_id: uuid, actor_b_id: uuid }).strict().refine(value => value.actor_id !== value.actor_b_id),
  statement: z.object({ ...op, snapshot_id: uuid, statement_id: uuid, observed_at: z.string().refine(microsecondUtc), method: z.literal("manual_count"),
    quantities: z.array(z.object({ cell_id: uuid, quantity: z.string().regex(QUANTITY_PATTERN) }).strict()).max(512),
    container_checks: z.array(z.object({ container_id: uuid, presence: z.enum(["present", "missing"]) }).strict()).max(512),
    findings: z.array(z.object({ description: z.string().refine(hasNonblank), location_id: uuid }).strict()).max(32),
  }).strict().refine(value => sortedUnique(value.quantities.map(item => item.cell_id)) && sortedUnique(value.container_checks.map(item => item.container_id))),
  finalize: z.object({ ...op, outcome_id: uuid }).strict(),
  cancel: z.object({ ...op, cancellation_id: uuid, reason: z.string().refine(hasNonblank) }).strict(),
  recover: z.object(op).strict(), read: z.object(common).strict(),
};
const receiptBase = { schema_version: z.literal(1), operation_id: uuid, count_id: uuid, actor_id: uuid,
  request_digest: digest, receipt_digest: digest };
const receiptSchemas = [
  z.object({ ...receiptBase, action: z.literal("start"), result_ref: z.object({ kind: z.literal("cycle"), id: uuid, opaque_commitment: digest }).strict() }).strict(),
  z.object({ ...receiptBase, action: z.literal("statement"), result_ref: z.object({ kind: z.literal("statement"), id: uuid, opaque_commitment: digest }).strict() }).strict(),
  z.object({ ...receiptBase, action: z.literal("finalize"), result_ref: z.object({ kind: z.literal("outcome"), id: uuid, opaque_commitment: digest }).strict() }).strict(),
  z.object({ ...receiptBase, action: z.literal("cancel"), result_ref: z.object({ kind: z.literal("cancellation"), id: uuid, opaque_commitment: digest }).strict() }).strict(),
] as const;
const receiptSchema = z.discriminatedUnion("action", receiptSchemas);
const savedSchema = z.object({ schema_version: z.literal(1), state: z.literal("saved"), data: z.object({ receipt: receiptSchema }).strict() }).strict();
const notFoundSchema = z.object({ schema_version: z.literal(1), state: z.literal("not_found"), data: z.object({ operation_id: uuid, count_id: uuid }).strict() }).strict();
const notReadySchema = z.object({ schema_version: z.literal(1), state: z.literal("not_ready"), data: z.object({ count_id: uuid }).strict() }).strict();

export function parseCountRequest<K extends CountAction>(action: K, value: unknown): CountRequestMap[K] {
  if (typeof action !== "string" || !Object.prototype.hasOwnProperty.call(requestShapes, action)) invalid();
  const parsed = rawSchemas[action].safeParse(snapshot(value, requestShapes[action], REQUEST_BYTE_LIMIT));
  if (!parsed.success) invalid();
  return freeze(parsed.data) as CountRequestMap[K];
}
export function parseCountPublicReceipt(value: unknown): CountPublicReceipt {
  const parsed = receiptSchema.safeParse(snapshot(value, receiptShape, REPLY_BYTE_LIMIT));
  if (!parsed.success) invalid();
  return freeze(parsed.data) as CountPublicReceipt;
}
export function parseCountReply(value: unknown): CountReply {
  if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  const state = dataField(value, "state");
  const shape = state === "saved" ? savedShape : state === "not_found" ? notFoundShape : state === "not_ready" ? notReadyShape : invalid();
  const schema = state === "saved" ? savedSchema : state === "not_found" ? notFoundSchema : notReadySchema;
  const parsed = schema.safeParse(snapshot(value, shape, REPLY_BYTE_LIMIT));
  if (!parsed.success) invalid();
  return freeze(parsed.data) as CountReply;
}

/** Count-only duplicate-aware UTF8 decoder. Only numeric tokens whose PG17
 * numeric output is exactly1 can reach schema admission. No generic JSON API. */
function decode(raw: Uint8Array, limit: number): unknown {
  const byteLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), "byteLength")!.get!.call(raw) as number;
  if (!byteLength || byteLength > limit) invalid();
  const copy = new Uint8Array(byteLength); copy.set(raw);
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(copy);
  let offset = 0, nodes = 0;
  function space() { while (/[\x20\t\r\n]/.test(text[offset] ?? "!")) offset++; }
  function string(): string {
    const start = offset++;
    while (offset < text.length) {
      const code = text.charCodeAt(offset++);
      if (code === 34) { const result: unknown = JSON.parse(text.slice(start, offset)); if (typeof result !== "string" || !scalarUnicode(result)) invalid(); return result; }
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
      offset++; space(); const array = char === "[";
      const result: Record<string, unknown> = Object.create(null), items: unknown[] = [];
      if (text[offset] === (array ? "]" : "}")) { offset++; return array ? items : result; }
      for (let members = 0; ; members++) {
        if (members >= (array ? 512 : 16)) invalid();
        if (array) items.push(value(depth + 1));
        else { space(); if (text[offset] !== '"') invalid(); const key = string(); if (Object.prototype.hasOwnProperty.call(result, key)) invalid(); space(); if (text[offset++] !== ":") invalid(); result[key] = value(depth + 1); }
        space(); const next = text[offset++];
        if (next === (array ? "]" : "}")) return array ? items : result;
        if (next !== ",") invalid();
      }
    }
    for (const [literal, result] of [["null", null], ["true", true], ["false", false]] as const) if (text.startsWith(literal, offset)) { offset += literal.length; return result; }
    const match = /^-?(0|[1-9][0-9]*)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?/.exec(text.slice(offset));
    if (!match || match[0].startsWith("-")) invalid();
    const fraction = match[2] ?? "", exponentToken = match[3] ?? "0";
    const magnitude = exponentToken.replace(/^[+-]/, "").replace(/^0+/, "") || "0";
    // PG numeric scale=max(fraction length-exponent,0). Exact value1 with
    // scale0 requires coefficient1 and exponent==fraction length. Compare
    // bounded strings; never expand an exponent or allocate a huge BigInt.
    if ((exponentToken.startsWith("-") && magnitude !== "0") || magnitude !== String(fraction.length) ||
      (match[1] + fraction).replace(/^0+/, "") !== "1") invalid();
    offset += match[0].length; return 1;
  }
  const result = value(0); space(); if (offset !== text.length) invalid(); return result;
}
export function decodeCountRequest<K extends CountAction>(action: K, raw: Uint8Array): CountRequestMap[K] { return parseCountRequest(action, decode(raw, REQUEST_BYTE_LIMIT)); }
export function decodeCountReply(raw: Uint8Array): CountReply { return parseCountReply(decode(raw, REPLY_BYTE_LIMIT)); }
/** Mutation RPCs return the thin receipt directly, without the internal saved envelope. */
export function decodeCountPublicReceipt(raw: Uint8Array): CountPublicReceipt { return parseCountPublicReceipt(decode(raw, REPLY_BYTE_LIMIT)); }
