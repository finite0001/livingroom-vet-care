import { z } from "zod";
import { administrationDigest, administrationInstant, administrationName, administrationStaffRoles, administrationText, administrationUuid, administrationRecordVersion, freezeAdministration } from "./primitives.ts";
import { administrationPointerSchema, administrationProtocolValue } from "./schema.ts";
import { openingQuantitySchema, openingSlotIdentity, openingSlotSchema, stockPolicyDefinitionSchema } from "./opening-definition.ts";
import type { ExactJson } from "../record-review/exact-json.ts";
export const administrationPrincipal = { schema_version: z.literal(1), actor_id: administrationUuid };
export const administrationScopeRequestSchema = z.object({ ...administrationPrincipal, product_id: administrationUuid, site_id: administrationUuid }).strict();
export const administrationOptionsRequestSchema = z.object({ ...administrationPrincipal, cursor: z.object({ product_id: administrationUuid }).strict().nullable(), page_size: z.number().int().min(1).max(100) }).strict();
export interface AdministrationOptionsRequest extends z.infer<typeof administrationOptionsRequestSchema> {}
export const administrationProductSchema = z.object({ id: administrationUuid, name: administrationName, version: administrationRecordVersion, stock_unit: administrationText(50, 200), draft_version_id: administrationUuid.nullable(), managed: z.boolean() }).strict();
export const administrationSiteSchema = z.object({ id: administrationUuid, label: administrationName }).strict();
export const administrationLocationSchema = z.object({ id: administrationUuid, site_id: administrationUuid, label: administrationName, kind: z.enum(["clinic", "mobile_kit"]), initial_custodian_id: administrationUuid.nullable() }).strict();
export const administrationStaffSchema = z.object({ id: administrationUuid, name: administrationName,
  roles: z.array(z.enum(administrationStaffRoles)).max(4).refine(values => values.every((value, index) => index === 0 || values[index - 1] < value)) }).strict();
export const administrationOptionsReplySchema = z.object({ schema_version: z.literal(1), actor_id: administrationUuid, products: z.array(administrationProductSchema).max(100), sites: z.array(administrationSiteSchema).max(256),
  locations: z.array(administrationLocationSchema).max(256), staff: z.array(administrationStaffSchema).max(256), next_cursor: z.object({ product_id: administrationUuid }).strict().nullable(), has_more: z.boolean() }).strict();
export interface AdministrationOptions extends z.infer<typeof administrationOptionsReplySchema> {}
export interface AdministrationProduct extends z.infer<typeof administrationProductSchema> {}
export interface AdministrationSite extends z.infer<typeof administrationSiteSchema> {}
export interface AdministrationLocation extends z.infer<typeof administrationLocationSchema> {}
export interface AdministrationStaff extends z.infer<typeof administrationStaffSchema> {}
function ascending(rows: readonly { id?: string }[]) { return rows.every((value, index) => index === 0 || rows[index - 1].id! < value.id!); }
export function parseAdministrationOptions(raw: ExactJson, input: unknown): Readonly<AdministrationOptions> {
  const request = administrationOptionsRequestSchema.parse(input), value = administrationOptionsReplySchema.parse(administrationProtocolValue(raw));
  if (value.actor_id !== request.actor_id || value.products.length > request.page_size || ![value.products, value.sites, value.locations, value.staff].every(ascending) ||
    value.products.some(row => request.cursor !== null && row.id! <= request.cursor.product_id!) || value.locations.some(row => !value.sites.some(site => site.id === row.site_id)) ||
    (value.has_more ? !value.products.length || value.next_cursor?.product_id !== value.products[value.products.length - 1].id : value.next_cursor !== null)) throw new Error("Administrator options do not match the requested page.");
  return freezeAdministration(value);
}
export const stockOpeningPreviewRequestSchema = z.object({ ...administrationPrincipal, product_id: administrationUuid, draft_version_id: administrationUuid }).strict();
const previewProduct = administrationProductSchema.omit({ draft_version_id: true, managed: true });
export const openingPreviewSlotSchema = z.object({ slot: openingSlotSchema, display_label: administrationName, recorded_quantity: openingQuantitySchema,
  custody_state: z.enum(["onsite", "handed_off", "disposed"]), observation_required: z.boolean() }).strict();
export interface OpeningPreviewSlot extends z.infer<typeof openingPreviewSlotSchema> {}
export const stockOpeningPreviewReplySchema = z.object({ schema_version: z.literal(1), state: z.enum(["available", "blocked"]), data: z.object({ product: previewProduct,
  draft_version_id: administrationUuid, source_basis_digest: administrationDigest.nullable(), slots: z.array(openingPreviewSlotSchema).min(1).max(512).nullable(), blocked_reason: z.string().min(1).max(200).nullable() }).strict() }).strict()
  .refine(value => value.state === "available" ? value.data.source_basis_digest !== null && value.data.slots !== null && value.data.blocked_reason === null : value.data.slots === null && value.data.blocked_reason !== null);
export interface StockOpeningPreview extends z.infer<typeof stockOpeningPreviewReplySchema> {}
export function parseStockOpeningPreview(raw: ExactJson, input: unknown): Readonly<StockOpeningPreview> {
  const request = stockOpeningPreviewRequestSchema.parse(input), value = stockOpeningPreviewReplySchema.parse(administrationProtocolValue(raw));
  if (value.data.product.id !== request.product_id || value.data.draft_version_id !== request.draft_version_id) throw new Error("Opening preview belongs to another medication or draft.");
  const slots = value.data.slots;
  if (slots && (slots.some((row, index) => index > 0 && openingSlotIdentity(slots[index - 1].slot) >= openingSlotIdentity(row.slot)) || slots.some(row =>
    row.custody_state === "onsite" ? !row.observation_required : row.observation_required || row.recorded_quantity !== "0.000"))) throw new Error("Opening preview custody or complete slot membership differs.");
  return freezeAdministration(value);
}
export const currentStockPolicyReplySchema = z.object({ schema_version: z.literal(1), state: z.enum(["available", "not_configured"]), data: z.object({
  product: z.object({ id: administrationUuid, name: administrationName, stock_unit: administrationText(50, 200) }).strict(), site: administrationSiteSchema,
  policy_version_id: administrationUuid, policy_version: administrationRecordVersion, opening_id: administrationUuid.nullable(),
  state: z.object({ head_id: administrationUuid, state: z.enum(["opening_frozen", "active", "suspended", "retired"]), version: administrationRecordVersion }).strict(),
  draft_version_id: administrationUuid, current_draft_version_id: administrationUuid, policy: stockPolicyDefinitionSchema, published_at: administrationInstant,
}).strict().nullable() }).strict().refine(value => (value.state === "not_configured") === (value.data === null));
export interface CurrentStockPolicy extends z.infer<typeof currentStockPolicyReplySchema> {}
export function parseCurrentStockPolicy(raw: ExactJson, input: unknown): Readonly<CurrentStockPolicy> {
  const request = administrationScopeRequestSchema.parse(input), value = currentStockPolicyReplySchema.parse(administrationProtocolValue(raw));
  if (value.data && (value.data.product.id !== request.product_id || value.data.site.id !== request.site_id)) throw new Error("Stock policy belongs to another medication or site.");
  return freezeAdministration(value);
}
const operationCursor = z.object({ created_at: administrationInstant, operation_id: administrationUuid }).strict();
export const administrationOperationsRequestSchema = z.object({ ...administrationPrincipal, cursor: operationCursor.nullable(), page_size: z.number().int().min(1).max(100) }).strict();
export interface AdministrationOperationsRequest extends z.infer<typeof administrationOperationsRequestSchema> {}
export const administrationOperationsReplySchema = z.object({ schema_version: z.literal(1), items: z.array(z.object({ pointer: administrationPointerSchema, created_at: administrationInstant,
  expires_at: administrationInstant, state: z.enum(["not_found", "prepared", "saved", "abandoned", "expired"]) }).strict()).max(100), next_cursor: operationCursor.nullable(), has_more: z.boolean() }).strict();
export interface AdministrationOperationsPage extends z.infer<typeof administrationOperationsReplySchema> {}
export function parseAdministrationOperations(raw: ExactJson, input: unknown): Readonly<AdministrationOperationsPage> {
  const request = administrationOperationsRequestSchema.parse(input), value = administrationOperationsReplySchema.parse(administrationProtocolValue(raw));
  let previous = request.cursor; const ids = new Set<string>();
  for (const row of value.items) {
    if (row.pointer.actor_id !== request.actor_id || ids.has(row.pointer.operation_id!) || Date.parse(row.expires_at!) - Date.parse(row.created_at!) !== 15 * 60000 ||
      previous && (row.created_at! > previous.created_at! || row.created_at === previous.created_at && row.pointer.operation_id! >= previous.operation_id!)) throw new Error("Administrator operation history differs.");
    previous = { created_at: row.created_at, operation_id: row.pointer.operation_id }; ids.add(row.pointer.operation_id!);
  }
  const last = value.items[value.items.length - 1];
  if (value.items.length > request.page_size || (value.has_more ? !last || value.next_cursor?.created_at !== last.created_at || value.next_cursor.operation_id !== last.pointer.operation_id : value.next_cursor !== null)) throw new Error("Administrator operation continuation differs.");
  return freezeAdministration(value);
}
