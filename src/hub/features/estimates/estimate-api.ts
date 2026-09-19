import { z } from "zod";
import type { PrescriptionRpc } from "../prescriptions/prescription-api.ts";
import { correctionEqual } from "../prescriptions/fulfillment-corrections-api.ts";

export interface EstimateUnitPricing { kind: "unit"; unit_price_cents: string }
export interface EstimateAllocatedPricing { kind: "allocated"; amount_cents: string }
export type EstimatePricing = EstimateUnitPricing | EstimateAllocatedPricing;
export interface EstimateLine {
  id: string;
  product_id: string;
  product_version: number;
  description: string;
  kind: "service" | "medication" | "vaccine";
  unit: string;
  quantity: string;
  pricing: EstimatePricing;
  pricing_reason: string | null;
}
export interface EstimateFields {
  title: string;
  notes: string;
  terms: string;
  accept_by: string;
  lines: EstimateLine[];
}
export interface EstimateDraft {
  id: string;
  client_id: string;
  pet_id: string;
  version: number;
  fields: EstimateFields;
  total_cents: string;
  created_by: string;
  created_at: string;
  updated_by: string;
  updated_at: string;
}
export interface EstimateRequest {
  estimate_id: string;
  client_id: string;
  pet_id: string;
  expected_version: number | null;
  fields: EstimateFields;
}
export interface EstimateOperation {
  id: string;
  kind: "save_estimate_draft";
  payload: EstimateRequest;
}
export interface EstimateReceipt {
  version: 1;
  id: string;
  actor_id: string;
  request: EstimateRequest;
  request_hash: string;
  result: EstimateDraft;
  created_at: string;
}
export interface EstimateClosure {
  version: 1;
  id: string;
  actor_id: string;
  request: EstimateRequest;
  request_hash: string;
  closed_at: string;
  record_hash: string;
}
export interface EstimateRecordedResolution { version: 1; status: "recorded"; receipt: EstimateReceipt }
export interface EstimateClosedResolution { version: 1; status: "closed_unrecorded"; closure: EstimateClosure }
export type EstimateCloseResult = EstimateRecordedResolution | EstimateClosedResolution;
export interface EstimateCursor { before_at: string; before_id: string }
export interface EstimateList {
  version: 1; actor_id: string; client_id: string;
  drafts: EstimateDraft[]; has_more: boolean; next_cursor: EstimateCursor | null;
}
export interface EstimateHistory {
  version: 1; actor_id: string; client_id: string; estimate_id: string;
  revisions: EstimateDraft[]; has_more: boolean; next_before_version: number | null;
}

const maximumCents = 9223372036854775807n;
const uuid = z.string().uuid().refine(v => v === v.toLowerCase());
const revision = z.number().int().min(1).max(2147483647);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const instant = z.string().datetime({ offset: true }).refine(v => Number.isFinite(Date.parse(v)) && !/\.\d{7}/.test(v));
const text = (min: number, max: number) => z.string().refine(v =>
  v === v.trim() && Array.from(v).length >= min && Array.from(v).length <= max &&
  !Array.from(v).some(c => { const n = c.charCodeAt(0); return n === 127 || (n < 32 && n !== 9 && n !== 10); }));
const cents = z.string().refine(v => /^(0|[1-9]\d*)$/.test(v) && v.length <= 19 && BigInt(v) <= maximumCents);
const quantity = z.string().regex(/^(?:0|[1-9]\d{0,10})(?:\.\d{0,2}[1-9])?$/).refine(v => v !== "0");
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {
  const d = new Date(`${v}T00:00:00Z`);
  return v >= "0001-01-01" && Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
});
export function parseQuantity(value: string): bigint {
  quantity.parse(value);
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0"));
}
export function dollarsToEstimateCents(value: string): string {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value)) throw new Error("Enter dollars with at most two decimal places.");
  const [whole, fraction = ""] = value.split(".");
  return cents.parse((BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"))).toString());
}
const pricing = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("unit"), unit_price_cents: cents }).strict(),
  z.object({ kind: z.literal("allocated"), amount_cents: cents }).strict(),
]);
export const estimateLineSchema = z.object({
  id: uuid, product_id: uuid, product_version: revision, description: text(1, 300),
  kind: z.enum(["service", "medication", "vaccine"]), unit: text(1, 50), quantity,
  pricing, pricing_reason: text(1, 2000).nullable(),
}).strict().refine(v => v.pricing_reason !== null ||
  (v.pricing.kind === "unit" && v.pricing.unit_price_cents !== "0"));
export function estimateLineCents(line: EstimateLine): string {
  const v = estimateLineSchema.parse(line);
  const amount = v.pricing.kind === "allocated" ? BigInt(v.pricing.amount_cents) :
    (parseQuantity(v.quantity) * BigInt(v.pricing.unit_price_cents) + 500n) / 1000n;
  if (amount === 0n && v.pricing_reason === null) throw new Error("A zero amount needs a pricing reason.");
  return cents.parse(amount.toString());
}
export function estimateTotalCents(lines: EstimateLine[]): string {
  return cents.parse(lines.reduce((sum, line) => sum + BigInt(estimateLineCents(line)), 0n).toString());
}
export const estimateFieldsSchema = z.object({
  title: text(1, 200), notes: text(0, 4000), terms: text(1, 8000), accept_by: day,
  lines: z.array(estimateLineSchema).min(1).max(100),
}).strict().superRefine((v, ctx) => {
  if (new Set(v.lines.map(l => l.id)).size !== v.lines.length)
    ctx.addIssue({ code: "custom", message: "Every estimate line needs a distinct identity." });
  try { estimateTotalCents(v.lines as EstimateLine[]); }
  catch { ctx.addIssue({ code: "custom", message: "Estimate total exceeds the supported amount." }); }
});
export const estimateRequestSchema = z.object({
  estimate_id: uuid, client_id: uuid, pet_id: uuid, expected_version: revision.nullable(), fields: estimateFieldsSchema,
}).strict();
const draftSchema = z.object({
  id: uuid, client_id: uuid, pet_id: uuid, version: revision, fields: estimateFieldsSchema,
  total_cents: cents, created_by: uuid, created_at: instant, updated_by: uuid, updated_at: instant,
}).strict();
const operationSchema = z.object({ id: uuid, kind: z.literal("save_estimate_draft"), payload: estimateRequestSchema }).strict();
const receiptSchema = z.object({
  version: z.literal(1), id: uuid, actor_id: uuid, request: estimateRequestSchema,
  request_hash: hash, result: draftSchema, created_at: instant,
}).strict();
const closureSchema = z.object({
  version: z.literal(1), id: uuid, actor_id: uuid, request: estimateRequestSchema,
  request_hash: hash, closed_at: instant, record_hash: hash,
}).strict();
const resolutionSchema = z.discriminatedUnion("status", [
  z.object({ version: z.literal(1), status: z.literal("recorded"), receipt: receiptSchema }).strict(),
  z.object({ version: z.literal(1), status: z.literal("closed_unrecorded"), closure: closureSchema }).strict(),
]);
const cursorSchema = z.object({ before_at: instant, before_id: uuid }).strict();
const listSchema = z.object({
  version: z.literal(1), actor_id: uuid, client_id: uuid, drafts: z.array(draftSchema),
  has_more: z.boolean(), next_cursor: cursorSchema.nullable(),
}).strict();
const historySchema = z.object({
  version: z.literal(1), actor_id: uuid, client_id: uuid, estimate_id: uuid,
  revisions: z.array(draftSchema), has_more: z.boolean(), next_before_version: revision.nullable(),
}).strict();
const readSchema = z.object({ version: z.literal(1), actor_id: uuid, draft: draftSchema.nullable() }).strict();
function check(value: unknown): asserts value {
  if (!value) throw new Error("Estimate evidence does not match this household, version or saved request.");
}
function micros(value: string) {
  const fraction = value.match(/\.(\d+)/)?.[1] || "";
  return BigInt(Date.parse(value)) * 1000n + BigInt(fraction.padEnd(6, "0").slice(3, 6));
}
function before(a: EstimateDraft, cursor: EstimateCursor) {
  const at = micros(a.created_at), bt = micros(cursor.before_at);
  return at < bt || (at === bt && a.id < cursor.before_id);
}
export function createEstimateDraftApi(client: PrescriptionRpc, actorId: string, clientId: string) {
  uuid.parse(actorId); uuid.parse(clientId);
  async function rpc(name: string, args: Record<string, unknown>) {
    const { data, error } = await client.rpc(name, args);
    if (error) throw error;
    return data;
  }
  function validateDraft(value: unknown): EstimateDraft {
    const d = draftSchema.parse(value) as EstimateDraft;
    check(d.client_id === clientId && d.total_cents === estimateTotalCents(d.fields.lines) && micros(d.created_at) <= micros(d.updated_at));
    if (d.version === 1) check(d.created_by === d.updated_by && micros(d.created_at) === micros(d.updated_at));
    return d;
  }
  function parseOperation(value: unknown): EstimateOperation {
    const op = operationSchema.parse(value) as EstimateOperation;
    check(op.payload.client_id === clientId);
    return op;
  }
  function parseReceipt(value: unknown, operation: EstimateOperation): EstimateReceipt {
    const r = receiptSchema.parse(value) as EstimateReceipt, q = operation.payload, d = validateDraft(r.result);
    check(r.id === operation.id && r.actor_id === actorId && correctionEqual(r.request, q) &&
      d.id === q.estimate_id && d.pet_id === q.pet_id && d.version === (q.expected_version ?? 0) + 1 &&
      correctionEqual(d.fields, q.fields) && d.updated_by === actorId && micros(d.updated_at) === micros(r.created_at));
    return r;
  }
  return {
    parseOperation,
    async save(operation: EstimateOperation): Promise<EstimateReceipt> {
      const op = parseOperation(operation);
      return parseReceipt(await rpc("save_native_estimate_draft", { p_id: op.id, p_request: op.payload }), op);
    },
    async recover(operation: EstimateOperation): Promise<EstimateReceipt | null> {
      const op = parseOperation(operation), raw = await rpc("recover_native_estimate_draft", { p_id: op.id });
      return raw === null ? null : parseReceipt(raw, op);
    },
    async close(operation: EstimateOperation): Promise<EstimateCloseResult> {
      const op = parseOperation(operation);
      const r = resolutionSchema.parse(await rpc("close_native_estimate_draft", { p_id: op.id, p_request: op.payload }));
      if (r.status === "recorded") return { version: 1, status: "recorded", receipt: parseReceipt(r.receipt, op) };
      check(r.closure.id === op.id && r.closure.actor_id === actorId && correctionEqual(r.closure.request, op.payload));
      return r as EstimateClosedResolution;
    },
    async read(id: string): Promise<EstimateDraft | null> {
      uuid.parse(id);
      const r = readSchema.parse(await rpc("read_native_estimate_draft", { p_id: id, p_client_id: clientId }));
      check(r.actor_id === actorId);
      if (r.draft === null) return null;
      const d = validateDraft(r.draft); check(d.id === id); return d;
    },
    async list(cursor: EstimateCursor | null = null, limit = 20): Promise<EstimateList> {
      if (cursor !== null) cursorSchema.parse(cursor);
      z.number().int().min(1).max(100).parse(limit);
      const r = listSchema.parse(await rpc("list_native_estimate_drafts", {
        p_client_id: clientId, p_before_at: cursor?.before_at ?? null, p_before_id: cursor?.before_id ?? null, p_limit: limit,
      })) as EstimateList;
      check(r.actor_id === actorId && r.client_id === clientId && r.drafts.length <= limit);
      const seen = new Set<string>();
      r.drafts.forEach((d, i) => {
        validateDraft(d); check(!seen.has(d.id)); seen.add(d.id);
        if (cursor) check(before(d, cursor));
        if (i) check(before(d, { before_at: r.drafts[i - 1].created_at, before_id: r.drafts[i - 1].id }));
      });
      const last = r.drafts.at(-1);
      check(r.has_more ? last && r.drafts.length === limit && correctionEqual(r.next_cursor, { before_at: last.created_at, before_id: last.id }) : r.next_cursor === null);
      return r;
    },
    async history(id: string, beforeVersion: number | null = null, limit = 20): Promise<EstimateHistory> {
      uuid.parse(id); if (beforeVersion !== null) revision.parse(beforeVersion);
      z.number().int().min(1).max(100).parse(limit);
      const r = historySchema.parse(await rpc("read_native_estimate_draft_history", {
        p_id: id, p_client_id: clientId, p_before_version: beforeVersion, p_limit: limit,
      })) as EstimateHistory;
      check(r.actor_id === actorId && r.client_id === clientId && r.estimate_id === id && r.revisions.length <= limit);
      r.revisions.forEach((d, i) => {
        validateDraft(d); check(d.id === id && (beforeVersion === null || d.version < beforeVersion));
        if (i) {
          const prior = r.revisions[i - 1];
          check(d.version === prior.version - 1 && d.pet_id === prior.pet_id && d.created_by === prior.created_by && micros(d.created_at) === micros(prior.created_at) && micros(d.updated_at) <= micros(prior.updated_at));
        }
      });
      const last = r.revisions.at(-1);
      check(r.has_more ? last && r.revisions.length === limit && last.version > 1 && r.next_before_version === last.version : r.next_before_version === null && (!last || last.version === 1));
      return r;
    },
  };
}
