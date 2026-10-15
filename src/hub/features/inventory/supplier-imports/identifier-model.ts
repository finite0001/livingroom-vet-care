/** Supplier namespace identity stays separate from manufacturer/package barcodes. */
import { z } from "zod";

export const supplierSchema = z.enum(["mwi", "midwest"]);
export const supplierSkuSchema = z
  .string()
  .min(1)
  .max(200)
  .refine(
    (value) => value === value.trim() && Array.from(value).every((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    }),
    "Keep the original SKU text; review whitespace or control characters",
  );
export const supplierIdentitySchema = z
  .object({
    supplier: supplierSchema,
    namespace_id: z.string().uuid(),
    sku: supplierSkuSchema,
  })
  .strict();
export interface SupplierIdentity extends z.infer<typeof supplierIdentitySchema> {}

// A decoded UPC/EAN remains raw evidence; only validated GTIN values normalize.
export const gtinSchema = z
  .string()
  .regex(/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/)
  .refine((value) => {
    if (!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(value) || !/[1-9]/.test(value)) return false;
    let total = 0;
    for (let index = value.length - 2, weight = 3; index >= 0; index--, weight = 4 - weight)
      total += Number(value[index]) * weight;
    return (10 - total % 10) % 10 === Number(value[value.length - 1]);
  }, "GTIN check digit is invalid");

export function normalizedGtin(value: unknown): string {
  return gtinSchema.parse(value).padStart(14, "0");
}
