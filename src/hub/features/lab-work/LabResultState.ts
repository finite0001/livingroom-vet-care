import { z } from "zod";
const id = z.string().uuid(),
  hash = z.string().regex(/^[a-f0-9]{64}$/),
  version = z.number().int().positive();
const text = z.string().trim().min(1).max(500),
  reason = z.string().trim().min(1).max(2000);
const date = z
  .string()
  .refine((v) => Number.isFinite(Date.parse(v)), "Invalid date");
const base = { id, actor_id: id, created_at: date };
export const sourceSchema = z.object({
  ...base,
  provider_label: z.string(),
  account_reference: z.string(),
  environment_label: z.string(),
  review_note: z.string(),
  manual_import_enabled: z.literal(true),
  transport_enabled: z.literal(false),
});
export const captureSchema = z.object({
  receipt_id: id,
  actor_id: id,
  receipt_hash: hash,
  document_version: version,
  content_sha256: hash,
  file_size: z.number().int().nonnegative(),
  mime_type: z.string(),
  capture_hash: hash,
  captured_at: date,
});
export const receiptSchema = z.object({
  ...base,
  source_account_id: id,
  document_id: id,
  document_version: version,
  pet_id: id,
  source_patient_reference: text,
  source_order_reference: text,
  source_report_reference: text,
  received_at: date,
  mime_type: z.string(),
  file_size: z.number().int().nonnegative(),
  receipt_hash: hash,
  entry_method: z.literal("staff_entered_v1"),
});
export const mappingSchema = z.object({
  ...base,
  order_id: id,
  pet_id: id,
  order_version: version,
  source_account_id: id,
  source_patient_reference: text,
  source_order_reference: text,
  previous_review_id: id.nullable(),
  revision: version,
  review_reason: z.string(),
});
export const ackSchema = z.object({
  ...base,
  report_id: id,
  capture_hash: hash,
  document_version: version,
});
export const reportSchema = z.object({
  ...base,
  order_id: id,
  pet_id: id,
  order_version: version,
  source_review_id: id,
  receipt_id: id,
  receipt_hash: hash,
  capture_hash: hash,
  document_id: id,
  document_version: version,
  previous_report_id: id.nullable(),
  version,
  kind: z.enum(["original", "corrected"]),
  review_reason: z.string(),
});
export interface Source extends Required<z.infer<typeof sourceSchema>> {}
export interface Capture extends Required<z.infer<typeof captureSchema>> {}
export interface Receipt extends Required<z.infer<typeof receiptSchema>> {}
export interface Mapping extends Required<z.infer<typeof mappingSchema>> {}
export interface Report extends Required<z.infer<typeof reportSchema>> {}
export interface Acknowledgment extends Required<z.infer<typeof ackSchema>> {}
export interface StagedReceipt extends Receipt {
  capture: Capture | null;
}
export interface HistoricalReport extends Report {
  capture: Capture;
  document_status: string;
  acknowledgments: Acknowledgment[];
}
export interface LabResultHistory {
  pet_id: string;
  order_id: string;
  sources: Source[];
  staged_receipts: StagedReceipt[];
  source_reviews: Mapping[];
  reports: HistoricalReport[];
}
export interface Verification {
  receipt: Receipt;
  capture: Capture | null;
  report: Report | null;
}
export function verification(
  value: unknown,
  pet: string,
  actor?: string,
  receiptId?: string,
): Verification | null {
  if (value === null) return null;
  const v = z
    .object({
      receipt: receiptSchema,
      capture: captureSchema.nullable(),
      report: reportSchema.nullable(),
    })
    .parse(value);
  if (
    v.receipt.pet_id !== pet ||
    (actor && v.receipt.actor_id !== actor) ||
    (receiptId && v.receipt.id !== receiptId)
  )
    throw new Error("Report identity differs");
  if (
    v.capture &&
    (v.capture.receipt_id !== v.receipt.id ||
      v.capture.receipt_hash !== v.receipt.receipt_hash ||
      v.capture.actor_id !== v.receipt.actor_id ||
      v.capture.document_version !== v.receipt.document_version ||
      v.capture.mime_type !== v.receipt.mime_type ||
      v.capture.file_size !== v.receipt.file_size)
  )
    throw new Error("Verified bytes differ from receipt");
  if (
    v.report &&
    (v.report.receipt_id !== v.receipt.id ||
      v.report.pet_id !== pet ||
      v.report.document_id !== v.receipt.document_id ||
      v.report.document_version !== v.receipt.document_version ||
      v.report.receipt_hash !== v.receipt.receipt_hash ||
      v.report.capture_hash !== v.capture?.capture_hash)
  )
    throw new Error("Linked report differs");
  return v as Verification;
}
export function resultHistory(
  value: unknown,
  pet: string,
  order: string,
): LabResultHistory {
  const v = z
    .object({
      pet_id: id,
      order_id: id,
      sources: z.array(sourceSchema),
      staged_receipts: z.array(
        receiptSchema.extend({ capture: captureSchema.nullable() }),
      ),
      source_reviews: z.array(mappingSchema),
      reports: z.array(
        reportSchema.extend({
          capture: captureSchema,
          document_status: z.string(),
          acknowledgments: z.array(ackSchema),
        }),
      ),
    })
    .parse(value);
  if (v.pet_id !== pet || v.order_id !== order)
    throw new Error("Patient or order differs");
  for (const r of v.staged_receipts)
    verification({ receipt: r, capture: r.capture, report: null }, pet);
  for (const m of v.source_reviews)
    if (m.pet_id !== pet || m.order_id !== order)
      throw new Error("Source mapping differs");
  for (const r of v.reports) {
    if (
      r.pet_id !== pet ||
      r.order_id !== order ||
      r.capture.receipt_id !== r.receipt_id ||
      r.capture.capture_hash !== r.capture_hash ||
      r.capture.receipt_hash !== r.receipt_hash ||
      r.capture.document_version !== r.document_version
    )
      throw new Error("Report history differs");
    for (const a of r.acknowledgments)
      if (
        a.report_id !== r.id ||
        a.capture_hash !== r.capture_hash ||
        a.document_version !== r.document_version
      )
        throw new Error("Acknowledgment differs");
  }
  return v as LabResultHistory;
}
export const stageArgsSchema = z
  .object({
    p_id: id,
    p_source_account_id: id,
    p_document_id: id,
    p_document_version: version,
    p_source_patient_reference: text,
    p_source_order_reference: text,
    p_source_report_reference: text,
    p_received_at: z
      .string()
      .refine(
        (v) =>
          /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) &&
          Number.isFinite(Date.parse(v)) &&
          new Date(v).toISOString() === v,
      ),
  })
  .strict();
const mappingArgs = z
  .object({
    p_id: id,
    p_order_id: id,
    p_pet_id: id,
    p_expected_order_version: version,
    p_source_account_id: id,
    p_source_patient_reference: text,
    p_source_order_reference: text,
    p_previous_review_id: id.nullable(),
    p_review_reason: reason,
    p_attest: z.literal(true),
  })
  .strict();
const linkArgs = z
  .object({
    p_id: id,
    p_receipt_id: id,
    p_expected_receipt_hash: hash,
    p_expected_capture_hash: hash,
    p_order_id: id,
    p_pet_id: id,
    p_expected_order_version: version,
    p_source_review_id: id,
    p_previous_report_id: id.nullable(),
    p_kind: z.enum(["original", "corrected"]),
    p_review_reason: reason,
    p_attest: z.literal(true),
  })
  .strict();
const ackArgs = z
  .object({
    p_id: id,
    p_report_id: id,
    p_pet_id: id,
    p_expected_capture_hash: hash,
    p_expected_document_version: version,
    p_attest: z.literal(true),
  })
  .strict();
const sourceArgs = z
  .object({
    p_id: id,
    p_provider_label: z.string().trim().min(1).max(200),
    p_account_reference: z.string().trim().min(1).max(200),
    p_environment_label: z.string().trim().min(1).max(100),
    p_review_note: reason,
  })
  .strict();
export interface PendingLabAction {
  kind: "verify" | "mapping" | "link" | "ack" | "source";
  args: Record<string, string | number | boolean | null>;
}
export function pendingLabAction(
  value: unknown,
  pet: string,
  order: string,
): PendingLabAction {
  const p = z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("verify"), args: stageArgsSchema }).strict(),
      z.object({ kind: z.literal("mapping"), args: mappingArgs }).strict(),
      z.object({ kind: z.literal("link"), args: linkArgs }).strict(),
      z.object({ kind: z.literal("ack"), args: ackArgs }).strict(),
      z.object({ kind: z.literal("source"), args: sourceArgs }).strict(),
    ])
    .parse(value);
  if (
    ("p_pet_id" in p.args && p.args.p_pet_id !== pet) ||
    ("p_order_id" in p.args && p.args.p_order_id !== order)
  )
    throw new Error("Pending action belongs to another patient/order");
  return p as PendingLabAction;
}
export function receiptMatchesIntent(r: Receipt, p: PendingLabAction): boolean {
  const a = p.args;
  // PostgreSQL may add zero microsecond padding; never silently round nonzero submilliseconds.
  const timestamp = r.received_at.replace(/(\.\d{3})0+(?=Z|[+-])/, "$1");
  return (
    p.kind === "verify" &&
    r.id === a.p_id &&
    r.source_account_id === a.p_source_account_id &&
    r.document_id === a.p_document_id &&
    r.document_version === a.p_document_version &&
    r.source_patient_reference === a.p_source_patient_reference &&
    r.source_order_reference === a.p_source_order_reference &&
    r.source_report_reference === a.p_source_report_reference &&
    !/\.\d{4,}(?:Z|[+-])/.test(timestamp) &&
    Date.parse(timestamp) === Date.parse(String(a.p_received_at))
  );
}
export function matchingSource(r: Receipt, m: Mapping | undefined): boolean {
  return Boolean(
    m &&
      r.pet_id === m.pet_id &&
      r.source_account_id === m.source_account_id &&
      r.source_patient_reference === m.source_patient_reference &&
      r.source_order_reference === m.source_order_reference,
  );
}
/** Restore only the exact original stage request; never manufacture a new receipt or round its timestamp. */
export function resumeReceiptIntent(
  r: Receipt,
  actor: string,
  pet: string,
  order: string,
): PendingLabAction {
  if (r.actor_id !== actor || r.pet_id !== pet)
    throw new Error("Original receipt actor required");
  const p = pendingLabAction(
    {
      kind: "verify",
      args: {
        p_id: r.id,
        p_source_account_id: r.source_account_id,
        p_document_id: r.document_id,
        p_document_version: r.document_version,
        p_source_patient_reference: r.source_patient_reference,
        p_source_order_reference: r.source_order_reference,
        p_source_report_reference: r.source_report_reference,
        p_received_at: new Date(r.received_at).toISOString(),
      },
    },
    pet,
    order,
  );
  if (!receiptMatchesIntent(r, p))
    throw new Error("Original receipt precision cannot be recovered unchanged");
  return p;
}
