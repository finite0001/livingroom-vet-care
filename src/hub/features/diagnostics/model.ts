import { z } from "zod";
import { calendarDateSchema } from "../care-plans/calendar.ts";
const uuid = z.string().uuid();
const version = z.number().int().min(1).max(999999999);
const exactLabel = z
  .string()
  .min(1)
  .max(160)
  .refine(
    (v) => v.trim() === v && v.trim().length > 0,
    "Use exact nonempty text without surrounding spaces",
  );
const finite = z
  .number()
  .finite()
  .min(-1e100)
  .max(1e100)
  .refine(
    (v) => v === 0 || Math.abs(v) >= 1e-100,
    "Nonzero finding is below supported numeric precision; retain it as documentary text",
  );
export const observationSchema = z
  .object({
    id: uuid,
    analyte_key: exactLabel,
    label: exactLabel,
    kind: z.enum(["numeric", "qualitative"]),
    value_number: finite.nullable(),
    value_text: z.string().min(1).max(1000).nullable(),
    unit: z.string().min(1).max(40).nullable(),
    reference_low: finite.nullable(),
    reference_high: finite.nullable(),
    reference_text: z.string().max(1000),
    source_flag: z.string().max(1000),
  })
  .strict()
  .superRefine((v, c) => {
    if (
      v.kind === "numeric" &&
      (v.value_number === null ||
        v.value_text !== null ||
        !v.unit?.trim() ||
        v.unit.trim() !== v.unit)
    )
      c.addIssue({
        code: "custom",
        message: "Numeric findings require a number and exact original unit",
      });
    if (
      v.kind === "qualitative" &&
      (v.value_number !== null ||
        !v.value_text?.trim() ||
        v.unit !== null ||
        v.reference_low !== null ||
        v.reference_high !== null)
    )
      c.addIssue({
        code: "custom",
        message: "Qualitative findings require text without numeric fields",
      });
    if (
      v.reference_low !== null &&
      v.reference_high !== null &&
      v.reference_low > v.reference_high
    )
      c.addIssue({ code: "custom", message: "Reference bounds are reversed" });
  });
export interface Observation extends z.infer<typeof observationSchema> {}
export const valuesSchema = z
  .object({
    panel_name: exactLabel,
    category: z.enum(["laboratory", "other"]),
    collected_on: calendarDateSchema,
    reported_on: calendarDateSchema,
    specimen: exactLabel,
    method: exactLabel,
    source: exactLabel,
    interpretation: z.string().max(4000),
    observations: z.array(observationSchema).min(1).max(100),
    lab_order_id: uuid.nullable(),
    lab_order_version: version.nullable(),
    encounter_id: uuid.nullable(),
    encounter_version: version.nullable(),
    document_id: uuid.nullable(),
    document_version: version.nullable(),
  })
  .strict()
  .superRefine((v, c) => {
    if (v.reported_on < v.collected_on)
      c.addIssue({
        code: "custom",
        path: ["reported_on"],
        message: "Report date must follow collection date",
      });
    for (const k of ["lab_order", "encounter", "document"] as const)
      if ((v[`${k}_id`] === null) !== (v[`${k}_version`] === null))
        c.addIssue({
          code: "custom",
          message: "Source identity and exact version are required together",
        });
    if (
      new Set(v.observations.map((o) => o.id)).size !== v.observations.length ||
      new Set(v.observations.map((o) => o.analyte_key)).size !==
        v.observations.length
    )
      c.addIssue({
        code: "custom",
        message:
          "Finding IDs and analyte identities must be unique within this panel",
      });
    if (new TextEncoder().encode(JSON.stringify(v)).length > 120000)
      c.addIssue({
        code: "custom",
        message: "Panel exceeds the reviewed byte capacity",
      });
  });
export interface DiagnosticValues extends z.infer<typeof valuesSchema> {}
const instant = z.string().datetime({ offset: true });
export const panelSchema = z.object({
  id: uuid,
  pet_id: uuid,
  version,
  draft: valuesSchema.nullable(),
  current_finalized_id: uuid.nullable(),
  current_finalized_number: z.number().int().nonnegative(),
  created_by: uuid,
  updated_by: uuid,
  created_at: instant,
  updated_at: instant,
});
const sourcesSchema = z.object({
  lab_order: z.object({ id: uuid, version, test_name: z.string() }).optional(),
  encounter: z.object({ id: uuid, version, visit_at: instant }).optional(),
  document: z
    .object({
      id: uuid,
      version,
      file_name: z.string(),
      file_size: z.number().int().positive(),
      mime_type: z.string(),
    })
    .optional(),
});
export const finalizedSchema = z.object({
  id: uuid,
  panel_id: uuid,
  pet_id: uuid,
  number: version,
  predecessor_id: uuid.nullable(),
  snapshot: valuesSchema,
  source_context: sourcesSchema,
  source_hash: z.string().regex(/^[a-f0-9]{64}$/),
  correction_reason: z.string(),
  review_note: z.string(),
  entered_by: uuid,
  reviewed_by: uuid,
  reviewed_at: instant,
  reviewer_name: z.string(),
  entered_by_name: z.string(),
});
export interface FinalizedPanel extends z.infer<typeof finalizedSchema> {}
export const detailSchema = z
  .object({
    panel: panelSchema,
    current: finalizedSchema
      .extend({ original_current_available: z.boolean().nullable() })
      .nullable(),
    pdf_status: z.literal("not_available"),
    export_eligible: z.literal(false),
  })
  .superRefine((v, c) => {
    if (
      v.current &&
      (v.current.panel_id !== v.panel.id ||
        v.current.pet_id !== v.panel.pet_id ||
        v.current.id !== v.panel.current_finalized_id ||
        v.current.number !== v.panel.current_finalized_number)
    )
      c.addIssue({
        code: "custom",
        message: "Finalized diagnostic identity differs from its panel",
      });
  });
export interface DiagnosticDetail extends z.infer<typeof detailSchema> {}
export const cursorSchema = z.object({ id: uuid, updated_at: instant });
export const pageSchema = z.object({
  items: z.array(detailSchema).max(50),
  next: cursorSchema.nullable(),
});
export const historySchema = z.object({
  items: z.array(finalizedSchema).max(50),
  next: version.nullable(),
});
export const trendsSchema = z.object({
  census_hash: z.string().regex(/^[a-f0-9]{64}$/),
  items: z.array(finalizedSchema).max(100),
  next: uuid.nullable(),
});
export const actionSchema = z
  .object({
    id: uuid,
    pet_id: uuid,
    expected_version: version.nullable(),
    kind: z.enum(["draft", "finalize"]),
    values: valuesSchema,
    review_note: z.string().max(2000),
    correction_reason: z.string().max(2000),
  })
  .strict()
  .superRefine((v, c) => {
    if (v.kind === "draft" && (v.review_note || v.correction_reason))
      c.addIssue({
        code: "custom",
        message: "Draft save cannot claim clinical review",
      });
    if (
      v.kind === "finalize" &&
      (!v.review_note.trim() ||
        v.review_note.trim() !== v.review_note ||
        v.correction_reason.trim() !== v.correction_reason)
    )
      c.addIssue({
        code: "custom",
        message: "Record the exact clinical review and correction reason",
      });
  });
export interface DiagnosticAction extends z.infer<typeof actionSchema> {}
export function emptyObservation(): Observation {
  return {
    id: crypto.randomUUID(),
    analyte_key: "",
    label: "",
    kind: "numeric",
    value_number: null,
    value_text: null,
    unit: null,
    reference_low: null,
    reference_high: null,
    reference_text: "",
    source_flag: "",
  };
}
export function emptyValues(): DiagnosticValues {
  return {
    panel_name: "",
    category: "laboratory",
    collected_on: "",
    reported_on: "",
    specimen: "",
    method: "",
    source: "",
    interpretation: "",
    observations: [emptyObservation()],
    lab_order_id: null,
    lab_order_version: null,
    encounter_id: null,
    encounter_version: null,
    document_id: null,
    document_version: null,
  };
}
export function numericInput(text: string): number | null {
  if (!text.trim()) return null;
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text.trim()))
    throw new Error("Enter a complete finite number");
  const number = Number(text);
  if (number === 0 && /[1-9]/.test(text.trim().split(/[eE]/)[0]))
    throw new Error(
      "Nonzero finding would become zero; retain it as documentary text",
    );
  return finite.parse(number);
}
