import { z } from "zod";
import { captureSchema, type Capture } from "../lab-work/LabResultState.ts";
const id = z.string().uuid(),
  version = z.number().int().positive(),
  hash = z.string().regex(/^[a-f0-9]{64}$/),
  date = z.string().refine((v) => Number.isFinite(Date.parse(v)));
const base = { id, actor_id: id, created_at: date };
export const mappingSchema = z.object({
  id,
  pet_id: id,
  client_id: id,
  resource: z.literal("animal"),
  source_origin: z.string(),
  source_site_uid: z.string(),
  external_id: z.string(),
  approved_by: id,
  created_at: date,
  local_version: version,
});
export const receiptSchema = z.object({
  ...base,
  animal_link_id: id,
  pet_id: id,
  pet_version: version,
  source_origin: z.string(),
  source_site_uid: z.string(),
  source_animal_id: z.string(),
  document_id: id,
  document_version: version,
  mime_type: z.string(),
  file_size: z.number().int().positive(),
  export_reference: z.string(),
  received_at: date,
  previous_record_id: id.nullable(),
  review_reason: z.string(),
  receipt_hash: hash,
  entry_method: z.literal("staff_reviewed_manual_export_v1"),
});
export const recordSchema = z.object({
  ...base,
  receipt_id: id,
  animal_link_id: id,
  pet_id: id,
  pet_version: version,
  document_id: id,
  document_version: version,
  receipt_hash: hash,
  capture_hash: hash,
  export_reference: z.string(),
  previous_record_id: id.nullable(),
  version,
  kind: z.enum(["original", "replacement"]),
  review_reason: z.string(),
});
export const ackSchema = z.object({
  ...base,
  record_id: id,
  capture_hash: hash,
  document_version: version,
});
export interface Mapping extends Required<z.infer<typeof mappingSchema>> {}
export interface Receipt extends Required<z.infer<typeof receiptSchema>> {}
export interface ExternalRecord
  extends Required<z.infer<typeof recordSchema>> {}
export interface Acknowledgment extends Required<z.infer<typeof ackSchema>> {}
export interface Verification {
  receipt: Receipt;
  capture: Capture | null;
  record: ExternalRecord | null;
}
export interface HistoricalRecord extends ExternalRecord {
  provider: "ezyVet";
  entry_method: "staff_reviewed_manual_export_v1";
  source_origin: string;
  source_site_uid: string;
  source_animal_id: string;
  received_at: string;
  document_status: string;
  capture: Capture;
  acknowledgments: Acknowledgment[];
}
export interface HistoryPage {
  pet_id: string;
  records: HistoricalRecord[];
  has_more: boolean;
}
export interface ReceiptPage {
  pet_id: string;
  receipts: Verification[];
  has_more: boolean;
}
export interface PendingAction {
  kind: "verify" | "approve" | "ack";
  args: Record<string, string | number | boolean | null>;
}
export function exactTimestamp(value: string): bigint {
  const match =
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (
    !match ||
    !Number.isFinite(Date.parse(match[1] + match[3])) ||
    new Date(match[1] + "Z").toISOString().slice(0, 19) !== match[1]
  )
    throw new Error("Invalid exact timestamp");
  return (
    BigInt(Date.parse(match[1] + match[3])) * 1000n +
    BigInt((match[2] ?? "").padEnd(6, "0"))
  );
}
const instant = z.string().refine((v) => {
  try {
    exactTimestamp(v);
    return true;
  } catch {
    return false;
  }
});
const stageArgs = z
  .object({
    p_id: id,
    p_animal_link_id: id,
    p_expected_pet_version: version,
    p_document_id: id,
    p_document_version: version,
    p_export_reference: z.string().min(1).max(500),
    p_received_at: instant,
    p_previous_record_id: id.nullable(),
    p_review_reason: z.string().min(1).max(2000),
  })
  .strict();
const approvalArgs = z
  .object({
    p_id: id,
    p_receipt_id: id,
    p_expected_receipt_hash: hash,
    p_expected_capture_hash: hash,
    p_attest: z.literal(true),
  })
  .strict();
const ackArgs = z
  .object({
    p_id: id,
    p_record_id: id,
    p_pet_id: id,
    p_expected_capture_hash: hash,
    p_expected_document_version: version,
    p_attest: z.literal(true),
  })
  .strict();
export function pendingAction(value: unknown, pet: string): PendingAction {
  const p = z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("verify"), args: stageArgs }).strict(),
      z.object({ kind: z.literal("approve"), args: approvalArgs }).strict(),
      z.object({ kind: z.literal("ack"), args: ackArgs }).strict(),
    ])
    .parse(value);
  if (p.kind === "ack" && p.args.p_pet_id !== pet)
    throw new Error("Another patient");
  return p as PendingAction;
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
      record: recordSchema.nullable(),
    })
    .parse(value) as Verification;
  const r = v.receipt,
    c = v.capture,
    d = v.record;
  if (
    r.pet_id !== pet ||
    (actor && r.actor_id !== actor) ||
    (receiptId && r.id !== receiptId)
  )
    throw new Error("Receipt scope differs");
  if (
    c &&
    (c.receipt_id !== r.id ||
      c.actor_id !== r.actor_id ||
      c.receipt_hash !== r.receipt_hash ||
      c.document_version !== r.document_version ||
      c.mime_type !== r.mime_type ||
      c.file_size !== r.file_size)
  )
    throw new Error("Capture scope differs");
  if (
    d &&
    (d.receipt_id !== r.id ||
      d.actor_id !== r.actor_id ||
      d.pet_id !== r.pet_id ||
      d.pet_version !== r.pet_version ||
      d.animal_link_id !== r.animal_link_id ||
      d.document_id !== r.document_id ||
      d.document_version !== r.document_version ||
      d.receipt_hash !== r.receipt_hash ||
      d.capture_hash !== c?.capture_hash ||
      d.export_reference !== r.export_reference ||
      d.previous_record_id !== r.previous_record_id ||
      d.review_reason !== r.review_reason)
  )
    throw new Error("Approved record differs");
  return v;
}
export function receiptPage(
  value: unknown,
  pet: string,
  actor: string,
): ReceiptPage {
  const p = z
    .object({
      pet_id: id,
      receipts: z.array(z.unknown()),
      has_more: z.boolean(),
    })
    .parse(value);
  if (p.pet_id !== pet) throw new Error("Patient differs");
  return {
    pet_id: pet,
    has_more: p.has_more,
    receipts: p.receipts.map((v) => {
      const r = verification(v, pet, actor);
      if (!r) throw new Error("Missing receipt");
      return r;
    }),
  };
}
export function historyPage(value: unknown, pet: string): HistoryPage {
  const p = z
    .object({
      pet_id: id,
      has_more: z.boolean(),
      records: z.array(
        recordSchema.extend({
          provider: z.literal("ezyVet"),
          entry_method: z.literal("staff_reviewed_manual_export_v1"),
          source_origin: z.string(),
          source_site_uid: z.string(),
          source_animal_id: z.string(),
          received_at: date,
          document_status: z.string(),
          capture: captureSchema,
          acknowledgments: z.array(ackSchema),
        }),
      ),
    })
    .parse(value) as HistoryPage;
  if (p.pet_id !== pet) throw new Error("Patient differs");
  for (const r of p.records) {
    const c = r.capture;
    if (
      r.pet_id !== pet ||
      c.receipt_id !== r.receipt_id ||
      c.capture_hash !== r.capture_hash ||
      c.receipt_hash !== r.receipt_hash ||
      c.document_version !== r.document_version
    )
      throw new Error("Record capture differs");
    for (const a of r.acknowledgments)
      if (
        a.record_id !== r.id ||
        a.capture_hash !== r.capture_hash ||
        a.document_version !== r.document_version
      )
        throw new Error("Acknowledgment differs");
  }
  return p;
}
export function resumeIntent(
  r: Receipt,
  actor: string,
  pet: string,
): PendingAction {
  if (r.actor_id !== actor || r.pet_id !== pet)
    throw new Error("Original administrator required");
  return pendingAction(
    {
      kind: "verify",
      args: {
        p_id: r.id,
        p_animal_link_id: r.animal_link_id,
        p_expected_pet_version: r.pet_version,
        p_document_id: r.document_id,
        p_document_version: r.document_version,
        p_export_reference: r.export_reference,
        p_received_at: r.received_at,
        p_previous_record_id: r.previous_record_id,
        p_review_reason: r.review_reason,
      },
    },
    pet,
  );
}
export function matchesReceipt(r: Receipt, p: PendingAction): boolean {
  const a = p.args;
  return (
    p.kind === "verify" &&
    r.id === a.p_id &&
    r.animal_link_id === a.p_animal_link_id &&
    r.pet_version === a.p_expected_pet_version &&
    r.document_id === a.p_document_id &&
    r.document_version === a.p_document_version &&
    r.export_reference === a.p_export_reference &&
    r.previous_record_id === a.p_previous_record_id &&
    r.review_reason === a.p_review_reason &&
    exactTimestamp(r.received_at) === exactTimestamp(String(a.p_received_at))
  );
}
