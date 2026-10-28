import { z } from "zod";
import { validUnicode } from "../record-review/exact-json.ts";
import { witnessReceiptSchema } from "../witness/schema.ts";

export const registerId = z.string().regex(/^(?!00000000-0000-0000-0000-000000000000$)[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
// The exact wire decoder validates Unicode before these response schemas.
const text = z.string();
const instant = text.regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .refine(value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);
const serverTime = text.regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/).refine(value => value.slice(0, 4) !== "0000" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value.slice(0, 23) + "Z");
export const registerHash = text.regex(/^[0-9a-f]{64}$/);
const label = text.min(1).max(200).refine(value => validUnicode(value) && value.trim().length > 0 && !Array.from(value).some(char => { const code = char.charCodeAt(0); return code < 32 || code >= 127 && code <= 159; }));
const scope = { schema_version: z.literal(1), actor_id: registerId, operation_id: registerId, product_id: registerId, site_id: registerId };
export const registerReportRequest = z.object({ ...scope, from_at: instant, to_at: instant }).strict()
  .refine(value => Date.parse(value.from_at) < Date.parse(value.to_at) && Date.parse(value.to_at) - Date.parse(value.from_at) <= 31 * 86400000);
export const registerFormMetadata = z.object({ ...scope, event_id: registerId.nullable(), kind: z.enum(["supplier_receipt", "registration", "order_form", "other"]),
  title: label, filename: label.refine(value => !/[/\\]/.test(value)), obtained_at: instant, mime: z.enum(["application/pdf", "image/png", "image/jpeg"]) }).strict();
export const registerFormRequest = registerFormMetadata.extend({ base64: text.min(4).max(2796204).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/) }).strict();
export const registerPointer = z.object({ ...scope, kind: z.enum(["report", "form"]) }).strict();
export interface RegisterPointer extends Required<z.infer<typeof registerPointer>> {}
export function parseRegisterPointer(input: unknown): RegisterPointer { return registerPointer.parse(input) as RegisterPointer; }
export const registerListRequest = z.object({ schema_version: z.literal(1), actor_id: registerId, product_id: registerId, site_id: registerId,
  after_operation_id: registerId.nullable(), page_size: z.number().int().min(1).max(50) }).strict();
export const registerListReply = z.object({ schema_version: z.literal(1), actor_id: registerId, product_id: registerId, site_id: registerId,
  items: z.array(z.object({ operation_id: registerId, recorded_at: serverTime, captured_at: serverTime, from_at: instant, to_at: instant }).strict()).max(50),
  has_more: z.boolean(), next_operation_id: registerId.nullable() }).strict();
export interface RegisterListReply extends z.infer<typeof registerListReply> {}
export interface RegisterReportRequest extends Required<z.infer<typeof registerReportRequest>> {}
export interface RegisterFormRequest extends Required<z.infer<typeof registerFormRequest>> {}

const saved = { schema_version: z.literal(1), state: z.literal("saved"), operation_id: registerId, actor_id: registerId,
  original_session_id: registerId, recorded_at: serverTime, request_hash: registerHash };
export const registerReportSaved = z.object({ ...saved, kind: z.literal("report"), request_metadata: registerReportRequest,
  data: z.object({ captured_at: serverTime, dataset_text: text.max(4194304), dataset_hash: registerHash, dataset_utf8_bytes: z.number().int().min(1).max(4194304),
    csv_text: text.max(4194304), csv_hash: registerHash, csv_utf8_bytes: z.number().int().min(1).max(4194304) }).strict() }).strict();
export const registerFormSaved = z.object({ ...saved, kind: z.literal("form"), request_metadata: registerFormMetadata,
  data: z.object({ form_id: registerId, document_text: text.max(32768), document_hash: registerHash, sha256: registerHash,
    byte_length: z.number().int().min(1).max(2097152), mime: registerFormMetadata.shape.mime, filename: label }).strict() }).strict();
const terminal = z.object({ schema_version: z.literal(1), state: z.enum(["not_found", "abandoned"]), kind: z.enum(["report", "form"]), operation_id: registerId }).strict();
export const registerReply = z.union([registerReportSaved, registerFormSaved, terminal]);
export type RegisterReply = z.infer<typeof registerReply>;
export interface RegisterReportSaved extends z.infer<typeof registerReportSaved> {}
export const registerDownload = z.object({ schema_version: z.literal(1), form_id: registerId, filename: label, mime: registerFormMetadata.shape.mime,
  byte_length: z.number().int().min(1).max(2097152), sha256: registerHash, base64: registerFormRequest.shape.base64,
  document_text: text.max(32768), document_hash: registerHash }).strict();
export const registerFormDocument = z.object({ schema_version: z.literal(1), form_id: registerId, operation_id: registerId, request_metadata: registerFormMetadata,
  request_hash: registerHash, actor_id: registerId, session_id: registerId, recorded_at: serverTime, obtained_at_basis: z.literal("staff_reported"), event_hash: registerHash.nullable(),
  sha256: registerHash, byte_length: z.number().int().min(1).max(2097152), mime: registerFormMetadata.shape.mime }).strict();
export const registerWitnessDocument = z.object({ schema_version: z.literal(1), operation_id: registerId, stage: z.literal("saved"), actor_id: registerId, actor_name: label,
  recorder_id: registerId, recorder_name: label, parent_action_id: registerId, writer: text.max(100), product_id: registerId, event_kind: text.max(100), recorded_at: serverTime, preparation_digest: registerHash,
  request: z.object({ schema_version: z.literal(1), actor_id: registerId, operation_id: registerId, parent_action_id: registerId, writer: text.max(100), product_id: registerId,
    event_kind: text.max(100), preparation_digest: registerHash, attest_witness: z.literal(true) }).strict(), receipt: witnessReceiptSchema }).strict();

const quantity = text.regex(/^-?(?:0|[1-9][0-9]{0,16})\.\d{3}$/);
const custody = z.object({ status: text.max(40), location_id: registerId.nullable(), custodian_id: registerId.nullable() }).strict().nullable();
const line = z.object({ cell_id: registerId, container_id: registerId, lot_id: registerId.nullable(), channel: text.max(50), quantity_delta: quantity, running_quantity: quantity }).strict();
const opening = z.object({ opening_id: registerId, observed_at: serverTime, recorded_at: serverTime, quantity }).strict().nullable();
const cell = z.object({ cell_id: registerId, container_id: registerId, label: text.max(1000), kind: text.max(100), lot_id: registerId.nullable(), channel: text.max(50),
  stock_unit: text.max(100), opening_quantity: quantity, closing_quantity: quantity, period_opening_entry: opening, custody_at_start: custody, custody_at_end: custody }).strict();
const currentDisplay = z.object({ basis: z.literal("current_display_captured_at_export"), patient_id: registerId, patient_name: text.max(1000), client_id: registerId, client_name: text.max(1000) }).strict().nullable();
const evidenceText = { document_text: text.max(4194304), document_hash: registerHash };
const witness = z.object({ operation_id: registerId, record_hash: registerHash, ...evidenceText }).strict();
const event = z.object({ event_id: registerId, sequence: text.regex(/^[1-9][0-9]*$/).max(30), writer: text.max(100), event_kind: text.max(100), actor_id: registerId,
  actor_name: text.max(1000), observed_at: serverTime.nullable(), recorded_at: serverTime, basis: z.enum(["physical_record", "correction_assertion", "annotation", "discrepancy_assertion"]), note: text.max(10000).nullable(), record_hash: registerHash,
  secondary_review_required: z.boolean(), lines: z.array(line).max(512), custody_text: text.max(4194304), source_packet_text: text.max(4194304), source_packet_hash: registerHash,
  review_history_text: text.max(4194304), review_history_hash: registerHash, saved_witnesses: z.array(witness).max(512), current_display: currentDisplay }).strict()
  .refine(value => (value.basis === "physical_record") === (value.observed_at !== null));
const form = z.object({ form_id: registerId, kind: registerFormMetadata.shape.kind, title: label, filename: label, mime: registerFormMetadata.shape.mime,
  byte_length: z.number().int().min(1).max(2097152), sha256: registerHash, obtained_at: serverTime, recorded_at: serverTime,
  event_id: registerId.nullable(), event_hash: registerHash.nullable(), ...evidenceText }).strict();
export const registerDataset = z.object({ schema_version: z.literal(1), report_id: registerId, request: registerReportRequest, captured_at: serverTime, time_basis: text.max(1000),
  schedule: z.enum(["II", "III", "IV", "V"]), product_name: text.max(1000), stock_unit: text.max(100), site_label: text.max(1000),
  registration_evidence_text: text.max(4194304), opening_evidence_text: text.max(4194304), authorization_kinds: z.array(text.max(100)).max(100),
  cells: z.array(cell).max(512), events: z.array(event).max(250), counts: z.array(z.object({ count_id: registerId, state: z.enum(["agreement", "variance"]),
    projection_text: text.max(4194304), projection_hash: registerHash }).strict()).max(32), supporting_forms: z.array(form).max(128), evidence_gaps: z.array(text.max(1000)).max(20) }).strict();
export interface RegisterDataset extends z.infer<typeof registerDataset> {}
