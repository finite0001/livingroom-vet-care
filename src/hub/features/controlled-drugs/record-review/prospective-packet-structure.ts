import { z } from "zod";
import { ExactJsonNumber, protocolInteger, type ExactJson } from "./exact-json.ts";
import { reviewDigestSchema, reviewUuidSchema, type RecordReviewRequest } from "./request.ts";
import { reviewMeaning, reviewProtocolInstantSchema, reviewTargetSchema, type PreparedReviewPacket } from "./prepared-packet.ts";
import { prospectiveSourceShapes } from "./prospective-source-shapes.ts";
import { reviewInstantMicroseconds, reviewQuantityThousandths } from "./exact-values.ts";
import { sameReviewJsonb as equal } from "./jsonb-equality.ts";

/** Structural checks against the explicitly prospective backend DTO. This is
 * NOT ReviewEvidenceAdmission and must never be wired as its complete validator.
 * Source hashes, immutable backend validators, adapter direct membership, policy
 * applicability, historical selection and actual Auth still need admission.
 */
const integer = (min: bigint, max: bigint) => z.instanceof(ExactJsonNumber).refine(value => {
  const token = String(value);
  return /^(0|-?[1-9][0-9]*)$/.test(token) && token.length <= 20 && BigInt(token) >= min && BigInt(token) <= max;
});
const one = z.instanceof(ExactJsonNumber).refine(value => { try { return protocolInteger(value, 1, 1) === 1; } catch { return false; } });
// Raw retained source timestamps keep their original offset/precision. Derived
// historical DTOs use exact UTC6-Z, including anchors before v3's config window.
const sourceInstant = z.string().datetime({ offset: true }).refine(value => {
  try { reviewInstantMicroseconds(value); return true; } catch { return false; }
});
const historicalInstant = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/)
  .refine(value => {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 23) === value.slice(0, 23);
  });
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const d = new Date(value + "T00:00:00Z"); return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
});
const roles = z.array(z.enum(["ADMIN", "DVM", "STAFF", "TECH"])).min(1).max(4).refine(v => v.every((r, i) => !i || v[i - 1] < r));
const rule = z.object({ enabled: z.boolean(), adapter_version: one, meaning: z.literal(reviewMeaning), quorum: one,
  deadline_mode: z.enum(["next_staffed_day_close", "not_configured"]), deadline_anchor: z.enum(["observed_at", "recorded_at"]),
  escalation_mode: z.enum(["overdue", "not_configured", "immediate_on_record"]),
}).strict();
const member = z.object({ actor_id: reviewUuidSchema, roles }).strict();
const routing = z.object({ version: one, id: reviewUuidSchema, record_hash: reviewDigestSchema, enabled: z.boolean(),
  members: z.array(member).max(100).refine(values => values.every((v, i) => !i || values[i - 1].actor_id < v.actor_id)),
}).strict();
const unavailableReason = z.enum(["kind_not_configured", "other_native_kind_selected", "no_policy_at_anchor", "policy_disabled_at_anchor",
  "missing_managed_dispense_family", "family_site_unproven", "anchor_outside_calendar_range", "anchor_outside_coverage", "no_later_staffed_day_in_coverage", "site_unproven"]);
const historical = z.object({ version: one, selection_anchor: historicalInstant, anchor_basis: z.enum(["observed_at", "recorded_at"]),
  policy_id: reviewUuidSchema.nullable(), policy_hash: reviewDigestSchema.nullable(), rule: rule.nullable(), family_binding_hash: reviewDigestSchema.nullable(),
  calendar_id: reviewUuidSchema.nullable(), calendar_hash: reviewDigestSchema.nullable(), anchor_local_date: date.nullable(), selected_staffed_date: date.nullable(),
  due_at: reviewProtocolInstantSchema.nullable(), deadline_basis: z.enum(["configured", "not_configured", "not_assigned", "historical_policy_unavailable", "calendar_unavailable"]),
  unavailable_reason: unavailableReason.nullable(), routing_id: reviewUuidSchema.nullable(), routing_hash: reviewDigestSchema.nullable(), routing_snapshot: routing.nullable(),
}).strict().superRefine((value, ctx) => {
  const pairs = [[value.policy_id, value.policy_hash], [value.calendar_id, value.calendar_hash], [value.routing_id, value.routing_hash]];
  if (pairs.some(([id, hash]) => (id === null) !== (hash === null)) ||
    (value.policy_id === null) !== (value.rule === null) || (value.routing_id === null) !== (value.routing_snapshot === null) ||
    (value.deadline_basis === "configured") !== (value.due_at !== null) || (value.due_at === null) !== (value.unavailable_reason !== null) ||
    (value.routing_snapshot && (value.routing_snapshot.id !== value.routing_id || value.routing_snapshot.record_hash !== value.routing_hash)))
    ctx.addIssue({ code: "custom", message: "Historical projection differs" });
});
const obligation = z.object({ event_id: reviewUuidSchema, product_id: reviewUuidSchema,
  event_sequence: z.string().regex(/^[1-9][0-9]*$/).max(19).refine(v => BigInt(v) <= 9223372036854775807n), meaning: z.literal(reviewMeaning),
  target: reviewTargetSchema, target_hash: reviewDigestSchema, adapter: z.unknown(), historical, binding_hash: reviewDigestSchema,
  site_id: reviewUuidSchema.nullable(), due_at: reviewProtocolInstantSchema.nullable(), family_dispense_id: reviewUuidSchema.nullable(),
}).strict();
const sourceRoles = new Set(["reviewed_target", "correction_target", "case_report", "ordinary_source", "original_intake", "original_pickup",
  "amendment_predecessor", "original_dispense", "resolution_correction", "opening_basis", "retained_context"]);
const sourceTypes = {
  uuid: reviewUuidSchema, text: z.string(), boolean: z.boolean(), integer: integer(-2147483648n, 2147483647n),
  bigint: integer(-9223372036854775808n, 9223372036854775807n), "numeric(14,3)": z.instanceof(ExactJsonNumber).refine(value => {
    try { reviewQuantityThousandths(value); return true; } catch { return false; }
  }),
  "timestamp with time zone": sourceInstant, date, jsonb: z.unknown(),
};
function invalid(): never { throw new Error("Prospective packet structure differs from its declared DTO"); }
function object(value: unknown): Record<string, ExactJson> {
  if (!value || typeof value !== "object" || Array.isArray(value) || value instanceof ExactJsonNumber) invalid();
  return value as Record<string, ExactJson>;
}
function keys(value: Record<string, unknown>, expected: readonly string[]) {
  if (Object.keys(value).length !== expected.length || expected.some(k => !Object.prototype.hasOwnProperty.call(value, k))) invalid();
}
function shapeFor(relation: string) {
  if (!Object.prototype.hasOwnProperty.call(prospectiveSourceShapes, relation)) invalid();
  return prospectiveSourceShapes[relation as keyof typeof prospectiveSourceShapes];
}
function sourceRow(relation: string, value: unknown) {
  const shape = shapeFor(relation), row = object(value); keys(row, shape.columns.map(c => c[0]));
  for (const [name, type, required] of shape.columns) {
    if (row[name] === null ? required : !sourceTypes[type].safeParse(row[name]).success) invalid();
  }
  return row;
}
/** Row shape only, for frozen historical row snapshots as well as references.
 * This does not establish source semantics, membership or complete admission. */
export function verifyProspectiveSourceRowStructure(relation: string, value: unknown): void {
  sourceRow(relation, value);
}
// Every declared PK is UUID-only. jsonb key text orders object keys by UTF-8
// length then bytes; these declared ASCII names make that ordering explicit.
function sourceKey(relation: string, input: unknown): string {
  const key = object(input), shape = shapeFor(relation); keys(key, shape.key);
  for (const field of shape.key) if (!reviewUuidSchema.safeParse(key[field]).success) invalid();
  return "{" + [...shape.key].sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0))
    .map(field => `${JSON.stringify(field)}: ${JSON.stringify(key[field])}`).join(", ") + "}";
}

/** Additional finite syntactic controls. Does not hash/rewrite the packet and
 * cannot, on its own, establish a complete source-specific admission. */
export function verifyProspectivePacketStructure(packet: PreparedReviewPacket, request: Readonly<RecordReviewRequest>): void {
  const policy = rule.safeParse(packet.current_authorization.policy.rule), ob = obligation.safeParse(packet.obligation);
  if (!policy.success || !policy.data.enabled || !ob.success) invalid();
  // Frozen A2 pickup provenance uses the event's own transitions. An opening
  // package may prove that site while its original dispense has no managed
  // canonical event, so no family row/binding may be invented for that UUID.
  const missingManagedFamily = packet.adapter.event_kind === "record_native_pickup" &&
    packet.adapter.adapter_id === "pickup_v1" && packet.adapter.provenance_state === "supported" &&
    packet.adapter.site_basis === "event_transitions" && packet.adapter.native_family_dispense_id !== null &&
    ob.data.family_dispense_id === null && ob.data.historical.family_binding_hash === null &&
    ob.data.historical.unavailable_reason === "missing_managed_dispense_family";
  if (ob.data.historical.unavailable_reason === "missing_managed_dispense_family" && !missingManagedFamily) invalid();
  const event = sourceRow("public.controlled_stock_events", packet.event), preparation = sourceRow("public.controlled_stock_preparations", packet.parent_preparation);
  const target = packet.target, required = { id: target.event_id, product_id: target.product_id, sequence: target.sequence,
    record_hash: target.record_hash, actor_id: target.original_actor_id, policy_version_id: target.policy_version_id,
    opening_id: target.opening_id, engine_revision: target.engine_revision };
  if (Object.entries(required).some(([key, value]) => !equal(event[key], value)) || preparation.id !== target.event_id ||
    preparation.actor_id !== target.original_actor_id || preparation.product_id !== target.product_id ||
    event.event_kind !== packet.adapter.event_kind || !equal(event.canonical_result, packet.original_result) ||
    !equal(event.clinical_snapshot, packet.clinical_snapshot) || ob.data.event_id !== request.event_id ||
    ob.data.product_id !== target.product_id || ob.data.event_sequence !== String(target.sequence) ||
    !equal(ob.data.target, target) || !equal(packet.obligation.adapter, packet.adapter) || ob.data.site_id !== packet.adapter.site_id ||
    ob.data.due_at !== ob.data.historical.due_at ||
    (ob.data.family_dispense_id !== packet.adapter.native_family_dispense_id && !missingManagedFamily)) invalid();
  if (packet.source_rows.length !== packet.adapter.source_refs.length) invalid();
  let previous = "";
  for (let i = 0; i < packet.source_rows.length; i++) {
    const source = packet.source_rows[i], ref = packet.adapter.source_refs[i], row = sourceRow(source.relation, source.row);
    const key = sourceKey(source.relation, source.key), order = source.relation + "\n" + key;
    if (order <= previous || ref.relation !== source.relation || sourceKey(ref.relation, ref.key) !== key || !sourceRoles.has(ref.role) ||
      shapeFor(source.relation).key.some(field => !equal(source.key[field], row[field]))) invalid();
    previous = order;
  }
  const dedicated = { event_lines: "public.controlled_stock_event_lines", cells: "public.controlled_stock_cells",
    transitions: "public.controlled_stock_container_transitions", containers: "public.controlled_stock_containers" };
  for (const [field, relation] of Object.entries(dedicated)) {
    const expected = packet.source_rows.filter(row => row.relation === relation).map(row => row.row);
    if (!equal(packet[field], expected)) invalid();
  }
}
