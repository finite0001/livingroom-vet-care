import { z } from "zod";
import { ExactJsonNumber, protocolInteger, type ExactJson } from "../record-review/exact-json.ts";
import { reviewUuidSchema as uuid } from "../record-review/request.ts";
import { reviewProtocolInstantSchema } from "../record-review/prepared-packet.ts";
import { reviewEventKindSchema } from "../record-review/queue-model.ts";
import { controlledStockWriterSchema } from "../entry/gateway.ts";
import { entryPreparationSchema, type EntryPointer } from "../entry/schema.ts";
import { entryObject, sameEntryJson } from "../entry/codec.ts";
import { administrationName, freezeAdministration } from "../administration/primitives.ts";

const one = z.preprocess(value => value instanceof ExactJsonNumber ? protocolInteger(value, 1, 1) : value, z.literal(1));
const digest = z.string().regex(/^[0-9a-f]{64}$/);
export const witnessPointerSchema = z.object({ schema_version: one, actor_id: uuid, operation_id: uuid,
  parent_action_id: uuid, writer: controlledStockWriterSchema, product_id: uuid, event_kind: reviewEventKindSchema }).strict()
  .refine(value => value.operation_id !== value.parent_action_id && kindMatches(value.writer, value.event_kind));
export interface WitnessPointer extends z.infer<typeof witnessPointerSchema> {}
const recorder = z.object({ id: uuid, name: administrationName }).strict();
export const witnessPreparationSchema = entryPreparationSchema.omit({ state: true, receipt: true }).strict();
export interface WitnessPreparation extends z.infer<typeof witnessPreparationSchema> {}
const cursor = z.object({ created_at: reviewProtocolInstantSchema, parent_action_id: uuid }).strict();
export interface WitnessCursor extends z.infer<typeof cursor> {}
export const witnessListRequestSchema = z.object({ schema_version: one, actor_id: uuid, cursor: cursor.nullable(),
  page_size: z.number().int().min(1).max(100) }).strict();
export interface WitnessListRequest extends z.infer<typeof witnessListRequestSchema> {}
export const witnessTaskSchema = z.object({ parent_action_id: uuid, writer: controlledStockWriterSchema, product_id: uuid,
  product_name: administrationName, event_kind: reviewEventKindSchema, recorder, created_at: reviewProtocolInstantSchema,
  expires_at: reviewProtocolInstantSchema, available_actions: z.tuple([z.literal("read"), z.literal("attest")]) }).strict();
export interface WitnessTask extends z.infer<typeof witnessTaskSchema> {}
const listSchema = z.object({ schema_version: one, items: z.array(witnessTaskSchema).max(100), next_cursor: cursor.nullable(), has_more: z.boolean() }).strict();
export interface WitnessList extends z.infer<typeof listSchema> {}
const blockedReason = z.enum(["parent_expired", "parent_cancelled", "parent_saved", "source_changed", "current_witness_ineligible"]);
export const witnessReceiptSchema = z.object({ schema_version: one, action: z.literal("witness_attest"), actor_id: uuid,
  operation_id: uuid, parent_action_id: uuid, writer: controlledStockWriterSchema, product_id: uuid,
  event_kind: reviewEventKindSchema, preparation_digest: digest, recorded_at: reviewProtocolInstantSchema, receipt_digest: digest }).strict();
export interface WitnessReceipt extends z.infer<typeof witnessReceiptSchema> {}
const replySchema = z.object({ schema_version: one, state: z.enum(["available", "saved", "abandoned", "blocked", "not_found"]),
  data: z.object({ pointer: witnessPointerSchema, preparation: witnessPreparationSchema.nullable(), preparation_digest: digest.nullable(),
    recorder: recorder.nullable(), receipt: witnessReceiptSchema.nullable(), blocked_reason: blockedReason.nullable() }).strict() }).strict();
export interface WitnessReply extends z.infer<typeof replySchema> {}
const statusSchema = z.object({ schema_version: one, state: z.enum(["not_required", "required", "witnessed", "blocked"]),
  data: z.object({ parent_action_id: uuid, product_id: uuid, event_kind: reviewEventKindSchema,
    witness: z.object({ operation_id: uuid, actor_id: uuid, name: administrationName, recorded_at: reviewProtocolInstantSchema }).strict().nullable(),
    blocked_reason: blockedReason.nullable() }).strict() }).strict();
export interface RecorderWitnessStatus extends z.infer<typeof statusSchema> {}
function invalid(): never { throw new Error("Witness evidence does not match the selected operation."); }
function kindMatches(writer: string, kind: string): boolean { return kind === writer || kind.startsWith(writer + ":"); }
function compare(a: WitnessCursor, b: WitnessCursor): number {
  return a.created_at === b.created_at ? a.parent_action_id === b.parent_action_id ? 0 : a.parent_action_id < b.parent_action_id ? -1 : 1 : a.created_at < b.created_at ? -1 : 1;
}
export function parseWitnessList(raw: ExactJson, request: WitnessListRequest): WitnessList {
  const value = listSchema.parse(raw);
  if (value.items.length > request.page_size || value.items.some((row, index) => row.recorder.id === request.actor_id || !kindMatches(row.writer, row.event_kind) ||
    request.cursor !== null && compare(row, request.cursor) <= 0 || index > 0 && compare(value.items[index - 1], row) >= 0)) invalid();
  const last = value.items.at(-1);
  if (value.has_more ? !last || !sameEntryJson(value.next_cursor, { created_at: last.created_at, parent_action_id: last.parent_action_id }) : value.next_cursor !== null) invalid();
  return freezeAdministration(value);
}
export function bindWitnessReceipt(receipt: WitnessReceipt, pointer: WitnessPointer, expectedDigest?: string): void {
  for (const key of ["actor_id", "operation_id", "parent_action_id", "writer", "product_id", "event_kind"] as const)
    if (receipt[key] !== pointer[key]) invalid();
  if (expectedDigest !== undefined && receipt.preparation_digest !== expectedDigest) invalid();
}
export function parseWitnessReply(raw: ExactJson, pointer: WitnessPointer, operationOnly = false): WitnessReply {
  const value = replySchema.parse(raw), d = value.data;
  if (!sameEntryJson(d.pointer, pointer) || (operationOnly ? !["saved", "abandoned", "not_found"].includes(value.state) : value.state === "not_found")) invalid();
  if (value.state === "abandoned" || value.state === "not_found") {
    if ([d.preparation, d.preparation_digest, d.recorder, d.receipt, d.blocked_reason].some(v => v !== null)) invalid();
    return freezeAdministration(value);
  }
  if ((value.state === "blocked") !== (d.blocked_reason !== null) || (value.state === "saved") !== (d.receipt !== null)) invalid();
  if ((d.preparation !== null) !== (d.preparation_digest !== null) || (d.preparation !== null) !== (d.recorder !== null)) invalid();
  if (value.state !== "blocked" && (!d.preparation || !d.preparation_digest || !d.recorder)) invalid();
  const p = d.preparation;
  if (p) {
    if (!d.recorder || p.id !== pointer.parent_action_id || p.writer !== pointer.writer || p.actor_id === pointer.actor_id || p.actor_id !== d.recorder.id ||
      p.context.product_id !== pointer.product_id || p.frozen.catalog.id !== pointer.product_id || p.frozen.permission.witness !== "c2_required" ||
      p.context.basis.kind !== p.frozen.permission.basis || p.context.containers.length !== p.frozen.containers.length) invalid();
    let kind: string = p.writer;
    if (p.writer === "record_native_dispense_return" || p.writer === "record_native_dispense_return_v2" || p.writer === "record_native_return_discrepancy")
      kind += ":" + entryObject(entryObject(p.canonical_arguments.request).intent).action;
    if (p.writer === "append_native_dispense_correction") kind += ":" + entryObject(p.canonical_arguments.request).kind;
    if (kind !== pointer.event_kind) invalid();
    p.frozen.containers.forEach((frame, index) => {
      const c = p.context.containers[index];
      if (frame.id !== c.id || (c.create ? frame.container !== null || frame.head !== null || frame.cells.length !== 0 :
        !frame.container || !frame.head || frame.container.id !== c.id || frame.head.container_id !== c.id || !sameEntryJson(frame.head.version, c.expected_version))) invalid();
    });
  }
  if (d.receipt) bindWitnessReceipt(d.receipt, pointer, d.preparation_digest ?? undefined);
  return freezeAdministration(value);
}
export function parseRecorderWitnessStatus(raw: ExactJson, pointer: EntryPointer): RecorderWitnessStatus {
  const value = statusSchema.parse(raw), d = value.data;
  if (d.parent_action_id !== pointer.operation_id || d.product_id !== pointer.product_id || d.event_kind !== pointer.event_kind ||
    (value.state === "blocked") !== (d.blocked_reason !== null) || value.state === "witnessed" && d.witness === null ||
    (value.state === "required" || value.state === "not_required") && d.witness !== null ||
    d.witness && (d.witness.actor_id === pointer.actor_id || d.witness.operation_id === pointer.operation_id)) invalid();
  return freezeAdministration(value);
}
