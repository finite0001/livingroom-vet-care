import { z } from "zod";
import { normalizedGtin, supplierSchema, supplierSkuSchema } from "./identifier-model.ts";
import { packageConversionSchema } from "./quantity-model.ts";

const uuid = z.string().uuid().refine((value) => value !== "00000000-0000-0000-0000-000000000000" && value === value.toLowerCase());
const version = z.number().int().min(1).max(2147483647);
const instant = z.string().datetime({ offset: true }).refine((value) => Number.isFinite(Date.parse(value)));
const text = (maximum: number) => z.string().min(1).refine((value) =>
  value === value.trim() && Array.from(value).length <= maximum &&
  Array.from(value).every((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127),
"Use clean bounded text");
const sourceText = (maximum: number, minimum = 0) => z.string().refine((value) =>
  Array.from(value).length >= minimum && Array.from(value).length <= maximum);
export const identityOperationSchema = z.enum(["namespace", "package"]);
export const namespaceDefinitionSchema = z.object({
  supplier: supplierSchema,
  account_label: text(200),
  catalog_scope: text(200),
  active: z.boolean(),
}).strict();
export interface NamespaceDefinition extends z.infer<typeof namespaceDefinitionSchema> {}
export const packageIdentifierSchema = z.object({
  kind: z.enum(["supplier_sku", "supplier_barcode", "gtin"]),
  namespace_id: uuid.nullable(),
  namespace_version_id: uuid.nullable(),
  value: text(200),
  raw_source: text(1000),
}).strict().superRefine((value, ctx) => {
  if (value.kind === "gtin") {
    try {
      if (value.namespace_id !== null || value.namespace_version_id !== null ||
          normalizedGtin(value.value) !== value.value || normalizedGtin(value.raw_source) !== value.value)
        throw new Error("GTIN scope/original code differs");
    } catch {
      ctx.addIssue({ code: "custom", message: "Use a normalized GTIN with its matching original code and no supplier scope" });
    }
  } else if (value.namespace_id === null || value.namespace_version_id === null || !supplierSkuSchema.safeParse(value.value).success) {
    ctx.addIssue({ code: "custom", message: "Select an exact reviewed supplier namespace and keep its original identifier text" });
  }
});
export interface PackageIdentifier extends z.infer<typeof packageIdentifierSchema> {}
export const packageDefinitionSchema = z.object({
  product_id: uuid,
  product_version: version,
  stock_unit: text(50),
  label: text(200),
  manufacturer: text(200),
  strength: text(200),
  form: text(100),
  purchase_unit: text(50),
  conversion: packageConversionSchema,
  identifiers: z.array(packageIdentifierSchema).max(50).refine((values) =>
    new Set(values.map((value) => JSON.stringify([value.kind, value.namespace_id?.toLowerCase() ?? null, value.value]))).size === values.length,
  "Select each scoped identifier once"),
  active: z.boolean(),
}).strict();
export interface PackageDefinition extends z.infer<typeof packageDefinitionSchema> {}
const requestBase = {
  id: uuid,
  expected_version: version.nullable(),
  review_note: z.string().min(1).refine((value) => value === value.trim() && Array.from(value).length <= 2000 &&
    Array.from(value).every((character) => {
      const code = character.charCodeAt(0);
      return code === 9 || code === 10 || (code >= 32 && code !== 127);
    })),
  attest_review: z.literal(true),
};
export const namespaceRequestSchema = z.object({ ...requestBase, definition: namespaceDefinitionSchema }).strict();
export const packageRequestSchema = z.object({ ...requestBase, definition: packageDefinitionSchema }).strict();
export interface NamespaceRequest extends z.infer<typeof namespaceRequestSchema> {}
export interface PackageRequest extends z.infer<typeof packageRequestSchema> {}
export type IdentityRequest = NamespaceRequest | PackageRequest;
export type IdentityOperation = z.infer<typeof identityOperationSchema>;
export function parseIdentityRequest(operation: IdentityOperation, value: unknown): IdentityRequest {
  const parsed = operation === "namespace" ? namespaceRequestSchema.safeParse(value) : packageRequestSchema.safeParse(value);
  if (!parsed.success) throw new Error(parsed.error.issues.map((issue) => issue.message).join("; "));
  if (new TextEncoder().encode(JSON.stringify(parsed.data)).byteLength > 32000)
    throw new Error("Keep this reviewed request below 32,000 bytes");
  return parsed.data;
}
const productSnapshotSchema = z.object({
  id: uuid, version, name: sourceText(200, 1), kind: z.enum(["medication", "vaccine"]),
  manufacturer: sourceText(200), unit: sourceText(50, 1), active: z.boolean(),
}).strict();
const entryBase = {
  id: uuid, version_id: uuid, version, actor_id: uuid,
  actor_name: sourceText(200, 1), created_at: instant,
};
export const identityEntrySchema = z.discriminatedUnion("kind", [
  z.object({ ...entryBase, kind: z.literal("namespace"), product_id: z.null(), product_snapshot: z.null(), definition: namespaceDefinitionSchema }).strict(),
  z.object({ ...entryBase, kind: z.literal("package"), product_id: uuid, product_snapshot: productSnapshotSchema, definition: packageDefinitionSchema }).strict(),
]).superRefine((value, ctx) => {
  if (value.kind === "package" && (value.product_id !== value.definition.product_id || value.product_id !== value.product_snapshot.id ||
      value.product_snapshot.version !== value.definition.product_version || value.product_snapshot.unit !== value.definition.stock_unit))
    ctx.addIssue({ code: "custom", message: "Package evidence must match the exact captured stock product/version/unit" });
});
export type IdentityEntry = z.infer<typeof identityEntrySchema>;
export const identityReceiptSchema = z.object({
  id: uuid, actor_id: uuid, operation: identityOperationSchema, entry: identityEntrySchema,
}).strict().refine((value) => value.operation === value.entry.kind && value.actor_id === value.entry.actor_id,
"Receipt must match its operation and recorded reviewer");
export interface IdentityReceipt extends z.infer<typeof identityReceiptSchema> {}
export const identityReviewSchema = z.object({
  id: uuid, actor_id: uuid, operation: identityOperationSchema.nullable(),
  request: z.unknown(), expires_at: instant.nullable(), receipt: identityReceiptSchema.nullable(),
  state: z.enum(["prepared", "saved", "cancelled", "expired"]),
}).strict().superRefine((value, ctx) => {
  if (value.operation === null) {
    if (value.state !== "cancelled" || value.request !== null || value.receipt !== null || value.expires_at !== null)
      ctx.addIssue({ code: "custom", message: "Only a closed missing preparation can omit its request" });
    return;
  }
  try {
    const request = parseIdentityRequest(value.operation, value.request);
    if (value.expires_at === null || (value.state === "saved") !== (value.receipt !== null)) throw new Error("State and receipt differ");
    if (value.receipt) verifyIdentityReceipt({ id: value.id, actor_id: value.actor_id, operation: value.operation }, request, value.receipt);
  } catch { ctx.addIssue({ code: "custom", message: "Original review and saved evidence must agree" }); }
});
export interface IdentityReview extends z.infer<typeof identityReviewSchema> {}
export const identityPageSchema = z.object({ items: z.array(identityEntrySchema).max(100), next: uuid.nullable() }).strict();
export const identityHistorySchema = z.object({ entry: identityEntrySchema, current_product: productSnapshotSchema.nullable(), history: z.array(identityEntrySchema).max(100), next: version.nullable() }).strict()
  .refine((value) => value.history.every((item, index) => item.id === value.entry.id && item.kind === value.entry.kind &&
    (index === 0 || value.history[index - 1].version > item.version)) &&
    (value.next === null || value.history[value.history.length - 1]?.version === value.next), "History must preserve its identity and descending continuation");
export const identifierMatchesSchema = z.object({ items: z.array(identityEntrySchema).max(100), more: z.boolean() }).strict()
  .refine((value) => value.items.every((item) => item.kind === "package"), "Only reviewed packages are identifier candidates");
export const identityCancellationSchema = z.object({ cancelled: z.boolean(), receipt: identityReceiptSchema.nullable() }).strict()
  .refine((value) => value.cancelled === (value.receipt === null), "Cancellation cannot erase saved work");
export interface IdentityActionMetadata { id: string; actor_id: string; operation: IdentityOperation }
export function identityCanonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(identityCanonical).join(",") + "]";
  if (value !== null && typeof value === "object") return "{" + Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, child]) => JSON.stringify(key) + ":" + identityCanonical(child)).join(",") + "}";
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Inventory evidence must contain JSON values");
  return encoded;
}
export function verifyIdentityReceipt(metadata: IdentityActionMetadata, input: unknown, output: unknown): IdentityReceipt {
  const request = parseIdentityRequest(metadata.operation, input), receipt = identityReceiptSchema.parse(output);
  if (receipt.id !== metadata.id || receipt.actor_id !== metadata.actor_id || receipt.operation !== metadata.operation ||
      receipt.entry.id !== request.id || receipt.entry.version !== (request.expected_version === null ? 1 : request.expected_version + 1) ||
      identityCanonical(receipt.entry.definition) !== identityCanonical(request.definition))
    throw new Error("Saved evidence does not match this exact reviewed package or supplier namespace");
  return receipt;
}
