import { z } from "zod";

export const sourceItemSchema = z.object({
  id: z.string().guid(),
  source_tab: z.string(),
  source_row: z.number().int().min(2),
  name: z.string(),
  source_fields: z.record(z.string(), z.string()),
  source_url: z.string().url(),
  captured_on: z.string(),
  products: z.array(
    z.object({
      id: z.string().guid(),
      name: z.string(),
      active: z.boolean(),
    }),
  ),
});
export interface SourceItem extends z.infer<typeof sourceItemSchema> {}

export const configureSourceSchema = z.object({
  p_actor_id: z.string().guid(),
  p_source_id: z.string().guid(),
  p_id: z.string().guid(),
  p_name: z.string().trim().min(1).max(200),
  p_kind: z.enum(["medication", "vaccine"]),
  p_manufacturer: z.string().trim().max(200),
  p_unit: z.string().trim().min(1).max(50),
  p_unit_price_cents: z.number().int().min(0).max(100000000),
});
export interface ConfigureSource
  extends z.infer<typeof configureSourceSchema> {}
export const linkSourceSchema = z.object({
  p_actor_id: z.string().guid(),
  p_source_id: z.string().guid(),
  p_product_id: z.string().guid(),
});
