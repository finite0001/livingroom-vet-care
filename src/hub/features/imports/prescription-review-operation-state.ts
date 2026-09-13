import { z } from "zod";
import { equalHistoryPayload } from "./history-state.ts";
import {
  importedPrescriptionSchema,
  prescriptionItemEvidenceSchema,
} from "./prescription-review-state.ts";
const uuid = z.string().uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const positive = z.number().int().positive().max(2147483647);
const timestamp = z
  .string()
  .refine((value) => Number.isFinite(Date.parse(value)));
const exactText = (min: number, max: number) =>
  z
    .string()
    .min(min)
    .max(max)
    .refine((v) => v === v.trim());
const contextSchema = importedPrescriptionSchema.innerType().shape.context;
const itemPayload = prescriptionItemEvidenceSchema
  .innerType()
  .shape.reviewed.extend({
    snapshot_id: uuid,
    product_id: uuid.nullable(),
    product_version: positive.nullable(),
    note: exactText(1, 2000).nullable(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      (v.start_date_status === "date") !== (v.start_on !== null) ||
      (v.product_id === null) !== (v.product_version === null)
    )
      ctx.addIssue({
        code: "custom",
        message: "Explicit item date and complete catalog match required",
      });
  });
export const prescriptionReviewPayloadSchema = z
  .object({
    item_run_id: uuid,
    patient_version: positive,
    interpretation: contextSchema.shape.reviewed
      .extend({
        outside_author: exactText(1, 500).nullable(),
        reason: exactText(5, 2000),
        partial_reason: exactText(5, 2000).nullable(),
        replaces_id: uuid.nullable(),
        expected_predecessor_hash: hash.nullable(),
        items: z.array(itemPayload).max(200),
      })
      .strict(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const p = v.interpretation;
    if (
      (p.prescription_date_status === "date") !== (p.prescribed_on !== null) ||
      (p.completeness === "partial") !== (p.partial_reason !== null) ||
      (p.replaces_id === null) !== (p.expected_predecessor_hash === null) ||
      new Set(p.items.map((i) => i.snapshot_id)).size !== p.items.length
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Explicit dates, completeness, unique items and correction identity required",
      });
  });
export type PrescriptionReviewPayload = z.infer<
  typeof prescriptionReviewPayloadSchema
>;
const envelopeSchema = z.object({
  request: z.object({
    id: uuid,
    actor_id: uuid,
    pet_id: uuid,
    status: z.enum(["prepared", "approved", "abandoned"]),
    payload: prescriptionReviewPayloadSchema.nullable(),
    request_hash: hash.nullable(),
    review_context: contextSchema.nullable(),
    approved_record_id: uuid.nullable(),
    created_at: timestamp,
    resolved_at: timestamp.nullable(),
  }),
  receipt: importedPrescriptionSchema.nullable(),
  clinical_approval_available: z.boolean(),
});
export type PrescriptionReviewOperation = z.infer<typeof envelopeSchema>;
export function parsePrescriptionReview(
  value: unknown,
  actor: string,
  pet: string,
  id?: string,
  expected?: PrescriptionReviewPayload | null,
) {
  if (value === null) return null;
  const e = envelopeSchema.parse(value),
    r = e.request;
  const fail = () => {
    throw new Error(
      "Recovered prescription evidence differs. Keep the original reference.",
    );
  };
  if (
    r.actor_id !== actor ||
    r.pet_id !== pet ||
    (id && r.id !== id) ||
    (expected && r.payload && !equalHistoryPayload(expected, r.payload)) ||
    (r.status !== "abandoned" &&
      (!r.payload || !r.request_hash || !r.review_context)) ||
    (r.status === "prepared") !== (r.resolved_at === null) ||
    (r.status === "approved"
      ? !e.receipt ||
        e.receipt.id !== r.approved_record_id ||
        e.receipt.pet_id !== pet
      : e.receipt !== null || r.approved_record_id !== null)
  )
    fail();
  if (
    (r.payload === null) !== (r.review_context === null) ||
    (r.payload === null) !== (r.request_hash === null)
  )
    fail();
  if (r.payload && r.review_context) {
    const p = r.payload,
      c = r.review_context;
    const {
      items,
      replaces_id: _predecessor,
      expected_predecessor_hash: _predecessorHash,
      ...reviewed
    } = p.interpretation;
    if (
      c.patient_id !== pet ||
      c.item_run.id !== p.item_run_id ||
      c.patient_version !== p.patient_version ||
      String(c.parent.original.id) !== c.parent.external_id ||
      String(c.parent.original.animal_id) !== c.source.animal_id ||
      !equalHistoryPayload(reviewed, c.reviewed) ||
      items.length !== c.selected_items.length ||
      c.items.some(
        (i) => String(i.original.prescription_id) !== c.parent.external_id,
      )
    )
      fail();
    for (const [index, item] of items.entries()) {
      const selected = c.selected_items[index];
      const {
        snapshot_id: _snapshot,
        product_id: _product,
        product_version: _version,
        ...itemReview
      } = item;
      if (
        !selected ||
        selected.source.snapshot_id !== item.snapshot_id ||
        !equalHistoryPayload(itemReview, selected.reviewed) ||
        (selected.product?.id ?? null) !== item.product_id ||
        (selected.product?.version ?? null) !== item.product_version ||
        !c.items.some((source) => equalHistoryPayload(source, selected.source))
      )
        fail();
    }
    if (
      c.omitted_items.some(
        (item) =>
          !c.items.some((source) => equalHistoryPayload(source, item)) ||
          items.some((selected) => selected.snapshot_id === item.snapshot_id),
      ) ||
      c.items.some(
        (item) =>
          !items.some(
            (selected) => selected.snapshot_id === item.snapshot_id,
          ) &&
          !c.omitted_items.some((omitted) =>
            equalHistoryPayload(omitted, item),
          ),
      )
    )
      fail();
    if (
      p.interpretation.completeness === "complete" &&
      (c.reconciliation.status !== "matched" || c.omitted_items.length > 0)
    )
      fail();
    if (
      c.consult.status === "resolved" &&
      (!c.consult.snapshot_id ||
        !c.consult.payload_hash ||
        !c.consult.observed_head_version)
    )
      fail();
    const consultReference = c.parent.original.consult_id;
    if (
      c.consult.status === "not_supplied"
        ? consultReference !== null &&
          consultReference !== undefined &&
          consultReference !== ""
        : String(consultReference) !== String(c.consult.reference)
    )
      fail();
    if (e.receipt) {
      const {
        item_run: _receiptRun,
        patient_version: _receiptPatientVersion,
        ...receiptContext
      } = e.receipt.context;
      const {
        item_run: _run,
        patient_version: _patientVersion,
        ...preparedContext
      } = c;
      const expectedPredecessor = p.interpretation.replaces_id;
      const expectedPredecessorHash =
        p.interpretation.expected_predecessor_hash;
      const matchesPredecessor =
        expectedPredecessor === e.receipt.replaces_id &&
        expectedPredecessorHash === e.receipt.expected_predecessor_hash;
      const matchesExisting =
        expectedPredecessor === e.receipt.id &&
        expectedPredecessorHash === e.receipt.version_hash;
      if (
        e.receipt.id === r.id
          ? !matchesPredecessor
          : expectedPredecessor !== null &&
            !matchesPredecessor &&
            !matchesExisting
      )
        fail();
      // SQL deduplication excludes these two eligibility fields, not evidence.
      if (!equalHistoryPayload(receiptContext, preparedContext)) fail();
    }
  }
  return e;
}
export const prescriptionReviewIntentSchema = z
  .object({
    id: uuid,
    actor: uuid,
    pet: uuid,
    payload: prescriptionReviewPayloadSchema.nullable(),
  })
  .strict();
export type PrescriptionReviewIntent = z.infer<
  typeof prescriptionReviewIntentSchema
>;
export function prescriptionReviewKey(actor: string, pet: string) {
  return `ezyvet-prescription-review:${uuid.parse(actor)}:${uuid.parse(pet)}`;
}
export function readPrescriptionReviewIntent(
  key: string,
): PrescriptionReviewIntent | null {
  const raw = sessionStorage.getItem(key);
  if (!raw) return null;
  const value = prescriptionReviewIntentSchema.parse(JSON.parse(raw));
  if (prescriptionReviewKey(value.actor, value.pet) !== key)
    throw new Error("Retained prescription review identity differs");
  return value;
}
export function savePrescriptionReviewIntent(value: PrescriptionReviewIntent) {
  const valid = prescriptionReviewIntentSchema.parse(value);
  try {
    sessionStorage.setItem(
      prescriptionReviewKey(valid.actor, valid.pet),
      JSON.stringify(valid),
    );
  } catch {
    throw new Error(
      "Browser recovery storage unavailable. No review request was submitted.",
    );
  }
}
