import { z } from "zod";
import { decodeExactJson, ExactJsonNumber, protocolInteger, validUnicode, type ExactJson } from "../record-review/exact-json.ts";
import { countConfirmationTextSchema, countConfirmationVersionSchema } from "./count-admin-schema.ts";
import { parseCountManagementReply, parseCountManagementRequest, type CountManagementReadData } from "./count-management-schema.ts";

const uuid = z.string().regex(/^(?!00000000-0000-0000-0000-000000000000$)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const quantity = z.string().regex(/^(0|[1-9][0-9]{0,10})\.[0-9]{3}$/);
const timestamp = z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$/)
  .refine(value => value.slice(0, 4) !== "0000" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === `${value.slice(0, 23)}Z`);
const bounded = (characters: number, bytes: number) => z.string().min(1).refine(value => validUnicode(value) && !value.includes("\0") && [...value].length <= characters && new TextEncoder().encode(value).length <= bytes);
const schema = z.object({ schema_version: z.literal(1), state: z.literal("available"), data: z.object({ summary: z.unknown(), prepared_at: timestamp,
  recorder_name: bounded(200, 800), stock_unit: bounded(50, 200), meaning: z.object({ version: countConfirmationVersionSchema, text: countConfirmationTextSchema }).strict(),
  target_causes: z.array(z.object({ cause_id: uuid, source_count_id: uuid, source_outcome_id: uuid }).strict()).min(1).max(64), before_quantity: quantity, proposed_after_quantity: quantity }).strict() }).strict();
export interface CountReconciliationTarget { readonly cause_id: string; readonly source_count_id: string; readonly source_outcome_id: string }
export interface CountReconciliationDetail {
  readonly summary: CountManagementReadData; readonly prepared_at: string; readonly recorder_name: string; readonly stock_unit: string;
  readonly meaning: { readonly version: string; readonly text: string }; readonly target_causes: readonly CountReconciliationTarget[];
  readonly before_quantity: string; readonly proposed_after_quantity: string;
}
export interface CountReconciliationDetailReply { readonly schema_version: 1; readonly state: "available"; readonly data: CountReconciliationDetail }
function invalid(): never { throw new Error("The correction details could not be verified. Refresh before continuing."); }
function freeze<T>(value: T): T { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function thousandths(value: string): bigint {
  const negative = value.startsWith("-"), [whole, fraction = ""] = value.replace(/^-/, "").split(".");
  return (negative ? -1n : 1n) * (BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0")));
}
export function parseCountReconciliationDetail(raw: Uint8Array, input: unknown): CountReconciliationDetailReply {
  const request = parseCountManagementRequest("read", input), intrinsic = Object.getPrototypeOf(Uint8Array.prototype);
  const length = Object.getOwnPropertyDescriptor(intrinsic, "byteLength")!.get!.call(raw) as number;
  if (Object.getOwnPropertyDescriptor(intrinsic, Symbol.toStringTag)!.get!.call(raw) !== "Uint8Array" || length > 32768) invalid();
  const bytes = new Uint8Array(length); Uint8Array.prototype.set.call(bytes, raw);
  function ordinary(value: ExactJson): unknown {
    if (value instanceof ExactJsonNumber) return protocolInteger(value, 1, 1);
    if (Array.isArray(value)) return value.map(ordinary);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, ordinary(child)]));
    return value;
  }
  const parsed = schema.safeParse(ordinary(decodeExactJson(bytes))); if (!parsed.success) invalid();
  const value = parsed.data.data, read = parseCountManagementReply({ schema_version: 1, state: "available", data: value.summary });
  if (read.state !== "available") invalid();
  const summary = read.data;
  if (summary.product_id !== request.product_id || summary.site_id !== request.site_id || summary.reconciliation_id !== request.reconciliation_id ||
    value.prepared_at > summary.parent_expires_at || value.target_causes.length !== summary.target_cause_ids.length ||
    value.target_causes.some((cause, index) => cause.cause_id !== summary.target_cause_ids[index]) ||
    new Set(value.target_causes.map(cause => cause.source_count_id)).size !== value.target_causes.length ||
    new Set(value.target_causes.map(cause => cause.source_outcome_id)).size !== value.target_causes.length ||
    thousandths(value.before_quantity) + thousandths(summary.quantity_delta) !== thousandths(value.proposed_after_quantity)) invalid();
  return freeze({ schema_version: 1, state: "available", data: { ...value, summary } }) as CountReconciliationDetailReply;
}
