import { z } from "zod";
import { equalHistoryPayload, historyCursor } from "./history-state.ts";
const uuid = z.string().uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const positive = z.number().int().positive();
const timestamp = z.string().refine((v) => Number.isFinite(Date.parse(v)));
const dateStatus = z.enum(["date", "unknown", "uninterpreted"]);
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const parsed = new Date(`${v}T12:00:00Z`);
    return (
      Number(v.slice(0, 4)) > 0 &&
      Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === v
    );
  });
export const prescriptionObservationSchema = z.object({
  snapshot_id: uuid,
  payload_hash: hash,
  observed_head_version: positive,
  external_id: z.string().min(1),
  page: positive,
  original: z.record(z.unknown()),
});
export const prescriptionItemEvidenceSchema = z
  .object({
    source: prescriptionObservationSchema,
    reviewed: z.object({
      start_on: calendarDate.nullable(),
      start_date_status: dateStatus,
      note: z.string().nullable(),
    }),
    product: z
      .object({
        id: uuid,
        version: positive,
        name: z.string(),
        kind: z.literal("medication"),
        unit: z.string(),
      })
      .nullable(),
  })
  .superRefine((v, ctx) => {
    if (
      (v.reviewed.start_date_status === "date") !==
      (v.reviewed.start_on !== null)
    )
      ctx.addIssue({
        code: "custom",
        message: "Item date interpretation differs",
      });
  });
const reconciliation = z.object({
  status: z.enum(["matched", "unresolved"]),
  sourceListPresent: z.boolean(),
  scanComplete: z.boolean(),
  expectedIds: z.array(z.string()),
  observedIds: z.array(z.string()),
  missingIds: z.array(z.string()),
  unexpectedIds: z.array(z.string()),
  duplicateSourceIds: z.array(z.string()),
  duplicateObservedIds: z.array(z.string()),
  invalidObservedReferences: z.array(
    z.object({ index: z.number().int(), value: z.unknown() }),
  ),
  invalidSourceReferences: z.array(
    z.object({ index: z.number().int(), value: z.unknown() }),
  ),
});
export const importedPrescriptionSchema = z
  .object({
    id: uuid,
    pet_id: uuid,
    client_id: uuid,
    animal_link_id: uuid,
    source_origin: z.string().url(),
    source_site_uid: z.string(),
    prescription_external_id: z.string(),
    version: positive,
    version_hash: hash,
    reason: z.string(),
    replaces_id: uuid.nullable(),
    expected_predecessor_hash: hash.nullable(),
    approved_by: uuid,
    approved_at: timestamp,
    context: z.object({
      patient_id: uuid,
      client_id: uuid,
      animal_link_id: uuid,
      patient_version: positive,
      source: z.object({
        origin: z.string().url(),
        site_uid: z.string(),
        animal_id: z.string(),
      }),
      parent: prescriptionObservationSchema.omit({ page: true }),
      consult: z.object({
        status: z.enum(["resolved", "not_supplied"]),
        reference: z.unknown().optional(),
        snapshot_id: uuid.optional(),
        payload_hash: hash.optional(),
        observed_head_version: positive.optional(),
      }),
      item_run: z.object({ id: uuid, status: z.string(), next_page: positive }),
      items: z.array(prescriptionObservationSchema),
      reconciliation,
      selected_items: z.array(prescriptionItemEvidenceSchema).max(200),
      omitted_items: z.array(prescriptionObservationSchema),
      reviewed: z.object({
        prescribed_on: calendarDate.nullable(),
        prescription_date_status: dateStatus,
        status: z.enum(["active", "inactive", "unknown"]),
        outside_author: z.string().nullable(),
        reason: z.string(),
        completeness: z.enum(["complete", "partial"]),
        partial_reason: z.string().nullable(),
      }),
    }),
    items: z.array(prescriptionItemEvidenceSchema).max(200),
    current: z.object({
      is_latest: z.boolean(),
      identity_valid: z.boolean(),
      is_current: z.boolean(),
    }),
    correction_history: z
      .array(
        z.object({
          id: uuid,
          version: positive,
          version_hash: hash,
          replaces_id: uuid.nullable(),
          reason: z.string(),
          approved_by: uuid,
          approved_at: timestamp,
        }),
      )
      .min(1),
  })
  .superRefine((v, ctx) => {
    const c = v.context;
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    if (
      v.pet_id !== c.patient_id ||
      v.client_id !== c.client_id ||
      v.animal_link_id !== c.animal_link_id ||
      v.source_origin !== c.source.origin ||
      v.source_site_uid !== c.source.site_uid ||
      v.prescription_external_id !== c.parent.external_id ||
      String(c.parent.original.animal_id) !== c.source.animal_id
    )
      fail("Prescription patient/source identity differs");
    if (
      !equalHistoryPayload(v.items, c.selected_items) ||
      new Set(v.items.map((i) => i.source.snapshot_id)).size !==
        v.items.length ||
      v.items.some(
        (i) => !c.items.some((source) => equalHistoryPayload(source, i.source)),
      ) ||
      c.items.some(
        (i) =>
          String(i.original.prescription_id) !== v.prescription_external_id,
      )
    )
      fail("Prescription item evidence differs");
    if (
      c.omitted_items.some(
        (item) =>
          !c.items.some((source) => equalHistoryPayload(source, item)) ||
          v.items.some(
            (selected) => selected.source.snapshot_id === item.snapshot_id,
          ),
      ) ||
      c.items.some(
        (item) =>
          !v.items.some(
            (selected) => selected.source.snapshot_id === item.snapshot_id,
          ) &&
          !c.omitted_items.some((omitted) =>
            equalHistoryPayload(omitted, item),
          ),
      )
    )
      fail("Observed prescription items are not fully accounted for");
    if (
      (c.reviewed.prescription_date_status === "date") !==
        (c.reviewed.prescribed_on !== null) ||
      (v.replaces_id === null) !== (v.expected_predecessor_hash === null) ||
      c.reviewed.reason !== v.reason
    )
      fail("Prescription interpretation differs");
    if (
      c.reviewed.completeness === "complete" &&
      (c.reconciliation.status !== "matched" ||
        c.omitted_items.length > 0 ||
        c.reviewed.partial_reason !== null)
    )
      fail("Incomplete evidence cannot be displayed as complete");
    if (
      c.reviewed.completeness === "partial" &&
      (!c.reviewed.partial_reason ||
        c.reviewed.partial_reason.trim().length < 5)
    )
      fail("Partial history disclosure missing");
    if (
      c.consult.status === "resolved" &&
      (!c.consult.snapshot_id ||
        !c.consult.payload_hash ||
        !c.consult.observed_head_version)
    )
      fail("Resolved consultation evidence missing");
    if (
      !v.correction_history.some(
        (h) =>
          h.id === v.id &&
          h.version === v.version &&
          h.version_hash === v.version_hash,
      )
    )
      fail("Prescription correction history differs");
  });
export const prescriptionCursorSchema = historyCursor;
export type PrescriptionCursor = z.infer<typeof prescriptionCursorSchema>;
export type ImportedPrescription = z.infer<typeof importedPrescriptionSchema>;
export type PrescriptionItemEvidence = z.infer<
  typeof prescriptionItemEvidenceSchema
>;
export function parsePatientPrescriptionPage(value: unknown, petId: string) {
  const page = z
    .object({
      prescriptions: z.array(importedPrescriptionSchema).max(20),
      has_more: z.boolean(),
      next_cursor: prescriptionCursorSchema.nullable(),
    })
    .parse(value);
  if (
    page.has_more !== !!page.next_cursor ||
    page.prescriptions.some((v) => v.pet_id !== petId) ||
    new Set(page.prescriptions.map((v) => v.id)).size !==
      page.prescriptions.length
  )
    throw new Error("Prescription chart scope or pagination differs");
  return page;
}
