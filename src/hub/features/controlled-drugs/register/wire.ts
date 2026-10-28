import { z } from "zod";
import { ExactJsonNumber, protocolInteger, type ExactJson } from "../record-review/exact-json.ts";
import { reviewRequiredPacketSchema } from "../record-review/prepared-packet.ts";
import { reviewDetailResponseSchema } from "../record-review/read-detail.ts";
import { hashReviewTarget } from "../record-review/component-hashes.ts";
import { verifyCountReadReply } from "../count/count-read-wire.ts";
import { bindWitnessReceipt, witnessPointerSchema, witnessReceiptSchema } from "../witness/schema.ts";
import { verifyWitnessReceipt } from "../witness/wire.ts";
import { sameEntryJson } from "../entry/codec.ts";
import { decodeRegisterJson } from "./exact-json.ts";
import { registerDataset, registerDownload, registerFormDocument, registerFormRequest, registerId, registerListReply, registerListRequest, registerPointer, registerReply, registerReportRequest, registerWitnessDocument,
  type RegisterDataset, type RegisterPointer, type RegisterReply } from "./schema.ts";

const encoder = new TextEncoder();
const sourcePacket = reviewRequiredPacketSchema.omit({ current_authorization: true }).extend({ obligation: reviewRequiredPacketSchema.shape.obligation.nullable() }).strict();
const reviewHistory = z.object({ terminal_review: reviewDetailResponseSchema.options[0].shape.data.shape.terminal_review,
  escalations: reviewDetailResponseSchema.options[0].shape.data.shape.escalations }).strict();
export function parseRegisterReviewHistory(text: string) { return reviewHistory.parse(decodeRegisterJson(encoder.encode(text))); }
function invalid(): never { throw new Error("The register evidence could not be verified. Recover the original operation."); }
/** Only closed protocol integers become Number. Original clinical JSON stays text. */
function protocol(value: ExactJson): unknown {
  if (value instanceof ExactJsonNumber) return protocolInteger(value, 0, 2147483647);
  if (Array.isArray(value)) return value.map(protocol);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, protocol(item)]));
  return value;
}
export async function registerSha(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
async function textHash(text: string, expected: string, length?: number) {
  const raw = encoder.encode(text);
  if (length !== undefined && raw.length !== length || await registerSha(raw) !== expected) invalid();
}
/** Private finite codec: keys are ASCII; values are parsed request strings/1/null. */
function requestText(input: unknown): string {
  if (input === null) return "null";
  if (input === 1) return "1";
  if (typeof input === "string") return JSON.stringify(input);
  if (!input || typeof input !== "object" || Array.isArray(input)) return invalid();
  const keys = Object.keys(input).sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0));
  return `{${keys.map(key => `${JSON.stringify(key)}: ${requestText((input as Record<string, unknown>)[key])}`).join(", ")}}`;
}
export function sameRegisterMetadata(a: unknown, b: unknown): boolean { return requestText(a) === requestText(b); }
async function requestHash(kind: "report" | "form", request: unknown) {
  return registerSha(encoder.encode(requestText({ domain: `narcotics-register-${kind}-request-v1`, value: request })));
}
export function parseRegisterDataset(text: string): RegisterDataset {
  const raw = encoder.encode(text); if (raw.length > 4194304) invalid();
  return registerDataset.parse(protocol(decodeRegisterJson(raw)));
}
export function verifyRegisterList(raw: Uint8Array, input: unknown) {
  const request = registerListRequest.parse(input), result = registerListReply.parse(protocol(decodeRegisterJson(raw)));
  if (result.actor_id !== request.actor_id || result.product_id !== request.product_id || result.site_id !== request.site_id || result.items.length > request.page_size ||
    new Set(result.items.map(item => item.operation_id)).size !== result.items.length ||
    (result.has_more ? result.items.length !== request.page_size || result.next_operation_id !== result.items[result.items.length - 1]?.operation_id : result.next_operation_id !== null)) invalid();
  return result;
}
export async function verifyRegisterReply(raw: Uint8Array, pointerInput: RegisterPointer, original?: unknown): Promise<RegisterReply> {
  const pointer = registerPointer.parse(pointerInput), reply = registerReply.parse(protocol(decodeRegisterJson(raw)));
  if (reply.operation_id !== pointer.operation_id || reply.kind !== pointer.kind) invalid();
  if (reply.state !== "saved") return reply;
  const request = reply.request_metadata;
  if (reply.actor_id !== pointer.actor_id || request.actor_id !== pointer.actor_id || request.operation_id !== pointer.operation_id ||
    request.product_id !== pointer.product_id || request.site_id !== pointer.site_id) invalid();
  if (reply.kind === "report") {
    const data = reply.data, wanted = original === undefined ? reply.request_metadata : registerReportRequest.parse(original);
    if (!sameRegisterMetadata(wanted, request) || await requestHash("report", wanted) !== reply.request_hash) invalid();
    await textHash(data.dataset_text, data.dataset_hash, data.dataset_utf8_bytes);
    await textHash(data.csv_text, data.csv_hash, data.csv_utf8_bytes);
    const dataset = parseRegisterDataset(data.dataset_text);
    if (dataset.report_id !== pointer.operation_id || dataset.captured_at !== data.captured_at || !sameRegisterMetadata(dataset.request, request)) invalid();
    const from = wanted.from_at.slice(0, -1) + "000Z", until = wanted.to_at.slice(0, -1) + "000Z";
    if (dataset.captured_at < until || reply.recorded_at < dataset.captured_at || new Set(dataset.events.map(event => event.event_id)).size !== dataset.events.length ||
      new Set(dataset.cells.map(cell => cell.cell_id)).size !== dataset.cells.length) invalid();
    const running = new Map(dataset.cells.map(cell => [cell.cell_id, quantityUnits(cell.opening_quantity) + (cell.period_opening_entry ? quantityUnits(cell.period_opening_entry.quantity) : 0n)]));
    for (const [index, event] of dataset.events.entries()) {
      if (event.recorded_at < from || event.recorded_at >= until || index > 0 && BigInt(dataset.events[index - 1].sequence) >= BigInt(event.sequence)) invalid();
      await textHash(event.source_packet_text, event.source_packet_hash);
      await textHash(event.review_history_text, event.review_history_hash);
      const packet = sourcePacket.parse(decodeRegisterJson(encoder.encode(event.source_packet_text))), target = packet.target, original = packet.event;
      if (target.event_id !== event.event_id || target.product_id !== request.product_id || target.record_hash !== event.record_hash ||
        String(target.sequence) !== event.sequence || target.original_actor_id !== event.actor_id || packet.adapter.site_id !== request.site_id ||
        packet.adapter.event_kind !== event.event_kind || original.id !== event.event_id || original.product_id !== request.product_id ||
        original.record_hash !== event.record_hash || String(original.sequence) !== event.sequence || original.actor_id !== event.actor_id ||
        original.actor_name !== event.actor_name || original.writer !== event.writer || original.event_kind !== event.event_kind || original.basis !== event.basis || original.secondary_review_required !== event.secondary_review_required ||
        canonicalSourceTime(original.observed_at) !== event.observed_at || canonicalSourceTime(original.recorded_at) !== event.recorded_at || original.note !== event.note) invalid();
      const patients = new Set(packet.source_rows.filter(row => ["public.patient_treatments", "public.native_prescription_authorizations", "public.native_dispenses"].includes(row.relation))
        .filter(row => row.row.pet_id !== undefined && row.row.pet_id !== null).map(row => registerId.parse(row.row.pet_id)));
      if (patients.size > 1 || event.current_display !== null && !patients.has(event.current_display.patient_id)) invalid();
      const permission = z.object({ frozen: z.object({ permission: z.object({ witness: z.enum(["none", "c2_required"]) }).passthrough() }).passthrough() }).passthrough().parse(packet.parent_preparation);
      if (event.saved_witnesses.length !== (permission.frozen.permission.witness === "c2_required" ? 1 : 0)) invalid();
      const transitions = packet.transitions.filter(row => row.event_id === event.event_id).sort((a, b) => String(a.container_id).localeCompare(String(b.container_id)));
      const custody = decodeRegisterJson(encoder.encode(event.custody_text));
      if (!Array.isArray(custody) || new Set(transitions.map(row => row.container_id)).size !== transitions.length || !sameEntryJson(custody, transitions)) invalid();
      const history = parseRegisterReviewHistory(event.review_history_text), terminal = history.terminal_review;
      if (terminal && (terminal.actor_id === event.actor_id || terminal.target_hash !== await hashReviewTarget(target) || terminal.recorded_at < event.recorded_at || terminal.recorded_at > dataset.captured_at) ||
        history.escalations.some(item => item.first_detected_at > dataset.captured_at) ||
        original.secondary_review_required === false && (terminal !== null || history.escalations.length > 0)) invalid();
      // Native-family packets also retain earlier related events' lines.
      const postedLines = packet.event_lines.filter(row => row.event_id === event.event_id);
      if (postedLines.length !== event.lines.length || new Set(event.lines.map(line => line.cell_id)).size !== event.lines.length) invalid();
      for (const line of event.lines) {
        const originalLine = postedLines.find(row => row.cell_id === line.cell_id), cell = dataset.cells.find(item => item.cell_id === line.cell_id);
        if (!originalLine || originalLine.event_id !== event.event_id || String(originalLine.quantity_delta) !== line.quantity_delta || !cell ||
          cell.container_id !== line.container_id || cell.lot_id !== line.lot_id || cell.channel !== line.channel || cell.stock_unit !== dataset.stock_unit) invalid();
        const next = running.get(line.cell_id)! + quantityUnits(line.quantity_delta); running.set(line.cell_id, next);
        if (next !== quantityUnits(line.running_quantity)) invalid();
      }
      for (const witness of event.saved_witnesses) {
        await textHash(witness.document_text, witness.document_hash);
        const document = registerWitnessDocument.parse(protocol(decodeRegisterJson(encoder.encode(witness.document_text))));
        const pointer = witnessPointerSchema.parse({ schema_version: 1, actor_id: document.actor_id, operation_id: document.operation_id,
          parent_action_id: document.parent_action_id, writer: document.writer, product_id: document.product_id, event_kind: document.event_kind });
        const receipt = witnessReceiptSchema.parse(document.receipt);
        bindWitnessReceipt(receipt, pointer, String(document.preparation_digest)); await verifyWitnessReceipt(receipt);
        const preparedAt = canonicalSourceTime(packet.parent_preparation.created_at), expiresAt = canonicalSourceTime(packet.parent_preparation.expires_at);
        if (preparedAt === null || expiresAt === null) invalid();
        if (document.schema_version !== 1 || document.stage !== "saved" ||
          pointer.operation_id !== witness.operation_id || pointer.parent_action_id !== event.event_id || pointer.product_id !== request.product_id ||
          pointer.writer !== event.writer || pointer.event_kind !== event.event_kind || document.recorder_id !== event.actor_id || document.actor_id === event.actor_id ||
          document.recorded_at !== receipt.recorded_at || document.recorded_at > event.recorded_at ||
          document.recorded_at < preparedAt || document.recorded_at >= expiresAt) invalid();
        const q = document.request;
        for (const key of ["actor_id", "operation_id", "parent_action_id", "writer", "product_id", "event_kind", "preparation_digest"] as const)
          if (q[key] !== document[key]) invalid();
        if (q.attest_witness !== true || q.schema_version !== 1) invalid();
      }
    }
    for (const cell of dataset.cells) if (running.get(cell.cell_id) !== quantityUnits(cell.closing_quantity)) invalid();
    for (const count of dataset.counts) {
      await textHash(count.projection_text, count.projection_hash);
      const projection = await verifyCountReadReply(encoder.encode(count.projection_text), { schema_version: 1, actor_id: pointer.actor_id, count_id: count.count_id });
      if (projection.state !== "available" || projection.data.product.id !== request.product_id || projection.data.site.id !== request.site_id || projection.data.history_state !== count.state ||
        projection.data.read_at > dataset.captured_at || projection.data.terminal?.kind !== "outcome" || projection.data.terminal.recorded_at < from || projection.data.terminal.recorded_at >= until) invalid();
    }
    for (const form of dataset.supporting_forms) {
      await textHash(form.document_text, form.document_hash);
      const document = registerFormDocument.parse(protocol(decodeRegisterJson(encoder.encode(form.document_text)))), metadata = document.request_metadata;
      if (document.form_id !== form.form_id || document.operation_id !== form.form_id || metadata.operation_id !== form.form_id || document.actor_id !== metadata.actor_id ||
        document.recorded_at !== form.recorded_at || document.recorded_at > dataset.captured_at || document.event_hash !== form.event_hash || metadata.product_id !== request.product_id || metadata.site_id !== request.site_id ||
        metadata.event_id !== form.event_id || metadata.kind !== form.kind || metadata.title !== form.title || metadata.filename !== form.filename ||
        metadata.obtained_at.slice(0, -1) + "000Z" !== form.obtained_at || document.mime !== form.mime || metadata.mime !== form.mime ||
        document.sha256 !== form.sha256 || document.byte_length !== form.byte_length ||
        (form.event_id === null ? form.event_hash !== null : !dataset.events.some(event => event.event_id === form.event_id && event.record_hash === form.event_hash))) invalid();
    }
  } else {
    if (reply.data.form_id !== pointer.operation_id || reply.data.mime !== reply.request_metadata.mime || reply.data.filename !== reply.request_metadata.filename) invalid();
    await textHash(reply.data.document_text, reply.data.document_hash);
    const document = registerFormDocument.parse(protocol(decodeRegisterJson(encoder.encode(reply.data.document_text))));
    if (document.form_id !== pointer.operation_id || document.operation_id !== pointer.operation_id || document.actor_id !== pointer.actor_id ||
      document.request_hash !== reply.request_hash || document.session_id !== reply.original_session_id || document.recorded_at !== reply.recorded_at ||
      document.sha256 !== reply.data.sha256 || document.byte_length !== reply.data.byte_length || document.mime !== reply.data.mime ||
      !sameRegisterMetadata(document.request_metadata, request)) invalid();
    if (original !== undefined) {
      const { base64, ...metadata } = registerFormRequest.parse(original);
      if (!sameRegisterMetadata(metadata, request) || await requestHash("form", { ...metadata, base64 }) !== reply.request_hash) invalid();
      const binary = atob(base64), bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
      if (bytes.length !== reply.data.byte_length || await registerSha(bytes) !== reply.data.sha256) invalid();
    }
  }
  return reply;
}
function quantityUnits(value: string): bigint { return BigInt(value.replace(".", "")); }
export function parseRegisterWitnessDocument(text: string) { return registerWitnessDocument.parse(protocol(decodeRegisterJson(encoder.encode(text)))); }
function canonicalSourceTime(value: ExactJson): string | null {
  if (value === null) return null;
  if (typeof value !== "string") return invalid();
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(?:Z|\+00:00)$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return invalid();
  return `${match[1]}.${(match[2] ?? "").padEnd(6, "0")}Z`;
}
export async function verifyRegisterDownload(raw: Uint8Array, formId: string) {
  const result = registerDownload.parse(protocol(decodeRegisterJson(raw)));
  if (result.form_id !== formId) invalid();
  const binary = atob(result.base64), bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  if (btoa(binary) !== result.base64 || bytes.length !== result.byte_length || await registerSha(bytes) !== result.sha256) invalid();
  await textHash(result.document_text, result.document_hash);
  const document = registerFormDocument.parse(protocol(decodeRegisterJson(encoder.encode(result.document_text))));
  if (document.form_id !== formId || document.operation_id !== formId || document.sha256 !== result.sha256 || document.byte_length !== result.byte_length ||
    document.mime !== result.mime || document.request_metadata.filename !== result.filename || document.request_metadata.mime !== result.mime ||
    document.request_metadata.operation_id !== formId || document.request_metadata.actor_id !== document.actor_id) invalid();
  return Object.freeze({ metadata: Object.freeze(result), bytes });
}
