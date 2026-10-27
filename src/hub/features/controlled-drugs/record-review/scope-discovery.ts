import { z } from "zod";
import { protocolInteger, validUnicode } from "./exact-json.ts";
import { reviewEventKindSchema } from "./queue-model.ts";
import { reviewUuidSchema } from "./request.ts";
import { reviewJsonbTextBytes } from "./prepared-packet.ts";
const cursor = z.object({ product_id: reviewUuidSchema, view: z.enum(["exceptions", "site"]), site_id: reviewUuidSchema.nullable() }).strict()
  .refine(value => (value.view === "exceptions") === (value.site_id === null));
export const reviewScopeRequestSchema = z.object({ schema_version: z.literal(1), actor_id: reviewUuidSchema,
  cursor: cursor.nullable(), page_size: z.number().int().min(1).max(100) }).strict();
export interface ReviewScopeCursor extends z.infer<typeof cursor> {}
export interface ReviewScopeRequest extends z.infer<typeof reviewScopeRequestSchema> {}
const label = z.string().min(1).refine(value => validUnicode(value) && !value.includes("\0") && new TextEncoder().encode(value).length <= 2048);
const item = z.object({ product_id: reviewUuidSchema, product_name: label, view: z.enum(["exceptions", "site"]), site_id: reviewUuidSchema.nullable(),
  site_name: label.nullable(), event_kinds: z.array(reviewEventKindSchema).max(22).refine(values => values.every((value, index) => index === 0 || values[index - 1] < value)) }).strict()
  .refine(value => value.view === "exceptions" ? value.site_id === null && value.site_name === null && value.event_kinds.length === 0 :
    value.site_id !== null && value.site_name !== null && value.event_kinds.length > 0);
const reply = z.object({ schema_version: z.preprocess(value => protocolInteger(value, 1, 1), z.literal(1)), items: z.array(item).max(100),
  next_cursor: cursor.nullable(), has_more: z.boolean() }).strict();
export interface ReviewScopeItem extends z.infer<typeof item> {}
export interface ReviewScopeReply extends z.infer<typeof reply> {}
function compare(a: ReviewScopeCursor, b: ReviewScopeCursor): number {
  for (const key of ["product_id", "view", "site_id"] as const) {
    const left = a[key] ?? "", right = b[key] ?? "";
    if (left !== right) return left < right ? -1 : 1;
  }
  return 0;
}
export function verifyReviewScopeReply(input: unknown, response: unknown): Readonly<ReviewScopeReply> {
  if (reviewJsonbTextBytes(response) > 262144) throw new Error("Review scopes exceed the parsed response bound");
  const request = reviewScopeRequestSchema.parse(input), value = reply.parse(response);
  if (value.items.length > request.page_size) throw new Error("Review scope page exceeds its requested bound");
  let previous = request.cursor;
  for (const row of value.items) {
    if (previous && compare(previous, row) >= 0) throw new Error("Review scopes are duplicated or out of order");
    previous = row;
  }
  if (value.has_more ? !value.items.length || value.next_cursor === null || compare(value.items[value.items.length - 1], value.next_cursor) !== 0 : value.next_cursor !== null)
    throw new Error("Review scope continuation differs");
  for (const row of value.items) { Object.freeze(row.event_kinds); Object.freeze(row); }
  Object.freeze(value.items); if (value.next_cursor) Object.freeze(value.next_cursor);
  return Object.freeze(value);
}
