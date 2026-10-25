import { z } from "zod";
import { ExactJsonNumber, protocolInteger } from "./exact-json.ts";
import { reviewInstantMicroseconds } from "./exact-values.ts";
import { reviewUuidSchema } from "./request.ts";

const integer = (minimum: number, maximum: number) => z.instanceof(ExactJsonNumber).refine(value => {
  try { protocolInteger(value, minimum, maximum); return true; } catch { return false; }
});
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  try { reviewInstantMicroseconds(value + "T00:00:00Z"); return true; } catch { return false; }
});
const instant = z.string().refine(value => {
  try { reviewInstantMicroseconds(value); return true; } catch { return false; }
});
const problem = z.object({
  id: reviewUuidSchema, version: integer(1, 2147483647),
  title: z.string().refine(value => {
    const length = Array.from(value.replace(/^ +| +$/g, "")).length;
    return length >= 1 && length <= 250;
  }),
  notes: z.string().refine(value => Array.from(value).length <= 10000),
  status: z.enum(["active", "resolved"]), importance: z.literal("high"),
  onset_date: date.nullable(), updated_at: instant,
}).strict();

/** Exact historical snapshot emitted by read_patient_treatment_alerts.
 * This validates the retained shape; it never reloads today's patient chart or
 * establishes that an alert was clinically assessed. Hashing is a separate step.
 */
export const clinicalAlertSnapshotSchema = z.object({
  schema_version: integer(1, 1), pet_id: reviewUuidSchema, patient_version: integer(1, 2147483647),
  important_problems: z.array(problem).refine(values => values.every((value, index) => index === 0 || values[index - 1].id < value.id)),
  legacy_allergies: z.object({
    text: z.string().nullable(),
    provenance: z.literal("Existing patient profile allergy text; source clinician, original date and verification status are not established"),
  }).strict(),
}).strict();
