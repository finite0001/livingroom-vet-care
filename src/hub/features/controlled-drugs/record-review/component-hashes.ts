import { ExactJsonNumber, validUnicode, type ExactJson } from "./exact-json.ts";
import { reviewNumericTextBytes, reviewTargetSchema } from "./prepared-packet.ts";
import { prospectiveSourceShapes } from "./prospective-source-shapes.ts";

interface EvidenceObject { readonly [key: string]: ExactJson }
const byteLimit = 1024 * 1024;
const encoder = new TextEncoder();
const eventRelation = "public.controlled_stock_events";
const preparationRelation = "public.controlled_stock_preparations";
const obligationKeys = ["event_id", "product_id", "event_sequence", "meaning", "target", "target_hash", "adapter", "historical", "binding_hash", "site_id", "due_at", "family_dispense_id"];
function invalid(): never { throw new Error("Review component is not bounded exact evidence"); }

function object(value: unknown): EvidenceObject {
  if (!value || typeof value !== "object" || Array.isArray(value) || value instanceof ExactJsonNumber) invalid();
  if (![null, Object.prototype].includes(Object.getPrototypeOf(value)) || Object.getOwnPropertySymbols(value).length) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const descriptor of Object.values(descriptors)) if (!("value" in descriptor) || !descriptor.enumerable) invalid();
  return value as EvidenceObject;
}
function exactKeys(value: unknown, keys: readonly string[]): EvidenceObject {
  const record = object(value), actual = Object.keys(record);
  if (actual.length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(record, key))) invalid();
  return record;
}
function row(relation: string, value: unknown): EvidenceObject {
  if (!Object.prototype.hasOwnProperty.call(prospectiveSourceShapes, relation)) invalid();
  return exactKeys(value, prospectiveSourceShapes[relation as keyof typeof prospectiveSourceShapes].columns.map(column => column[0]));
}

/** PostgreSQL17 numeric_out expands exponents, retains decimal scale and removes
 * negative zero. Only bounded lengths/indices become Number; source values never do.
 */
function numeric(value: ExactJsonNumber): string {
  const descriptor = Object.getOwnPropertyDescriptor(value, "token");
  if (Object.getPrototypeOf(value) !== ExactJsonNumber.prototype || Object.getOwnPropertyNames(value).length !== 1 ||
    Object.getOwnPropertySymbols(value).length || !descriptor || !("value" in descriptor) || typeof descriptor.value !== "string" ||
    !Object.isFrozen(value)) invalid();
  const token = String(value), bytes = reviewNumericTextBytes(value);
  if (bytes > BigInt(byteLimit)) invalid();
  const match = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/.exec(token);
  if (!match) invalid();
  const fraction = match[3] ?? "", exponent = BigInt(match[4] ?? "0");
  const digits = match[2] + fraction;
  const scale = BigInt(fraction.length) > exponent ? BigInt(fraction.length) - exponent : 0n;
  // numeric.c/set_var_from_str and NumericLong's actual storage fields.
  if (exponent < -1073741823n || exponent > 1073741823n || scale > 16383n) invalid();
  const significant = digits.replace(/^0+/, "");
  if (significant && BigInt(significant.length) + exponent - BigInt(fraction.length) > 131072n) invalid();
  if (!/[1-9]/.test(digits)) return "0" + (scale ? "." + "0".repeat(Number(scale)) : "");
  const point = BigInt(match[2].length) + exponent;
  let integral: string, decimal: string;
  if (point <= 0n) { integral = "0"; decimal = "0".repeat(Number(-point)) + digits; }
  else if (point >= BigInt(digits.length)) { integral = digits + "0".repeat(Number(point - BigInt(digits.length))); decimal = ""; }
  else { integral = digits.slice(0, Number(point)); decimal = digits.slice(Number(point)); }
  integral = integral.replace(/^0+/, "") || "0";
  return match[1] + integral + (scale ? "." + decimal : "");
}

/** Component-only codec, kept private. PostgreSQL17 jsonb.c/jsonb_util.c/json.c
 * define punctuation, UTF-8 byte-length/key ordering and escaping. Numeric rules
 * come from numeric.c. SQL reference vectors must admit this implementation
 * before production composition. This is not an evidence validator or P codec.
 */
async function hashComponent(input: ExactJson, validate?: () => void): Promise<string> {
  const chunks: string[] = [], ancestors = new Set<object>();
  let bytes = 0, nodes = 0, encodedKeyBytes = 0;
  function append(text: string) {
    bytes += encoder.encode(text).byteLength;
    if (bytes > byteLimit) invalid();
    chunks.push(text);
  }
  function quote(text: string) {
    if (text.length > byteLimit || !validUnicode(text) || text.includes("\0")) invalid();
    let size = encoder.encode(text).byteLength + 2;
    for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index);
      if (code === 34 || code === 92 || [8, 9, 10, 12, 13].includes(code)) size++;
      else if (code < 32) size += 5;
      if (size + bytes > byteLimit) invalid();
    }
    const escaped: string[] = ['"'];
    let start = 0;
    for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index);
      if (code >= 32 && code !== 34 && code !== 92) continue;
      escaped.push(text.slice(start, index)); start = index + 1;
      switch (code) {
        case 8: escaped.push("\\b"); break; case 12: escaped.push("\\f"); break;
        case 10: escaped.push("\\n"); break; case 13: escaped.push("\\r"); break; case 9: escaped.push("\\t"); break;
        case 34: escaped.push('\\"'); break; case 92: escaped.push("\\\\"); break;
        default: escaped.push("\\u" + code.toString(16).padStart(4, "0"));
      }
    }
    escaped.push(text.slice(start), '"'); append(escaped.join(""));
  }
  function visit(value: ExactJson, depth: number) {
    if (depth > 64 || ++nodes > 100000) invalid();
    if (value === null) { append("null"); return; }
    if (typeof value === "boolean") { append(value ? "true" : "false"); return; }
    if (typeof value === "string") { quote(value); return; }
    if (value instanceof ExactJsonNumber) { append(numeric(value)); return; }
    if (typeof value !== "object" || ancestors.has(value)) invalid();
    ancestors.add(value);
    if (Array.isArray(value)) {
      if (value.length > 100000 || Object.getOwnPropertySymbols(value).length || Object.getOwnPropertyNames(value).length !== value.length + 1) invalid();
      append("[");
      for (let index = 0; index < value.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) invalid();
        if (index) append(", ");
        visit(descriptor.value, depth + 1);
      }
      append("]");
    } else {
      const record = object(value);
      if (Object.keys(record).length > 100000) invalid();
      const keys = Object.keys(record).map(key => {
        if (key.length > byteLimit || !validUnicode(key) || key.includes("\0")) invalid();
        // Charge all key buffers cumulatively before retaining them for sorting.
        // They are a subset of the final canonical text, so this never excludes
        // an otherwise in-budget component, including nested objects.
        let length = 0;
        for (const character of key) {
          const point = character.codePointAt(0)!;
          length += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
        }
        encodedKeyBytes += length;
        if (encodedKeyBytes > byteLimit) invalid();
        return { key, encoded: encoder.encode(key) };
      }).sort((a, b) => {
        if (a.encoded.length !== b.encoded.length) return a.encoded.length - b.encoded.length;
        for (let index = 0; index < a.encoded.length; index++) if (a.encoded[index] !== b.encoded[index]) return a.encoded[index] - b.encoded[index];
        return 0;
      });
      append("{");
      keys.forEach(({ key }, index) => { if (index) append(", "); quote(key); append(": "); visit(record[key], depth + 1); });
      append("}");
    }
    ancestors.delete(value);
  }
  visit(input, 0);
  validate?.();
  const result = await crypto.subtle.digest("SHA-256", encoder.encode(chunks.join("")));
  return Array.from(new Uint8Array(result), value => value.toString(16).padStart(2, "0")).join("");
}

/** Hashes provide supplied-component consistency only, not DB existence or
 * global membership. Callers must first validate source-specific row semantics.
 * No exported function accepts a whole prepared review packet.
 */
export function hashReviewSourceRow(relation: string, value: unknown): Promise<string> {
  return hashComponent(row(relation, value));
}
export function hashReviewTarget(value: unknown): Promise<string> {
  const target = exactKeys(value, ["event_id", "product_id", "sequence", "record_hash", "original_actor_id", "policy_version_id", "opening_id", "engine_revision"]);
  // The codec rejects accessor-bearing/forged nested values before Zod may
  // inspect their numeric tokens. No commitment is returned for invalid input.
  return hashComponent(target, () => { reviewTargetSchema.parse(target); });
}
export function hashReviewEvent(value: unknown): Promise<string> {
  const event = row(eventRelation, value);
  return hashComponent(Object.fromEntries(Object.entries(event).filter(([key]) => key !== "record_hash")));
}
export function hashReviewPreparationContext(value: unknown): Promise<string> {
  return hashComponent(object(row(preparationRelation, value).context));
}
export function hashReviewParentRequest(value: unknown): Promise<string> {
  const preparation = row(preparationRelation, value);
  return hashComponent({ version: new ExactJsonNumber("1"), actor_id: preparation.actor_id, id: preparation.id,
    writer: preparation.writer, canonical_arguments: preparation.canonical_arguments, context: preparation.context });
}
export function hashReviewObligation(value: unknown): Promise<string> {
  const obligation = exactKeys(value, obligationKeys);
  return hashComponent(Object.fromEntries(Object.entries(obligation).filter(([key]) => key !== "binding_hash")));
}
