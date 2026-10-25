import { z } from "zod";
import { ExactJsonNumber } from "./exact-json.ts";
import { reviewInstantMicroseconds, reviewQuantityThousandths } from "./exact-values.ts";
import { movementFrozenSchema } from "./movement-structure.ts";
import { reviewDigestSchema, reviewUuidSchema as uuid } from "./request.ts";

/** A finite client spelling domain for canonical treatment quantities. SQL also
 * accepts other numeric input spellings; those refuse here rather than being
 * silently rewritten. Redundant decimal zeros and exponents remain exact.
 */
export function clinicalQuantityThousandths(value: string | ExactJsonNumber): bigint {
  return reviewQuantityThousandths(typeof value === "string" ? new ExactJsonNumber(value) : value);
}
const quantity = z.union([z.string(), z.instanceof(ExactJsonNumber)]).refine(value => {
  try { return clinicalQuantityThousandths(value) > 0n; } catch { return false; }
});
const instant = z.string().refine(value => {
  try { reviewInstantMicroseconds(value); return true; } catch { return false; }
});
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  try { reviewInstantMicroseconds(value + "T00:00:00Z"); return true; } catch { return false; }
});
const text = (minimum: number, maximum: number, trim = false) => z.string().refine(value => {
  const length = Array.from(trim ? value.replace(/^ +| +$/g, "") : value).length;
  return length >= minimum && length <= maximum;
});
const common = {
  lot_id: uuid, invoice_id: uuid, quantity, dose: text(1, 200, true), route: text(1, 100, true),
  site: text(0, 200).nullable().optional(), veterinarian: text(1, 200, true),
  veterinarian_license: text(0, 100).nullable().optional(), administered_at: instant,
  alert_review: z.object({ source_hash: reviewDigestSchema, acknowledged: z.literal(true) }).strict(),
};
export const treatmentRequestSchema = z.object({ ...common, pet_id: uuid,
  next_due_on: date.nullable().optional(), historical: z.literal(false).nullable().optional(),
  source: text(0, 500).nullable().optional(),
  // These fields are ignored by the nonhistorical canonical constructor. Keep
  // them losslessly; the retained result must instead match frozen stock data.
  product_name: z.unknown().optional(), manufacturer: z.unknown().optional(), lot_number: z.unknown().optional(),
  expires_on: z.unknown().optional(), kind: z.unknown().optional(),
}).strict();
export const treatmentArgumentsSchema = z.object({ request: treatmentRequestSchema }).strict();
export const anesthesiaArgumentsSchema = z.object({ record_id: uuid, pet_id: uuid,
  request: z.object(common).strict(),
}).strict();
const effect = movementFrozenSchema.shape.expected_effects.element.extend({
  quantity_delta: z.string().refine(value => {
    try { return clinicalQuantityThousandths(value) < 0n; } catch { return false; }
  }),
}).strict();
export const clinicalMovementFrozenSchema = movementFrozenSchema.extend({ expected_effects: z.array(effect).length(1) }).strict();
