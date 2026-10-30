import { z } from "zod";
import { decodeExactJson, ExactJsonNumber, protocolInteger, validUnicode, type ExactJson } from "../record-review/exact-json.ts";
import { countConfirmationTextSchema, countConfirmationVersionSchema, parseCountPolicyRequest } from "./count-admin-schema.ts";

const uuid = z.string().regex(/^(?!00000000-0000-0000-0000-000000000000$)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const text = (characters: number, bytes: number) => z.string().min(1).refine(value => validUnicode(value) && !value.includes("\0") && [...value].length <= characters && new TextEncoder().encode(value).length <= bytes && value.trim().length > 0);
const cause = z.object({ cause_id: uuid, source_count_id: uuid, source_outcome_id: uuid, category: z.literal("terminal_variance") }).strict();
const footprint = z.object({ cell_id: uuid, container_id: uuid, lot_id: uuid, site_id: uuid, location_id: uuid, stock_unit: text(50, 200), channel: z.literal("available") }).strict();
const meaning = z.object({ version: countConfirmationVersionSchema, text: countConfirmationTextSchema }).strict();
const schema = z.object({ schema_version: z.literal(1), state: z.enum(["eligible", "blocked", "empty"]), data: z.object({ product_id: uuid, site_id: uuid,
  causes: z.array(cause).max(64).nullable(), footprint: footprint.nullable(), meaning: meaning.nullable(), blocked_reason: z.literal("investigation_required").nullable() }).strict() }).strict();
export interface CountEligibleCause { readonly cause_id: string; readonly source_count_id: string; readonly source_outcome_id: string; readonly category: "terminal_variance" }
export interface CountCauseFootprint { readonly cell_id: string; readonly container_id: string; readonly lot_id: string; readonly site_id: string; readonly location_id: string; readonly stock_unit: string; readonly channel: "available" }
export interface CountCauseDiscoveryReply {
  readonly schema_version: 1; readonly state: "eligible" | "blocked" | "empty";
  readonly data: { readonly product_id: string; readonly site_id: string; readonly causes: readonly CountEligibleCause[] | null;
    readonly footprint: CountCauseFootprint | null; readonly meaning: Readonly<{ version: string; text: string }> | null; readonly blocked_reason: "investigation_required" | null };
}
function invalid(): never { throw new Error("The investigation list could not be verified. Refresh before continuing."); }
function freeze<T>(input: T): T { if (input && typeof input === "object") { Object.values(input).forEach(freeze); Object.freeze(input); } return input; }
export function parseCountCauseDiscoveryReply(raw: Uint8Array, input: unknown): CountCauseDiscoveryReply {
  const request = parseCountPolicyRequest(input), intrinsic = Object.getPrototypeOf(Uint8Array.prototype);
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
  const result = parsed.data as CountCauseDiscoveryReply, data = result.data;
  if (data.product_id !== request.product_id || data.site_id !== request.site_id) invalid();
  if (result.state === "blocked") {
    if (data.causes !== null || data.footprint !== null || data.meaning !== null || data.blocked_reason !== "investigation_required") invalid();
  } else if (result.state === "empty") {
    if (!data.causes || data.causes.length || data.footprint !== null || data.meaning !== null || data.blocked_reason !== null) invalid();
  } else {
    if (!data.causes?.length || !data.footprint || !data.meaning || data.footprint.site_id !== request.site_id || data.blocked_reason !== null ||
      new Set(data.causes.map(item => item.source_count_id)).size !== data.causes.length || new Set(data.causes.map(item => item.source_outcome_id)).size !== data.causes.length ||
      data.causes.some((item, index) => index > 0 && data.causes![index - 1].cause_id >= item.cause_id)) invalid();
  }
  return freeze(result);
}
