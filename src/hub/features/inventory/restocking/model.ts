import { z } from "zod";
const uuid = z.string().guid();
export const thresholdSchema = z
  .string()
  .trim()
  .regex(
    /^\d+(\.\d{1,3})?$/,
    "Enter a nonnegative quantity with at most three decimals.",
  )
  .transform(Number)
  .pipe(z.number().min(0).max(99999999999.999));
export const restockSchema = z.object({
  as_of: z.string().datetime({ offset: true }),
  rows: z.array(
    z.object({
      id: uuid,
      name: z.string(),
      unit: z.string(),
      threshold: z.number().nonnegative().nullable(),
      version: z.number().int().positive(),
      counted: z.boolean(),
      balance: z.number(),
    }),
  ),
});
export type RestockRow = z.infer<typeof restockSchema>["rows"][number];
export function restockState(row: RestockRow) {
  if (row.threshold === null) return "disabled";
  if (!row.counted) return "uncounted";
  return row.balance <= row.threshold ? "low" : "ok";
}
export const settingSchema = z.object({
  p_actor_id: uuid,
  p_product_id: uuid,
  p_threshold: z.number().min(0).max(99999999999.999).nullable(),
  p_expected_version: z.number().int().nonnegative(),
});
