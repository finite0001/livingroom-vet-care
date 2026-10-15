import { z } from "zod";
import { identityCanonical } from "../inventory/supplier-imports/package-model.ts";
export { identityCanonical as draftCanonical };
const uuid = z.string().uuid().refine(value => value === value.toLowerCase() && value !== "00000000-0000-0000-0000-000000000000");
const version = z.number().int().min(1).max(2147483647);
const instant = z.string().datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)));
const cleanText = (maximum: number, multiline = false) => z.string().min(1).refine(value => value === value.trim() &&
  Array.from(value).length <= maximum && Array.from(value).every(character => {
    const code = character.charCodeAt(0); return (multiline && (code === 9 || code === 10)) || (code >= 32 && code !== 127);
  }), "Use clean bounded text");
export const draftOperationSchema = z.literal("draft_configuration");
export type DraftOperation = z.infer<typeof draftOperationSchema>;
export const draftDefinitionSchema = z.object({
  product_id: uuid, product_version: version, stock_unit: cleanText(50), generic_name: cleanText(200),
  brand_name: cleanText(200).nullable(), schedule: z.enum(["II", "III", "IV", "V"]), concentration: cleanText(200),
  concentration_source: cleanText(2000, true), classification_source: cleanText(2000, true), configuration_note: cleanText(2000, true),
}).strict();
export interface DraftDefinition extends z.infer<typeof draftDefinitionSchema> {}
export const draftRequestSchema = z.object({
  id: uuid, expected_version: version.nullable(), definition: draftDefinitionSchema,
  review_note: cleanText(2000, true), attest_review: z.literal(true),
}).strict();
export interface DraftRequest extends z.infer<typeof draftRequestSchema> {}
export function parseDraftRequest(operation: DraftOperation, value: unknown): DraftRequest {
  draftOperationSchema.parse(operation);
  const parsed = draftRequestSchema.safeParse(value);
  if (!parsed.success) throw new Error(parsed.error.issues.map(issue => issue.message).join("; "));
  if (new TextEncoder().encode(JSON.stringify(parsed.data)).byteLength > 32000) throw new Error("Keep this draft review below 32,000 bytes");
  return parsed.data;
}
const sourceText = (maximum: number, minimum = 0) => z.string().refine(value => Array.from(value).length >= minimum && Array.from(value).length <= maximum);
export const draftProductSchema = z.object({
  id: uuid, version, name: sourceText(200, 1), kind: z.enum(["medication", "vaccine", "service"]), manufacturer: sourceText(200), unit: sourceText(50, 1), active: z.boolean(),
}).strict();
export const draftEntrySchema = z.object({
  id: uuid, state: z.literal("draft"), product_id: uuid, version_id: uuid, version,
  definition: draftDefinitionSchema, product_snapshot: draftProductSchema,
  actor_id: uuid, actor_name: sourceText(200, 1), created_at: instant,
}).strict().superRefine((value, ctx) => {
  if (value.product_id !== value.definition.product_id || value.product_id !== value.product_snapshot.id ||
      value.product_snapshot.kind !== "medication" || value.product_snapshot.version !== value.definition.product_version || value.product_snapshot.unit !== value.definition.stock_unit)
    ctx.addIssue({ code: "custom", message: "Draft must preserve its exact medication/version/unit evidence" });
});
export interface DraftEntry extends z.infer<typeof draftEntrySchema> {}
export const draftReceiptSchema = z.object({ id: uuid, actor_id: uuid, operation: draftOperationSchema, entry: draftEntrySchema }).strict()
  .refine(value => value.actor_id === value.entry.actor_id, "Draft receipt and reviewer must agree");
export interface DraftReceipt extends z.infer<typeof draftReceiptSchema> {}
export interface DraftActionMetadata { id: string; actor_id: string; operation: DraftOperation }
export function verifyDraftReceipt(metadata: DraftActionMetadata, input: unknown, output: unknown): DraftReceipt {
  const request = parseDraftRequest(metadata.operation, input), receipt = draftReceiptSchema.parse(output);
  if (receipt.id !== metadata.id || receipt.actor_id !== metadata.actor_id || receipt.operation !== metadata.operation || receipt.entry.id !== request.id ||
      receipt.entry.version !== (request.expected_version === null ? 1 : request.expected_version + 1) || identityCanonical(receipt.entry.definition) !== identityCanonical(request.definition))
    throw new Error("Saved evidence does not match this exact draft review");
  return receipt;
}
export const draftReviewSchema = z.object({
  id: uuid, actor_id: uuid, operation: draftOperationSchema.nullable(), request: z.unknown(), expires_at: instant.nullable(),
  receipt: draftReceiptSchema.nullable(), state: z.enum(["prepared", "saved", "cancelled", "expired"]),
}).strict().superRefine((value, ctx) => {
  if (value.operation === null) {
    if (value.state !== "cancelled" || value.request !== null || value.receipt !== null || value.expires_at !== null)
      ctx.addIssue({ code: "custom", message: "Only cancelled missing preparation may omit its request" });
    return;
  }
  try {
    const request = parseDraftRequest(value.operation, value.request);
    if (value.expires_at === null || (value.state === "saved") !== (value.receipt !== null)) throw new Error("State and receipt differ");
    if (value.receipt) verifyDraftReceipt({ id: value.id, actor_id: value.actor_id, operation: value.operation }, request, value.receipt);
  } catch { ctx.addIssue({ code: "custom", message: "Draft review and saved evidence must agree" }); }
});
export interface DraftReview extends z.infer<typeof draftReviewSchema> {}
export const draftPageSchema = z.object({ items: z.array(draftEntrySchema).max(100), next: uuid.nullable() }).strict();
export const draftHistorySchema = z.object({ entry: draftEntrySchema, current_product: draftProductSchema.nullable(), history: z.array(draftEntrySchema).max(100), next: version.nullable() }).strict()
  .refine(value => value.history.every((item, index) => item.id === value.entry.id && (index === 0 || value.history[index - 1].version > item.version)) &&
    (value.next === null || value.history.at(-1)?.version === value.next), "History must preserve descending draft identity and continuation");
export const draftCancellationSchema = z.object({ cancelled: z.boolean(), receipt: draftReceiptSchema.nullable() }).strict()
  .refine(value => value.cancelled === (value.receipt === null), "Cancellation cannot erase saved draft work");
