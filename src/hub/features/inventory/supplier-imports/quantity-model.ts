/** Reviewed package conversion uses the existing numeric(14,3) stock boundary. */
import { z } from "zod";

const quantityPattern = /^(?:0|[1-9]\d{0,10})(?:\.\d{1,3})?$/;
export const packageQuantitySchema = z
  .string()
  .max(15)
  .regex(quantityPattern, "Enter an exact quantity with at most three decimals")
  .refine((value) => /[1-9]/.test(value), "Quantity must be positive");
const integerPattern = /^[1-9]\d{0,12}$/;
const conversionIntegerSchema = z
  .string()
  .max(13)
  .regex(integerPattern)
  .refine(
    (value) => integerPattern.test(value) && BigInt(value) <= 1000000000000n,
    "Conversion terms must be positive integers no greater than 1000000000000",
  );
export const packageConversionSchema = z
  .object({
    stock_units_numerator: conversionIntegerSchema,
    purchase_units_denominator: conversionIntegerSchema,
  })
  .strict();
export interface PackageConversion extends z.infer<typeof packageConversionSchema> {}

/** No float coercion, fractional-stock rounding or stock posting occurs here. */
export function convertedStockQuantity(
  purchaseQuantity: unknown,
  conversion: unknown,
): string {
  const quantity = packageQuantitySchema.parse(purchaseQuantity);
  const ratio = packageConversionSchema.parse(conversion);
  const [whole, fraction = ""] = quantity.split(".");
  const purchaseMilli = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0"));
  const numerator = purchaseMilli * BigInt(ratio.stock_units_numerator);
  const denominator = BigInt(ratio.purchase_units_denominator);
  if (numerator % denominator !== 0n)
    throw new Error("Conversion cannot be represented exactly in stock units to three decimals");
  const stockMilli = numerator / denominator;
  if (stockMilli <= 0n || stockMilli > 99999999999999n)
    throw new Error("Converted quantity exceeds the stock ledger's supported range");
  return `${stockMilli / 1000n}.${(stockMilli % 1000n).toString().padStart(3, "0")}`;
}
