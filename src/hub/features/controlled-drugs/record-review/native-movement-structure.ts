import { z } from "zod";
import { clinicalAlertSnapshotSchema } from "./clinical-alert-snapshot.ts";
import { ExactJsonNumber, protocolInteger, validUnicode, type ExactJson } from "./exact-json.ts";
import { reviewContextQuantity, reviewInstantMicroseconds, reviewQuantityThousandths, reviewSnapshotTotalThousandths } from "./exact-values.ts";
import { reviewJsonbTextBytes, reviewNumericTextBytes } from "./prepared-packet.ts";
import { reviewDigestSchema as digest, reviewUuidSchema as uuid } from "./request.ts";
import { verifyProspectiveSourceRowStructure } from "./prospective-packet-structure.ts";

export interface NativeObject { readonly [key: string]: ExactJson }
export type NativeWriter = "record_native_dispense" | "record_native_pickup" | "record_native_dispense_return" |
  "record_native_dispense_return_v2" | "append_native_dispense_correction" | "record_native_return_discrepancy";
export type NativeDocumentKind = "dispense" | "pickup" | "return_v1" | "return_v2" | "correction" | "discrepancy" | "return_policy";
export const nativeEventKinds = {
  record_native_dispense: "dispense_v1", record_native_pickup: "pickup_v1",
  "record_native_dispense_return:intake": "return_v1", "record_native_dispense_return:dispose": "return_v1", "record_native_dispense_return:restock": "return_v1",
  "record_native_dispense_return_v2:intake": "return_v2", "record_native_dispense_return_v2:dispose": "return_v2", "record_native_dispense_return_v2:restock": "return_v2",
  "record_native_dispense_return_v2:retract_intake": "retraction_v1", "record_native_dispense_return_v2:retract_disposal": "retraction_v1", "record_native_dispense_return_v2:retract_restock": "retraction_v1",
  "append_native_dispense_correction:clinical_annotation": "annotation_v1", "append_native_dispense_correction:operational_annotation": "annotation_v1", "append_native_dispense_correction:pickup_amendment": "annotation_v1",
  "record_native_return_discrepancy:report": "discrepancy_v1", "record_native_return_discrepancy:note": "discrepancy_v1",
  "record_native_return_discrepancy:resolve_corrected": "discrepancy_v1", "record_native_return_discrepancy:resolve_confirmed_original": "discrepancy_v1",
} as const;
export function nativeInvalid(): never { throw new Error("Native evidence is inconsistent or outside its declared local domain"); }
export function nativeObject(value: ExactJson): NativeObject {
  if (!value || typeof value !== "object" || Array.isArray(value) || value instanceof ExactJsonNumber) nativeInvalid();
  return value as NativeObject;
}
export function nativeArray(value: ExactJson): readonly ExactJson[] { if (!Array.isArray(value)) nativeInvalid(); return value; }
/** Snapshot already deeply frozen pipeline evidence before any schema/digest await. Borrowed mutable objects are refused. Own data only;
 * forged numbers, accessors, cycles and prototype objects never reach Zod. */
export function snapshotNativeEvidence(input: unknown): ExactJson {
  let nodes = 0, bytes = 0;
  const charge = (n: number) => { bytes += n; if (bytes > 1048576) nativeInvalid(); };
  const ancestors = new Set<object>();
  function visit(value: unknown, depth: number): ExactJson {
    if (++nodes > 100000 || depth > 64) nativeInvalid();
    if (value === null || typeof value === "boolean") { charge(value === null ? 4 : value ? 4 : 5); return value as null | boolean; }
    if (typeof value === "string") {
      if (value.length > 1048576 || !validUnicode(value) || value.includes("\0")) nativeInvalid();
      charge(reviewJsonbTextBytes(value)); return value;
    }
    if (value instanceof ExactJsonNumber) {
      const token = Object.getOwnPropertyDescriptor(value, "token");
      if (Object.getPrototypeOf(value) !== ExactJsonNumber.prototype || !Object.isFrozen(value) ||
        Object.getOwnPropertyNames(value).length !== 1 || Object.getOwnPropertySymbols(value).length ||
        !token || !("value" in token) || typeof token.value !== "string" || token.value.length > 1024 ||
        reviewNumericTextBytes(value) > 1048576n) nativeInvalid();
      charge(Number(reviewNumericTextBytes(value))); return new ExactJsonNumber(token.value);
    }
    if (!value || typeof value !== "object" || !Object.isFrozen(value) || ancestors.has(value) || Object.getOwnPropertySymbols(value).length) nativeInvalid();
    if (!Array.isArray(value) && ![null, Object.prototype].includes(Object.getPrototypeOf(value))) nativeInvalid();
    ancestors.add(value);
    let result: ExactJson;
    if (Array.isArray(value)) {
      if (value.length > 100000 || Object.getOwnPropertyNames(value).length !== value.length + 1) nativeInvalid();
      charge(2 + Math.max(0, value.length - 1) * 2);
      const items: ExactJson[] = [];
      for (let i = 0; i < value.length; i++) {
        const d = Object.getOwnPropertyDescriptor(value, String(i));
        if (!d || !("value" in d) || !d.enumerable) nativeInvalid();
        items.push(visit(d.value, depth + 1));
      }
      result = Object.freeze(items) as unknown as ExactJson;
    } else {
      const out: Record<string, ExactJson> = Object.create(null), entries = Object.getOwnPropertyDescriptors(value);
      if (Object.keys(entries).length > 100000) nativeInvalid();
      charge(2 + Math.max(0, Object.keys(entries).length - 1) * 2);
      for (const [key, d] of Object.entries(entries)) {
        if (!("value" in d) || !d.enumerable || key.length > 1048576 || !validUnicode(key) || key.includes("\0")) nativeInvalid();
        charge(reviewJsonbTextBytes(key) + 2); out[key] = visit(d.value, depth + 1);
      }
      result = Object.freeze(out);
    }
    ancestors.delete(value); return result;
  }
  const result = visit(input, 0);
  if (reviewJsonbTextBytes(result) > 1048576) nativeInvalid();
  return result;
}
export function nativeQuantity(value: ExactJson, zero = false): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,10})(?:\.[0-9]{1,3})?$/.test(value)) nativeInvalid();
  const q = reviewQuantityThousandths(new ExactJsonNumber(value));
  if (q < 0n || (!zero && q === 0n)) nativeInvalid(); return q;
}
export function nativeInteger(value: ExactJson, min = 0n, max = 2147483647n): bigint {
  if (!(value instanceof ExactJsonNumber)) nativeInvalid();
  const n = reviewQuantityThousandths(value);
  if (n % 1000n || n / 1000n < min || n / 1000n > max) nativeInvalid(); return n / 1000n;
}
const semanticInteger = (min: bigint, max: bigint) => z.instanceof(ExactJsonNumber).refine(v => { try { nativeInteger(v, min, max); return true; } catch { return false; } });
const wireInteger = (min: number, max: number) => z.instanceof(ExactJsonNumber).refine(v => { try { protocolInteger(v, min, max); return true; } catch { return false; } });
const one = semanticInteger(1n, 1n), two = semanticInteger(2n, 2n), sequence = semanticInteger(1n, 2147483647n);
export const nativeText = (max: number, multiline = true) => z.string().refine(v => validUnicode(v) && !v.includes("\0") && v === v.trim() && Array.from(v).length >= 1 && Array.from(v).length <= max &&
  Array.from(v).every(c => c.codePointAt(0)! >= 32 && c.codePointAt(0) !== 127 || multiline && (c === "\n" || c === "\t")));
const rawText = (min: number, max: number) => z.string().refine(v => validUnicode(v) && !v.includes("\0") && Array.from(v).length >= min && Array.from(v).length <= max);
const instant = z.string().refine(v => { try { reviewInstantMicroseconds(v); return true; } catch { return false; } });
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => { try { reviewInstantMicroseconds(v + "T00:00:00Z"); return true; } catch { return false; } });
const quantity = z.string().refine(v => { try { nativeQuantity(v); return true; } catch { return false; } });
const storedQuantity = quantity.refine(v => /^(0|[1-9][0-9]{0,10})\.[0-9]{3}$/.test(v));
const nonnegativeQuantity = z.string().refine(v => { try { nativeQuantity(v, true); return true; } catch { return false; } });
const storedNonnegative = nonnegativeQuantity.refine(v => /^(0|[1-9][0-9]{0,10})\.[0-9]{3}$/.test(v));
const signedQuantity = z.string().refine(v => { try { reviewContextQuantity(v); return true; } catch { return false; } });
const aggregate = z.string().refine(v => { try { reviewSnapshotTotalThousandths(v); return true; } catch { return false; } });
const cents = z.string().regex(/^(0|[1-9][0-9]{0,18})$/).refine(v => BigInt(v) <= 9223372036854775807n);
const domainObject = z.custom<NativeObject>(v => !!v && typeof v === "object" && !Array.isArray(v) && !(v instanceof ExactJsonNumber));
const sourceRow = (relation: string) => z.custom<NativeObject>(v => { try { verifyProspectiveSourceRowStructure(relation, v); return true; } catch { return false; } });
const mixedUuid = z.string().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/).refine(v => !/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(v));
const target = z.object({ authorization_id: uuid, pet_id: uuid, dispense_id: uuid }).strict();
const source = z.object({ event_id: uuid, record_hash: digest }).strict();
export const nativeHeadSchema = z.object({ event_id: uuid.nullable(), version: wireInteger(0, 2147483647), record_hash: digest.nullable() }).strict()
  .refine(v => (String(v.version) === "0") === (v.event_id === null) && (v.event_id === null) === (v.record_hash === null));
const actor = z.object({ id: uuid, name: nativeText(200), authority: z.enum(["active_staff", "active_dvm"]) }).strict();
const sorted = <T>(values: T[], id: (value: T) => string) => values.every((v, i) => !i || id(values[i - 1]) < id(v));
const allocation = z.object({ allocation_id: uuid, quantity }).strict();
const allocations = z.array(allocation).min(1).max(100).refine(v => sorted(v, x => x.allocation_id));
const custody = z.enum(["clinic_retained", "client_returned", "unknown"]);
const condition = z.enum(["sealed_intact", "opened", "damaged", "unknown"]), storage = z.enum(["controlled", "compromised", "unknown"]);
const returnActions = z.enum(["intake", "dispose", "restock", "retract_intake", "retract_disposal", "retract_restock"]);
const ordinaryActions = z.enum(["intake", "dispose", "restock"]);
const intentBase = { target, action: returnActions, intake_id: uuid.nullable(), allocations, custody: custody.nullable(), package_condition: condition.nullable(), storage_history: storage.nullable(), reason: nativeText(2000), note: nativeText(4000) };
function validIntake(v: { action?: string; intake_id?: string; custody?: string; package_condition?: string; storage_history?: string }) {
  return v.action === "intake" ? v.intake_id === null && v.custody !== null && v.package_condition !== null && v.storage_history !== null : v.intake_id !== null && v.custody === null && v.package_condition === null && v.storage_history === null;
}
export const nativeReturnIntentV1 = z.object({ ...intentBase, action: ordinaryActions }).strict().refine(validIntake);
export const nativeReturnIntentV2 = z.object({ ...intentBase, correction_target: source.nullable(), discrepancy_id: uuid.nullable() }).strict().refine(v => validIntake(v) &&
  (v.action.startsWith("retract_") ? v.correction_target !== null : v.correction_target === null && v.discrepancy_id === null));
export const nativePhysicalAttestations = z.object({ reviewed_physical_facts: z.literal(true), intake_claim_incorrect: z.boolean(), remains_physically_held: z.boolean(), was_not_destroyed: z.boolean(), removed_from_available_stock: z.boolean() }).strict();
const dispenseTarget = z.object({ authorization_id: mixedUuid, pet_id: mixedUuid, slot_index: wireInteger(0, 1000), expected_slot_version: wireInteger(1, 2147483647).nullable(), invoice_id: mixedUuid, quantity,
  allocations: z.array(z.object({ lot_id: mixedUuid, quantity }).strict()).min(1).max(100).refine(v => sorted(v, x => x.lot_id.toLowerCase())), refill: z.object({ id: mixedUuid, expected_version: wireInteger(1, 2147483647) }).strict().nullable() }).strict();
const dispenseRequest = dispenseTarget.extend({ expected_context_hash: digest, reason: nativeText(2000), attest_alert_review: z.literal(true), attest_dispense_review: z.literal(true) }).strict();
const pickupRequest = z.object({ authorization_id: mixedUuid, pet_id: mixedUuid, dispense_id: mixedUuid, expected_context_hash: digest, recipient_name: nativeText(200), recipient_relationship: nativeText(200), reason: nativeText(2000), attest_handoff: z.literal(true),
  refill_close: z.object({ id: mixedUuid, expected_version: wireInteger(1, 2147483647), reason: nativeText(2000) }).strict().nullable() }).strict();
const returnRequestV1 = z.object({ intent: nativeReturnIntentV1, expected_context_hash: digest, expected_head: nativeHeadSchema, attest_review: z.literal(true), attest_restock: z.boolean() }).strict();
const returnRequestV2 = z.object({ intent: nativeReturnIntentV2, expected_context_hash: digest, expected_head: nativeHeadSchema, expected_discrepancy_head: nativeHeadSchema, attest_review: z.literal(true), attest_restock: z.boolean(), physical_attestations: nativePhysicalAttestations }).strict();
export const nativePickupAmendmentSchema = z.object({ original_pickup_id: uuid, disposition: z.enum(["recorded_in_error", "corrected_handoff"]),
  handoff: z.object({ picked_up_at: instant, recipient_name: nativeText(200), recipient_relationship: nativeText(200) }).strict().nullable() }).strict()
  .refine(v => (v.disposition === "recorded_in_error") === (v.handoff === null));
const correctionRequest = z.object({ authorization_id: mixedUuid, pet_id: mixedUuid, dispense_id: mixedUuid, expected_context_hash: digest, expected_head: nativeHeadSchema, kind: z.enum(["clinical_annotation", "operational_annotation", "pickup_amendment"]), reason: nativeText(2000), note: nativeText(4000), amends_event_id: uuid.nullable(), pickup_amendment: nativePickupAmendmentSchema.nullable(), attest_review: z.literal(true) }).strict().refine(v => (v.kind === "pickup_amendment") === (v.pickup_amendment !== null));
const discrepancyActions = z.enum(["report", "note", "resolve_corrected", "resolve_confirmed_original"]);
const discrepancyIntent = z.object({ target, action: discrepancyActions, case_id: uuid.nullable(), source, allocations, observation: nativeText(4000), correction_ids: z.array(uuid).max(100).refine(v => sorted(v, x => x)) }).strict()
  .refine(v => (v.action === "report") === (v.case_id === null) && (v.action === "resolve_corrected" ? v.correction_ids.length > 0 : v.correction_ids.length === 0));
const discrepancyRequest = z.object({ intent: discrepancyIntent, expected_context_hash: digest, expected_return_head: nativeHeadSchema, expected_discrepancy_head: nativeHeadSchema, attest_physical_review: z.literal(true), attest_original_quantities_custody_and_stock_accurate: z.boolean() }).strict();
export const nativeRequestSchemas = { record_native_dispense: dispenseRequest, record_native_pickup: pickupRequest,
  record_native_dispense_return: returnRequestV1, record_native_dispense_return_v2: returnRequestV2,
  append_native_dispense_correction: correctionRequest, record_native_return_discrepancy: discrepancyRequest } as const;
const nativeAllocation = z.object({ allocation_id: uuid, lot_id: uuid, quantity: storedQuantity, movement_id: uuid.nullable() }).strict();
const nativeAllocations = z.array(nativeAllocation).min(1).max(100).refine(v => sorted(v, x => x.allocation_id));
const docBase = { version: one, id: uuid, target, authorization_hash: digest, dispense_document_hash: digest, sequence, prior_event_id: uuid.nullable(), prior_record_hash: digest.nullable(), actor, created_at: instant, record_hash: digest, reviewed_context_hash: digest };
const returnDocV1 = z.object({ ...docBase, action: ordinaryActions, intake_id: uuid.nullable(), allocations: nativeAllocations, custody: custody.nullable(), package_condition: condition.nullable(), storage_history: storage.nullable(), reason: nativeText(2000), note: nativeText(4000), policy: z.lazy(() => returnPolicy).nullable() }).strict();
const returnDocV2 = returnDocV1.extend({ version: two, action: returnActions, correction_target: source.nullable(), discrepancy_id: uuid.nullable(), physical_attestations: nativePhysicalAttestations }).strict();
const correctionDoc = z.object({ ...docBase, kind: z.enum(["clinical_annotation", "operational_annotation", "pickup_amendment"]), reason: nativeText(2000), note: nativeText(4000), amends_event_id: uuid.nullable(), pickup_amendment: nativePickupAmendmentSchema.nullable() }).strict();
const discrepancyDoc = z.object({ version: one, id: uuid, target, sequence, prior_event_id: uuid.nullable(), prior_record_hash: digest.nullable(), actor, action: discrepancyActions, case_id: uuid, source,
  allocations: z.array(z.object({ allocation_id: uuid, lot_id: uuid, quantity: storedQuantity }).strict()).min(1).max(100).refine(v => sorted(v, x => x.allocation_id)), observation: nativeText(4000), correction_ids: z.array(uuid).max(100).refine(v => sorted(v, x => x)), return_head: nativeHeadSchema, reviewed_context_hash: digest, created_at: instant, record_hash: digest }).strict();
export const nativeDispenseArtifactSchema = z.object({ id: uuid, authorization_id: uuid, authorization_hash: digest, fill_index: wireInteger(0, 1000), quantity: storedQuantity, unit: nativeText(50), dispensed_at: instant,
  recorded_by: z.object({ user_id: uuid, name: nativeText(200) }).strict(), invoice_id: uuid,
  lots: z.array(z.object({ id: uuid, number: nativeText(200), expires_on: date, quantity: storedQuantity }).strict()).min(1).max(100).refine(v => sorted(v, x => x.id)) }).strict();
const dispenseDoc = z.object({ version: one, id: uuid, authorization_id: uuid, authorization_hash: digest, pet_id: uuid, client_id: uuid, slot_id: uuid, slot_index: wireInteger(0, 1000), slot_version_before: wireInteger(1, 2147483646).nullable(), slot_version_after: wireInteger(1, 2147483647), quantity: storedQuantity, unit: nativeText(50), actor_id: uuid, dispensed_at: instant,
  reason: nativeText(2000), allocations: z.array(z.object({ lot_id: uuid, quantity: storedQuantity, movement_id: uuid }).strict()).min(1).max(100).refine(v => sorted(v, x => x.lot_id)),
  invoice_id: uuid, invoice_item_id: uuid, invoice_version_before: wireInteger(1, 2147483646), invoice_version_after: wireInteger(2, 2147483647), amount_cents: cents,
  refill_id: mixedUuid.nullable(), refill_event_id: uuid.nullable(), reviewed_context: domainObject, reviewed_context_hash: digest, artifact: nativeDispenseArtifactSchema, artifact_hash: digest }).strict();
const pickupDoc = z.object({ version: one, id: uuid, authorization_id: uuid, pet_id: uuid, dispense_id: uuid, actor_id: uuid, recipient_name: nativeText(200), recipient_relationship: nativeText(200), reason: nativeText(2000), reviewed_context: domainObject, reviewed_context_hash: digest, refill_id: mixedUuid.nullable(), refill_event_id: uuid.nullable(), picked_up_at: instant }).strict();
const returnPolicy = z.object({ version: sequence, enabled: z.boolean(), review_reference: nativeText(2000), actor_id: uuid, actor_name: nativeText(200), reviewed_at: instant, record_hash: digest }).strict();
const authHead = z.object({ id: uuid, hash: digest, head_id: uuid.nullable(), head_version: wireInteger(0, 2147483647), state: z.enum(["active", "expired", "cancelled", "replaced"]) }).strict();
export const nativeSlotSchema = z.object({ id: uuid, authorization_id: uuid, index: wireInteger(0, 1000), version: wireInteger(1, 2147483647), maximum_quantity: storedQuantity, dispensed_quantity: storedNonnegative, remaining_quantity: storedNonnegative, state: z.enum(["open", "closed"]), closure_kind: z.enum(["filled", "forfeited"]).nullable(), opened_by: uuid, opened_at: instant, closed_by: uuid.nullable(), closed_at: instant.nullable(), close_reason: nativeText(2000).nullable() }).strict();
const nativeProduct = z.object({ id: uuid, version: wireInteger(1, 2147483647), active: z.boolean(), kind: z.enum(["medication", "vaccine", "service"]), name: nativeText(200), unit: nativeText(50), unit_price_cents: cents }).strict();
// These are retained source-document projections, not proof that the omitted
// authorization/patient/alert rows were the historically selected DB rows.
const retainedText = z.string().refine(v => validUnicode(v) && !v.includes("\0") && v.length <= 1048576);
const signedArtifact = z.object({ schema_version: one, authorization_id: uuid, authorization_hash: digest, signed_at: instant, signature_name: nativeText(200),
  patient: z.object({ id: uuid, name: retainedText, species: retainedText }).strict(),
  household: z.object({ id: uuid, name: retainedText, address: retainedText.nullable() }).strict(),
  prescriber: z.object({ user_id: uuid, name: nativeText(200), license_number: nativeText(100), license_state: nativeText(100), practice_name: nativeText(200), practice_address: nativeText(1000), practice_phone: nativeText(100).nullable() }).strict(),
  medication: z.object({ name: nativeText(200), strength: nativeText(200), form: nativeText(100), directions: nativeText(4000), route: nativeText(100) }).strict(),
  quantity_per_fill: storedQuantity, unit: nativeText(50), refills_authorized: wireInteger(0, 1000), fulfillment_mode: z.enum(["practice_stock", "external_pharmacy"]), starts_on: date, expires_on: date }).strict();
const usage = z.object({ version: two, native_fill_accounting: z.literal("implemented"), dispensed_quantity: aggregate, used_fill_slots: wireInteger(0, 1001), remaining_quantity: aggregate.nullable(), forfeited_quantity: aggregate, unopened_fill_slots: wireInteger(0, 1001),
  allowance_basis: z.enum(["native_practice_stock", "external_unknown"]), open_slot: z.object({ id: uuid, index: wireInteger(0, 1000), version: wireInteger(1, 2147483647), remaining_quantity: storedNonnegative }).strict().nullable(),
  fulfillment_head: z.object({ event_id: uuid.nullable(), version: wireInteger(0, 2147483647) }).strict(), external_fulfillment: z.literal("unknown") }).strict();
const originalPickup = z.object({ id: uuid, document_hash: digest, picked_up_at: instant, recipient_name: nativeText(200), recipient_relationship: nativeText(200), actor_id: uuid }).strict();
const latestPickupAmendment = z.object({ event_id: uuid, version: sequence, value: nativePickupAmendmentSchema }).strict();
/** Retained source snapshots only; exact DB PK/history membership is backend-owned. */
export const nativeRefillRowSchema = z.object({ id: uuid, pet_id: uuid, client_id: uuid, version: wireInteger(1, 2147483647), state: z.enum(["open", "closed", "denied"]),
  medication_requested: nativeText(500), requester_note: nativeText(4000).nullable(), channel: z.enum(["phone", "email", "text", "in_person", "other"]), assigned_to: uuid.nullable(),
  authorization_id: uuid.nullable(), authorization_hash: digest.nullable(), created_by: uuid, created_at: instant, updated_by: uuid, updated_at: instant }).strict()
  .refine(v => (v.authorization_id === null) === (v.authorization_hash === null));
export const nativeRefillContextSchema = z.object({ refill: nativeRefillRowSchema, head_id: uuid.nullable() }).strict();
export const nativeFulfillmentRefillEventSchema = z.object({ version: two, id: uuid, refill_id: uuid, revision: wireInteger(2, 2147483647), action: z.enum(["dispense", "pickup"]),
  actor_id: uuid, reason: nativeText(2000), prior_event_id: uuid, before: nativeRefillRowSchema, after: nativeRefillRowSchema, link_context: z.null(), created_at: instant,
  fulfillment_reference: z.object({ kind: z.enum(["dispense", "pickup"]), id: uuid, dispense_id: uuid, authorization_id: uuid }).strict() }).strict();
const dispenseContext = z.object({ version: one, target: dispenseTarget, denver_date: date, authorization: authHead, signed_artifact: signedArtifact,
  patient: z.object({ id: uuid, version: wireInteger(1, 2147483647), client_id: uuid, archived_at: instant.nullable(), deceased_at: instant.nullable() }).strict(), household: z.object({ id: uuid, version: wireInteger(1, 2147483647) }).strict(), alerts: z.object({ snapshot: clinicalAlertSnapshotSchema, source_hash: digest }).strict(),
  slot: nativeSlotSchema.nullable(), previous_slot: nativeSlotSchema.nullable(), usage,
  invoice: z.object({ id: uuid, client_id: uuid, version: wireInteger(1, 2147483647), status: z.enum(["draft", "issued", "void"]), currency: rawText(1, 3), existing_items_hash: digest, existing_items_total_cents: cents }).strict(), product: nativeProduct,
  lots: z.array(z.object({ id: uuid, product_id: uuid, lot_number: nativeText(200), expires_on: date, location: nativeText(200), balance: storedNonnegative, quantity: storedQuantity }).strict()).min(1).max(100).refine(v => sorted(v, x => x.id)), refill: nativeRefillContextSchema.nullable(), charge: z.object({ quantity: storedQuantity, unit_price_cents: cents, amount_cents: cents, projected_invoice_total_cents: cents }).strict() }).strict();
const completeDispenseDoc = dispenseDoc.extend({ reviewed_context: dispenseContext }).strict();
const pickupContext = z.object({ version: one, authorization: authHead, dispense: completeDispenseDoc, existing_pickup_id: uuid.nullable(), refill: nativeRefillContextSchema.nullable() }).strict();
const completePickupDoc = pickupDoc.extend({ reviewed_context: pickupContext }).strict();
export const nativeDocumentSchemas = { dispense: completeDispenseDoc, pickup: completePickupDoc, return_v1: returnDocV1, return_v2: returnDocV2, correction: correctionDoc, discrepancy: discrepancyDoc, return_policy: returnPolicy } as const;
export const nativeFulfillmentReceiptSchema = z.discriminatedUnion("operation", [
  z.object({ version: one, id: uuid, actor_id: uuid, operation: z.literal("dispense"), request: dispenseRequest, request_hash: digest,
    result: z.object({ dispense: completeDispenseDoc, slot: nativeSlotSchema, refill_event: nativeFulfillmentRefillEventSchema.nullable() }).strict(), created_at: instant }).strict(),
  z.object({ version: one, id: uuid, actor_id: uuid, operation: z.literal("pickup"), request: pickupRequest, request_hash: digest, result: completePickupDoc, created_at: instant }).strict(),
]);
export const nativeOpeningEntrySchema = z.object({ version: one, dispense_id: uuid, dispense_document_hash: digest, dispense_operation_hash: digest,
  return_head: nativeHeadSchema, correction_head: nativeHeadSchema, discrepancy_head: nativeHeadSchema,
  pickup: z.object({ id: uuid, document_hash: digest, operation_hash: digest }).strict().nullable(),
  allocations: z.array(z.object({ allocation_id: uuid, lot_id: uuid, dispensed_quantity: storedQuantity, prepared_quantity: storedNonnegative,
    held: z.array(z.object({ intake_id: uuid, quantity: storedNonnegative }).strict()) }).strict()).min(1).max(100).refine(v => sorted(v, a => a.allocation_id)) }).strict()
  .refine(v => { try { return [v.return_head, v.correction_head, v.discrepancy_head].every(h => nativeInteger(h.version, 0n, 1000n) <= 1000n); } catch { return false; } });
const correctionContext = z.object({ version: one, target, authorization_hash: digest, dispense_document_hash: digest, dispense_artifact_hash: digest, dispensed_at: instant, original_pickup: originalPickup.nullable(), head: nativeHeadSchema, latest_pickup_amendment: latestPickupAmendment.nullable() }).strict();
const balanceQuantities = { dispensed_quantity: storedQuantity, returned_quantity: storedNonnegative, remaining_returnable_quantity: storedNonnegative, held_quantity: storedNonnegative, disposed_quantity: storedNonnegative, restocked_quantity: storedNonnegative };
const balance = z.object({ allocation_id: uuid, lot_id: uuid, ...balanceQuantities }).strict();
const intakeAllocation = z.object({ allocation_id: uuid, lot_id: uuid, quantity: storedNonnegative, held_quantity: storedNonnegative, disposed_quantity: storedNonnegative, restocked_quantity: storedNonnegative }).strict();
const intake = z.object({ id: uuid, sequence, custody, package_condition: condition, storage_history: storage, allocations: z.array(intakeAllocation).min(1).max(100) }).strict();
const replay = z.object({ allocations: z.array(balance).min(1).max(100),
  intakes: z.array(z.object({ id: uuid, allocations: z.array(intakeAllocation).min(1).max(100) }).strict()),
  correction_remaining: z.array(z.object({ event_id: uuid, allocations: z.array(z.object({ allocation_id: uuid, quantity: storedNonnegative }).strict()).min(1).max(100) }).strict()),
  historical: z.array(z.object({ allocation_id: uuid, lot_id: uuid, gross_intake_quantity: aggregate, gross_disposed_quantity: aggregate, gross_restocked_quantity: aggregate, retracted_intake_quantity: aggregate, retracted_disposed_quantity: aggregate, retracted_restocked_quantity: aggregate }).strict()).min(1).max(100) }).strict();
const discrepancies = z.object({ version: one, head: nativeHeadSchema, open_case_count: semanticInteger(0n, 2147483647n), held_lot_ids: z.array(uuid),
  cases: z.array(z.object({ id: uuid, source, allocations: discrepancyDoc.shape.allocations, status: z.enum(["open", "resolved_corrected", "resolved_confirmed_original"]), report: discrepancyDoc, decisions: z.array(discrepancyDoc) }).strict()) }).strict();
const stockReview = z.object({ practice_date: date, product: z.object({ id: uuid, version: wireInteger(1, 2147483647), active: z.boolean(), name: nativeText(200), unit: nativeText(50) }).strict(), lots: z.array(z.object({ lot_id: uuid, balance: storedNonnegative }).strict()).min(1).max(100) }).strict();
const returnContextBase = { version: one, target, authorization_hash: digest, dispense_document_hash: digest, dispensed_at: instant, head: nativeHeadSchema, original_pickup: originalPickup.nullable(), correction_head: nativeHeadSchema,
  allocations: z.array(balance.extend({ lot_number: nativeText(200), expires_on: date }).strict()).min(1).max(100), intake: intake.nullable(), policy: returnPolicy.nullable(), stock_review: stockReview.nullable(), intent: nativeReturnIntentV1 };
const returnContextV1 = z.object(returnContextBase).strict();
const returnContextV2 = z.object({ ...returnContextBase, version: two, intent: nativeReturnIntentV2, discrepancy_head: nativeHeadSchema, replay, discrepancies }).strict();
const discrepancyContext = z.object({ version: one, target, return_head: nativeHeadSchema, discrepancy_head: nativeHeadSchema, source: z.union([returnDocV1, returnDocV2]), replay, discrepancies, intent: discrepancyIntent }).strict();
export const nativeContextSchemas = { dispense: dispenseContext, pickup: pickupContext, return_v1: returnContextV1, return_v2: returnContextV2, correction: correctionContext, discrepancy: discrepancyContext } as const;
const status = z.enum(["onsite", "handed_off", "disposed"]);
const after = z.object({ status, location_id: uuid.nullable(), custodian_id: uuid.nullable() }).strict().refine(v => v.status === "onsite" ? v.location_id !== null : v.location_id === null && v.custodian_id === null);
const create = z.object({ kind: z.enum(["stock", "prepared"]), label: nativeText(200, false), stock_lot_id: uuid.nullable(), site_id: uuid, location_id: uuid, custodian_id: uuid.nullable() }).strict();
export const nativeLineSchema = z.object({ lot_id: uuid, channel: z.enum(["available", "prepared", "return_held"]), dispense_id: uuid.nullable(), intake_id: uuid.nullable(), quantity_delta: signedQuantity }).strict();
const container = z.object({ id: uuid, expected_version: wireInteger(0, 2147483647).nullable(), create: create.nullable(), after, lines: z.array(nativeLineSchema).max(100) }).strict();
export const nativeC0ContextSchema = z.object({ version: one, product_id: uuid, policy_version_id: uuid, state_head_id: uuid, opening_id: uuid,
  basis: z.object({ kind: z.enum(["physical_record", "correction_assertion", "annotation", "discrepancy_assertion"]), observed_at: instant.nullable(), note: nativeText(4000) }).strict(),
  containers: z.array(container).max(32).refine(v => sorted(v, x => x.id)) }).strict();
const frame = z.object({ id: uuid, container: sourceRow("public.controlled_stock_containers").nullable(), head: z.object({ container_id: uuid, version: z.instanceof(ExactJsonNumber), location_id: uuid.nullable(), custodian_id: uuid.nullable(), status, last_event_id: uuid.nullable() }).strict().nullable(),
  cells: z.array(z.object({ cell: sourceRow("public.controlled_stock_cells"), position: z.object({ cell_id: uuid, quantity: z.instanceof(ExactJsonNumber) }).strict() }).strict()).max(512) }).strict();
const catalog = z.object({ id: uuid, name: rawText(1, 200), kind: z.enum(["medication", "vaccine", "service"]), manufacturer: rawText(0, 200), unit: rawText(1, 50), unit_price_cents: semanticInteger(0n, 100000000n), active: z.boolean(), version: wireInteger(1, 2147483647), created_by: uuid, created_at: instant }).strict();
export const nativeFrozenSchema = z.object({ catalog, containers: z.array(frame).max(32), lots: z.array(z.object({ id: uuid, lot: sourceRow("public.inventory_lots").nullable(), available: aggregate, native_hold: z.boolean() }).strict()).max(100), native: domainObject,
  expected_effects: z.array(nativeLineSchema).max(200), permission: z.object({ enabled: z.literal(true), roles: z.array(z.enum(["ADMIN", "DVM", "STAFF"])).min(1).max(3), basis: z.enum(["physical_record", "correction_assertion", "annotation", "discrepancy_assertion"]), witness: z.enum(["none", "c2_required"]), secondary_review: z.boolean(), location_kinds: z.array(z.enum(["clinic", "mobile_kit"])).min(1).max(2) }).strict() }).strict();
