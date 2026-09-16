/** Strict native dispensing adapter with exact request recovery and versioned history. */
import { z } from "zod";
import {
  nativePrescriptionArtifactSchema,
  parsePrescriptionAuthorization,
  prescriptionAlertSchema,
  prescriptionUsageV2Schema,
  validatePrescriptionUsage,
} from "./prescription-api.ts";
import type {
  PrescriptionAuthorization,
  PrescriptionRpc,
} from "./prescription-api.ts";
import {
  nativeRefillSchema,
  nativeRefillFulfillmentEventSchema,
  parseNativeRefillEvent,
} from "../refills/refill-api.ts";
import type { PrescriptionOperation } from "./prescription-state.ts";
const uuid = z.string().uuid(),
  hash = z.string().regex(/^[a-f0-9]{64}$/),
  revision = z.number().int().min(1).max(2147483647),
  index = z.number().int().min(0).max(1000);
const instant = z
  .string()
  .datetime({ offset: true })
  .refine((v) => Number.isFinite(Date.parse(v)) && !/\.\d{7}/.test(v));
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      Number.isFinite(Date.parse(v + "T00:00:00Z")) &&
      new Date(v + "T00:00:00Z").toISOString().slice(0, 10) === v,
  );
const text = (max: number) =>
  z
    .string()
    .min(1)
    .refine(
      (v) =>
        v === v.trim() &&
        Array.from(v).length <= max &&
        !Array.from(v).some((c) => {
          const n = c.charCodeAt(0);
          return (n < 32 && n !== 9 && n !== 10) || n === 127;
        }),
    );
const inputQuantity = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,10})(?:\.\d{1,3})?$/)
  .refine((v) => /[1-9]/.test(v));
const balance = z.string().regex(/^(?:0|[1-9]\d{0,10})\.\d{3}$/),
  positive = balance.refine((v) => milli(v) > 0n);
export const fulfillmentMoneySchema = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,18})$/)
  .refine((v) => BigInt(v) <= 9223372036854775807n);
const price = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,8})$/)
  .refine((v) => BigInt(v) <= 100000000n);
function milli(v: string): bigint {
  const [whole, decimal = ""] = v.split(".");
  return BigInt(whole) * 1000n + BigInt(decimal.padEnd(3, "0"));
}
function normalized(v: string) {
  const [whole, decimal = ""] = v.split(".");
  return `${whole}.${decimal.padEnd(3, "0")}`;
}
export function fulfillmentChargeCents(
  quantity: string,
  unitPrice: string,
): string {
  inputQuantity.parse(quantity);
  price.parse(unitPrice);
  const amount = (
    (milli(quantity) * BigInt(unitPrice) + 500n) /
    1000n
  ).toString();
  fulfillmentMoneySchema.parse(amount);
  return amount;
}
function canonical(v: unknown): string {
  return JSON.stringify(
    v && typeof v === "object"
      ? Array.isArray(v)
        ? v.map((x) => JSON.parse(canonical(x)))
        : Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, x]) => [k, JSON.parse(canonical(x))]),
          )
      : v,
  );
}
function same(a: unknown, b: unknown) {
  return canonical(a) === canonical(b);
}
const refillTarget = z
  .object({ id: uuid, expected_version: revision })
  .strict();
const allocation = z.object({ lot_id: uuid, quantity: inputQuantity }).strict();
const targetObject = z
  .object({
    authorization_id: uuid,
    pet_id: uuid,
    slot_index: index,
    expected_slot_version: revision.nullable(),
    invoice_id: uuid,
    quantity: inputQuantity,
    allocations: z.array(allocation).min(1).max(100),
    refill: refillTarget.nullable(),
  })
  .strict();
function targetAmounts(v: z.infer<typeof targetObject>) {
  return (
    v.allocations.every(
      (a, i) => i === 0 || a.lot_id > v.allocations[i - 1].lot_id,
    ) &&
    v.allocations.reduce((sum, a) => sum + milli(a.quantity), 0n) ===
      milli(v.quantity)
  );
}
export const dispenseTargetSchema = targetObject.refine(
  targetAmounts,
  "Sorted unique allocations must sum exactly to quantity",
);
export const dispenseRequestSchema = targetObject
  .extend({
    expected_context_hash: hash,
    reason: text(2000),
    attest_alert_review: z.literal(true),
    attest_dispense_review: z.literal(true),
  })
  .strict()
  .refine(targetAmounts);
export const closeSlotRequestSchema = z
  .object({
    authorization_id: uuid,
    pet_id: uuid,
    slot_index: index,
    expected_slot_version: revision,
    expected_context_hash: hash,
    reason: text(2000),
    attest_forfeit: z.literal(true),
  })
  .strict();
const refillClose = z
  .object({ id: uuid, expected_version: revision, reason: text(2000) })
  .strict();
export const pickupRequestSchema = z
  .object({
    authorization_id: uuid,
    pet_id: uuid,
    dispense_id: uuid,
    expected_context_hash: hash,
    recipient_name: text(200),
    recipient_relationship: text(200),
    reason: text(2000),
    attest_handoff: z.literal(true),
    refill_close: refillClose.nullable(),
  })
  .strict();
export const fillSlotSchema = z
  .object({
    id: uuid,
    authorization_id: uuid,
    index,
    version: revision,
    maximum_quantity: positive,
    dispensed_quantity: positive,
    remaining_quantity: balance,
    state: z.enum(["open", "closed"]),
    closure_kind: z.enum(["filled", "forfeited"]).nullable(),
    opened_by: uuid,
    opened_at: instant,
    closed_by: uuid.nullable(),
    closed_at: instant.nullable(),
    close_reason: text(2000).nullable(),
  })
  .strict()
  .refine((v) => {
    if (milli(v.dispensed_quantity) > milli(v.maximum_quantity)) return false;
    if (v.state === "open")
      return (
        v.closure_kind === null &&
        v.closed_by === null &&
        v.closed_at === null &&
        v.close_reason === null &&
        milli(v.remaining_quantity) > 0n &&
        milli(v.remaining_quantity) ===
          milli(v.maximum_quantity) - milli(v.dispensed_quantity)
      );
    return (
      v.closed_by !== null &&
      v.closed_at !== null &&
      milli(v.remaining_quantity) === 0n &&
      (v.closure_kind === "filled"
        ? v.dispensed_quantity === v.maximum_quantity
        : v.closure_kind === "forfeited" &&
          milli(v.dispensed_quantity) < milli(v.maximum_quantity) &&
          v.close_reason !== null)
    );
  });
const headSchema = z
  .object({
    id: uuid,
    hash,
    head_id: uuid.nullable(),
    head_version: z.number().int().min(0).max(2147483647),
    state: z.enum(["active", "expired", "cancelled", "replaced"]),
  })
  .strict()
  .refine(
    (v) =>
      (v.head_id === null) === (v.head_version === 0) &&
      ["active", "expired"].includes(v.state) === (v.head_id === null),
  );
const linkedRefill = z
  .object({ refill: nativeRefillSchema, head_id: uuid })
  .strict();
const dispenseContextSchema = z
  .object({
    version: z.literal(1),
    target: dispenseTargetSchema,
    denver_date: day,
    authorization: headSchema,
    signed_artifact: nativePrescriptionArtifactSchema,
    patient: z
      .object({
        id: uuid,
        version: revision,
        client_id: uuid,
        archived_at: instant.nullable(),
        deceased_at: day.nullable(),
      })
      .strict(),
    household: z.object({ id: uuid, version: revision }).strict(),
    alerts: prescriptionAlertSchema,
    slot: fillSlotSchema.nullable(),
    previous_slot: fillSlotSchema.nullable(),
    usage: prescriptionUsageV2Schema,
    invoice: z
      .object({
        id: uuid,
        client_id: uuid,
        version: revision,
        status: z.literal("draft"),
        currency: z.literal("usd"),
        existing_items_hash: hash,
        existing_items_total_cents: fulfillmentMoneySchema,
      })
      .strict(),
    product: z
      .object({
        id: uuid,
        version: revision,
        active: z.literal(true),
        kind: z.literal("medication"),
        name: text(200),
        unit: text(50),
        unit_price_cents: price,
      })
      .strict(),
    lots: z
      .array(
        z
          .object({
            id: uuid,
            product_id: uuid,
            lot_number: text(200),
            expires_on: day,
            location: text(200),
            balance,
            quantity: positive,
          })
          .strict(),
      )
      .min(1)
      .max(100),
    refill: linkedRefill.nullable(),
    charge: z
      .object({
        quantity: positive,
        unit_price_cents: price,
        amount_cents: fulfillmentMoneySchema,
        projected_invoice_total_cents: fulfillmentMoneySchema,
      })
      .strict(),
  })
  .strict();
const dispenseArtifactSchema = z
  .object({
    id: uuid,
    authorization_id: uuid,
    authorization_hash: hash,
    fill_index: index,
    quantity: positive,
    unit: text(50),
    dispensed_at: instant,
    recorded_by: z.object({ user_id: uuid, name: text(200) }).strict(),
    invoice_id: uuid,
    lots: z
      .array(
        z
          .object({
            id: uuid,
            number: text(200),
            expires_on: day,
            quantity: positive,
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
const dispenseSchema = z
  .object({
    version: z.literal(1),
    id: uuid,
    authorization_id: uuid,
    authorization_hash: hash,
    pet_id: uuid,
    client_id: uuid,
    slot_id: uuid,
    slot_index: index,
    slot_version_before: revision.nullable(),
    slot_version_after: revision,
    actor_id: uuid,
    quantity: positive,
    unit: text(50),
    reason: text(2000),
    dispensed_at: instant,
    reviewed_context: dispenseContextSchema,
    reviewed_context_hash: hash,
    allocations: z
      .array(
        z
          .object({ lot_id: uuid, quantity: positive, movement_id: uuid })
          .strict(),
      )
      .min(1)
      .max(100),
    invoice_id: uuid,
    invoice_item_id: uuid,
    invoice_version_before: revision,
    invoice_version_after: revision,
    amount_cents: fulfillmentMoneySchema,
    refill_id: uuid.nullable(),
    refill_event_id: uuid.nullable(),
    artifact: dispenseArtifactSchema,
    artifact_hash: hash,
  })
  .strict();
const closeContextSchema = z
  .object({
    version: z.literal(1),
    authorization: headSchema,
    slot: fillSlotSchema,
    usage: prescriptionUsageV2Schema,
  })
  .strict();
const closureSchema = z
  .object({
    version: z.literal(1),
    id: uuid,
    authorization_id: uuid,
    pet_id: uuid,
    slot_id: uuid,
    actor_id: uuid,
    reason: text(2000),
    forfeited_quantity: positive,
    before: fillSlotSchema,
    after: fillSlotSchema,
    reviewed_context: closeContextSchema,
    reviewed_context_hash: hash,
    created_at: instant,
  })
  .strict();
const pickupContextSchema = z
  .object({
    version: z.literal(1),
    authorization: headSchema,
    dispense: dispenseSchema,
    existing_pickup_id: uuid.nullable(),
    refill: linkedRefill.nullable(),
  })
  .strict();
const pickupSchema = z
  .object({
    version: z.literal(1),
    id: uuid,
    authorization_id: uuid,
    pet_id: uuid,
    dispense_id: uuid,
    actor_id: uuid,
    recipient_name: text(200),
    recipient_relationship: text(200),
    reason: text(2000),
    reviewed_context: pickupContextSchema,
    reviewed_context_hash: hash,
    refill_id: uuid.nullable(),
    refill_event_id: uuid.nullable(),
    picked_up_at: instant,
  })
  .strict();
const receiptCommon = {
  version: z.literal(1),
  id: uuid,
  actor_id: uuid,
  request_hash: hash,
  created_at: instant,
};
const receiptSchema = z.discriminatedUnion("operation", [
  z
    .object({
      ...receiptCommon,
      operation: z.literal("dispense"),
      request: dispenseRequestSchema,
      result: z
        .object({
          dispense: dispenseSchema,
          slot: fillSlotSchema,
          refill_event: nativeRefillFulfillmentEventSchema.nullable(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...receiptCommon,
      operation: z.literal("close_slot"),
      request: closeSlotRequestSchema,
      result: closureSchema,
    })
    .strict(),
  z
    .object({
      ...receiptCommon,
      operation: z.literal("pickup"),
      request: pickupRequestSchema,
      result: pickupSchema,
    })
    .strict(),
]);
const cursorSchema = z.object({ before_at: instant, before_id: uuid }).strict();
export interface DispenseTarget extends z.infer<typeof dispenseTargetSchema> {}
export interface NativeFillSlot extends z.infer<typeof fillSlotSchema> {}
export interface NativeDispense extends z.infer<typeof dispenseSchema> {}
export interface NativeSlotClosure extends z.infer<typeof closureSchema> {}
export interface NativePickup extends z.infer<typeof pickupSchema> {}
export interface FulfillmentCursor extends z.infer<typeof cursorSchema> {}
export type FulfillmentReceipt = z.infer<typeof receiptSchema>;
const checkUsage = validatePrescriptionUsage;
function checkHead(
  head: z.infer<typeof headSchema>,
  prior: PrescriptionAuthorization,
) {
  if (head.id !== prior.id || head.hash !== prior.authorization_hash)
    throw new Error("Authorization head differs");
}
function checkSlot(slot: NativeFillSlot, prior: PrescriptionAuthorization) {
  if (
    slot.authorization_id !== prior.id ||
    slot.index > prior.artifact.refills_authorized ||
    slot.maximum_quantity !== normalized(prior.artifact.quantity_per_fill)
  )
    throw new Error("Fill slot differs from signed allowance");
}
function checkRefill(
  refill: z.infer<typeof linkedRefill>,
  prior: PrescriptionAuthorization,
) {
  const r = refill.refill;
  if (
    r.pet_id !== prior.pet_id ||
    r.client_id !== prior.client_id ||
    r.authorization_id !== prior.id ||
    r.authorization_hash !== prior.authorization_hash ||
    r.state !== "open"
  )
    throw new Error("Linked refill no longer matches");
}
function checkContext(
  c: z.infer<typeof dispenseContextSchema>,
  prior: PrescriptionAuthorization,
) {
  const t = c.target,
    a = prior.artifact;
  checkHead(c.authorization, prior);
  checkUsage(c.usage, prior);
  if (
    a.fulfillment_mode !== "practice_stock" ||
    c.authorization.state !== "active" ||
    t.authorization_id !== prior.id ||
    t.pet_id !== prior.pet_id ||
    !same(c.signed_artifact, a) ||
    c.denver_date < a.starts_on ||
    c.denver_date > a.expires_on ||
    c.patient.id !== prior.pet_id ||
    c.patient.client_id !== prior.client_id ||
    c.patient.archived_at !== null ||
    c.patient.deceased_at !== null ||
    c.household.id !== prior.client_id ||
    c.alerts.snapshot.pet_id !== prior.pet_id ||
    c.alerts.snapshot.patient_version !== c.patient.version ||
    c.invoice.id !== t.invoice_id ||
    c.invoice.client_id !== prior.client_id ||
    c.product.id !== prior.context.draft.fields.product_id ||
    c.product.unit !== a.unit ||
    t.slot_index > a.refills_authorized
  )
    throw new Error("Dispense clinical context differs");
  if (c.slot) {
    checkSlot(c.slot, prior);
    if (
      c.slot.state !== "open" ||
      c.slot.index !== t.slot_index ||
      c.slot.version !== t.expected_slot_version ||
      c.previous_slot !== null ||
      !same(c.usage.open_slot, {
        id: c.slot.id,
        index: c.slot.index,
        version: c.slot.version,
        remaining_quantity: c.slot.remaining_quantity,
      }) ||
      milli(t.quantity) > milli(c.slot.remaining_quantity)
    )
      throw new Error("Open slot context differs");
  } else {
    if (
      t.expected_slot_version !== null ||
      c.usage.open_slot !== null ||
      c.usage.used_fill_slots !== t.slot_index ||
      milli(t.quantity) > milli(a.quantity_per_fill)
    )
      throw new Error("New slot context differs");
    if (t.slot_index === 0) {
      if (c.previous_slot !== null)
        throw new Error("Initial slot has no predecessor");
    } else {
      if (!c.previous_slot) throw new Error("Previous slot required");
      checkSlot(c.previous_slot, prior);
      if (
        c.previous_slot.index !== t.slot_index - 1 ||
        c.previous_slot.state !== "closed"
      )
        throw new Error("Previous slot is not closed");
    }
  }
  if (
    c.lots.length !== t.allocations.length ||
    c.lots.some(
      (lot, i) =>
        lot.id !== t.allocations[i].lot_id ||
        lot.product_id !== c.product.id ||
        lot.quantity !== normalized(t.allocations[i].quantity) ||
        milli(lot.quantity) > milli(lot.balance) ||
        lot.expires_on < c.denver_date,
    )
  )
    throw new Error("Reviewed lot allocation differs");
  if ((c.refill === null) !== (t.refill === null))
    throw new Error("Optional refill differs");
  if (c.refill && t.refill) {
    checkRefill(c.refill, prior);
    if (
      c.refill.refill.id !== t.refill.id ||
      c.refill.refill.version !== t.refill.expected_version
    )
      throw new Error("Refill revision differs");
  }
  const amount = fulfillmentChargeCents(t.quantity, c.product.unit_price_cents),
    total = (
      BigInt(c.invoice.existing_items_total_cents) + BigInt(amount)
    ).toString();
  fulfillmentMoneySchema.parse(total);
  if (
    c.charge.quantity !== normalized(t.quantity) ||
    c.charge.unit_price_cents !== c.product.unit_price_cents ||
    c.charge.amount_cents !== amount ||
    c.charge.projected_invoice_total_cents !== total
  )
    throw new Error("Reviewed monetary amounts differ");
}
const denverDayFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Denver",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
function denverDay(value: string): string {
  const parts = denverDayFormatter.formatToParts(new Date(value));
  const get = (kind: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === kind)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
function checkDispense(d: NativeDispense, prior: PrescriptionAuthorization) {
  if (
    micros(d.dispensed_at) < micros(prior.signed_at) ||
    denverDay(d.dispensed_at) !== d.reviewed_context.denver_date ||
    (d.reviewed_context.slot &&
      micros(d.dispensed_at) < micros(d.reviewed_context.slot.opened_at))
  )
    throw new Error("Dispense chronology differs from reviewed authorization");
  const c = d.reviewed_context,
    t = c.target,
    a = d.artifact;
  checkContext(c, prior);
  if (
    d.authorization_id !== prior.id ||
    d.authorization_hash !== prior.authorization_hash ||
    d.pet_id !== prior.pet_id ||
    d.client_id !== prior.client_id ||
    d.slot_index !== t.slot_index ||
    d.slot_version_before !== t.expected_slot_version ||
    d.slot_version_after !== (t.expected_slot_version ?? 0) + 1 ||
    (c.slot && d.slot_id !== c.slot.id) ||
    d.quantity !== normalized(t.quantity) ||
    d.unit !== prior.artifact.unit ||
    d.invoice_id !== t.invoice_id ||
    d.invoice_version_before !== c.invoice.version ||
    d.invoice_version_after !== c.invoice.version + 1 ||
    d.amount_cents !== c.charge.amount_cents ||
    d.refill_id !== (t.refill?.id ?? null) ||
    (d.refill_id === null) !== (d.refill_event_id === null)
  )
    throw new Error("Dispense receipt identity differs");
  if (
    d.allocations.length !== c.lots.length ||
    new Set(d.allocations.map((l) => l.movement_id)).size !==
      d.allocations.length ||
    d.allocations.some(
      (l, i) => l.lot_id !== c.lots[i].id || l.quantity !== c.lots[i].quantity,
    )
  )
    throw new Error("Dispense movement allocation differs");
  if (
    a.id !== d.id ||
    a.authorization_id !== prior.id ||
    a.authorization_hash !== prior.authorization_hash ||
    a.fill_index !== d.slot_index ||
    a.quantity !== d.quantity ||
    a.unit !== d.unit ||
    a.dispensed_at !== d.dispensed_at ||
    a.recorded_by.user_id !== d.actor_id ||
    a.invoice_id !== d.invoice_id ||
    !same(
      a.lots,
      c.lots.map((l) => ({
        id: l.id,
        number: l.lot_number,
        expires_on: l.expires_on,
        quantity: l.quantity,
      })),
    )
  )
    throw new Error("Dispense artifact differs");
}
function checkClosure(c: NativeSlotClosure, prior: PrescriptionAuthorization) {
  if (micros(c.created_at) < micros(c.before.opened_at))
    throw new Error("Closure predates slot opening");
  checkHead(c.reviewed_context.authorization, prior);
  checkUsage(c.reviewed_context.usage, prior);
  checkSlot(c.before, prior);
  checkSlot(c.after, prior);
  const expectedAfter = {
    ...c.before,
    version: c.before.version + 1,
    remaining_quantity: "0.000",
    state: "closed",
    closure_kind: "forfeited",
    closed_by: c.actor_id,
    closed_at: c.created_at,
    close_reason: c.reason,
  };
  if (
    c.authorization_id !== prior.id ||
    c.pet_id !== prior.pet_id ||
    c.slot_id !== c.before.id ||
    c.before.state !== "open" ||
    !same(c.before, c.reviewed_context.slot) ||
    !same(c.after, expectedAfter) ||
    c.forfeited_quantity !== c.before.remaining_quantity ||
    !same(c.reviewed_context.usage.open_slot, {
      id: c.before.id,
      index: c.before.index,
      version: c.before.version,
      remaining_quantity: c.before.remaining_quantity,
    })
  )
    throw new Error("Slot forfeiture differs");
}
function checkPickup(p: NativePickup, prior: PrescriptionAuthorization) {
  if (micros(p.picked_up_at) < micros(p.reviewed_context.dispense.dispensed_at))
    throw new Error("Pickup predates dispensing");
  const c = p.reviewed_context;
  checkHead(c.authorization, prior);
  checkDispense(c.dispense, prior);
  if (
    p.authorization_id !== prior.id ||
    p.pet_id !== prior.pet_id ||
    p.dispense_id !== c.dispense.id ||
    c.existing_pickup_id !== null ||
    (p.refill_id === null) !== (p.refill_event_id === null)
  )
    throw new Error("Pickup receipt differs");
  if (p.refill_id !== null) {
    if (!c.refill) throw new Error("Pickup refill review required");
    checkRefill(c.refill, prior);
    if (
      p.refill_id !== c.refill.refill.id ||
      p.refill_id !== c.dispense.refill_id
    )
      throw new Error("Pickup cannot close another refill");
  }
}
function micros(v: string): bigint {
  const fraction = /\.(\d+)(?:Z|[+-]\d{2}:?\d{2})$/.exec(v)?.[1] ?? "";
  return (
    BigInt(Date.parse(v)) * 1000n + BigInt(fraction.padEnd(6, "0").slice(3))
  );
}
export function createFulfillmentApi(
  client: PrescriptionRpc,
  actor: string,
  original: PrescriptionAuthorization,
) {
  uuid.parse(actor);
  const prior = parsePrescriptionAuthorization(
    original,
    original.pet_id,
    original.id,
  );
  async function rpc(name: string, args: Record<string, unknown>) {
    const { data, error } = await client.rpc(name, args);
    if (error) throw error;
    return data;
  }
  function scope(value: { authorization_id?: string; pet_id?: string }) {
    if (value.authorization_id !== prior.id || value.pet_id !== prior.pet_id)
      throw new Error("Fulfillment target differs");
  }
  function parseOperation(op: Readonly<PrescriptionOperation>) {
    uuid.parse(op.id);
    const request =
      op.kind === "dispense"
        ? dispenseRequestSchema.parse(op.payload)
        : op.kind === "close_slot"
          ? closeSlotRequestSchema.parse(op.payload)
          : op.kind === "pickup"
            ? pickupRequestSchema.parse(op.payload)
            : null;
    if (!request) throw new Error("Unknown fulfillment operation");
    scope(request);
    return request;
  }
  function receipt(value: unknown, op: Readonly<PrescriptionOperation>) {
    const request = parseOperation(op),
      r = receiptSchema.parse(value);
    if (
      r.id !== op.id ||
      r.actor_id !== actor ||
      r.operation !== op.kind ||
      !same(r.request, request)
    )
      throw new Error("Fulfillment operation receipt differs");
    if (r.operation === "dispense") {
      const { dispense: d, slot, refill_event: event } = r.result;
      checkDispense(d, prior);
      checkSlot(slot, prior);
      const {
        expected_context_hash,
        reason,
        attest_alert_review: _alerts,
        attest_dispense_review: _review,
        ...target
      } = r.request;
      if (
        d.id !== r.id ||
        d.actor_id !== actor ||
        d.reason !== reason ||
        d.reviewed_context_hash !== expected_context_hash ||
        !same(d.reviewed_context.target, target) ||
        slot.id !== d.slot_id ||
        slot.version !== d.slot_version_after ||
        slot.index !== d.slot_index ||
        milli(slot.dispensed_quantity) !==
          milli(d.quantity) +
            (d.reviewed_context.slot
              ? milli(d.reviewed_context.slot.dispensed_quantity)
              : 0n) ||
        slot.state !==
          (slot.dispensed_quantity === slot.maximum_quantity
            ? "closed"
            : "open") ||
        (slot.state === "closed" &&
          (slot.closure_kind !== "filled" ||
            slot.closed_by !== actor ||
            slot.closed_at !== d.dispensed_at))
      )
        throw new Error("Committed slot or dispense differs");
      if (
        slot.opened_by !== (d.reviewed_context.slot?.opened_by ?? actor) ||
        slot.opened_at !==
          (d.reviewed_context.slot?.opened_at ?? d.dispensed_at) ||
        slot.close_reason !== null
      )
        throw new Error("Slot creation metadata differs");
      if ((event === null) !== (r.request.refill === null))
        throw new Error("Atomic refill event missing");
      if (event) {
        const e = parseNativeRefillEvent(event);
        if (
          e.version !== 2 ||
          e.action !== "dispense" ||
          e.id !== d.refill_event_id ||
          e.refill_id !== d.refill_id ||
          e.actor_id !== actor ||
          e.reason !== reason ||
          e.prior_event_id !== d.reviewed_context.refill?.head_id ||
          !same(e.before, d.reviewed_context.refill?.refill) ||
          e.fulfillment_reference.id !== d.id ||
          e.fulfillment_reference.dispense_id !== d.id
        )
          throw new Error("Atomic dispense refill linkage differs");
      }
    } else if (r.operation === "close_slot") {
      const c = r.result;
      checkClosure(c, prior);
      if (
        c.id !== r.id ||
        c.actor_id !== actor ||
        c.reason !== r.request.reason ||
        c.reviewed_context_hash !== r.request.expected_context_hash ||
        c.before.index !== r.request.slot_index ||
        c.before.version !== r.request.expected_slot_version
      )
        throw new Error("Slot closure request differs");
    } else {
      const p = r.result;
      checkPickup(p, prior);
      if (
        p.id !== r.id ||
        p.actor_id !== actor ||
        p.dispense_id !== r.request.dispense_id ||
        p.reason !== r.request.reason ||
        p.recipient_name !== r.request.recipient_name ||
        p.recipient_relationship !== r.request.recipient_relationship ||
        p.reviewed_context_hash !== r.request.expected_context_hash ||
        p.refill_id !== (r.request.refill_close?.id ?? null) ||
        (r.request.refill_close &&
          p.reviewed_context.refill?.refill.version !==
            r.request.refill_close.expected_version)
      )
        throw new Error("Pickup request differs");
    }
    const resultAt =
      r.operation === "dispense"
        ? r.result.dispense.dispensed_at
        : r.operation === "close_slot"
          ? r.result.created_at
          : r.result.picked_up_at;
    if (micros(r.created_at) < micros(resultAt))
      throw new Error("Receipt predates fulfillment result");
    return r;
  }
  return {
    async execute(op: Readonly<PrescriptionOperation>) {
      const request = parseOperation(op),
        names = {
          dispense: "record_native_dispense",
          close_slot: "close_native_fill_slot",
          pickup: "record_native_pickup",
        };
      return receipt(
        await rpc(names[op.kind as keyof typeof names], {
          p_id: op.id,
          p_request: request,
        }),
        op,
      );
    },
    async recover(op: Readonly<PrescriptionOperation>) {
      parseOperation(op);
      const result = await rpc("recover_native_fulfillment_operation", {
        p_id: op.id,
      });
      return result === null ? null : receipt(result, op);
    },
    async previewDispense(target: DispenseTarget) {
      const request = dispenseTargetSchema.parse(target);
      scope(request);
      const result = z
        .object({
          version: z.literal(1),
          actor_id: uuid,
          context: dispenseContextSchema,
          context_hash: hash,
          observed_at: instant,
        })
        .strict()
        .parse(await rpc("preview_native_dispense", { p_target: request }));
      checkContext(result.context, prior);
      if (result.actor_id !== actor || !same(result.context.target, request))
        throw new Error("Dispense preview differs");
      return result;
    },
    async previewClose(slotIndex: number) {
      index.parse(slotIndex);
      const result = z
        .object({
          version: z.literal(1),
          actor_id: uuid,
          context: closeContextSchema,
          context_hash: hash,
          observed_at: instant,
        })
        .strict()
        .parse(
          await rpc("preview_native_slot_close", {
            p_authorization_id: prior.id,
            p_pet_id: prior.pet_id,
            p_slot_index: slotIndex,
          }),
        );
      checkHead(result.context.authorization, prior);
      checkSlot(result.context.slot, prior);
      checkUsage(result.context.usage, prior);
      if (
        result.actor_id !== actor ||
        result.context.slot.index !== slotIndex ||
        result.context.slot.state !== "open" ||
        !same(result.context.usage.open_slot, {
          id: result.context.slot.id,
          index: slotIndex,
          version: result.context.slot.version,
          remaining_quantity: result.context.slot.remaining_quantity,
        })
      )
        throw new Error("Forfeiture preview differs");
      return result;
    },
    async previewPickup(
      dispenseId: string,
      close: z.infer<typeof refillClose> | null = null,
    ) {
      uuid.parse(dispenseId);
      if (close) refillClose.parse(close);
      const result = z
        .object({
          version: z.literal(1),
          actor_id: uuid,
          context: pickupContextSchema,
          context_hash: hash,
          observed_at: instant,
        })
        .strict()
        .parse(
          await rpc("preview_native_pickup", {
            p_dispense_id: dispenseId,
            p_pet_id: prior.pet_id,
            p_refill_close: close,
          }),
        );
      checkHead(result.context.authorization, prior);
      checkDispense(result.context.dispense, prior);
      if (
        result.actor_id !== actor ||
        result.context.dispense.id !== dispenseId ||
        result.context.existing_pickup_id !== null
      )
        throw new Error("Pickup preview differs");
      if (close) {
        if (!result.context.refill)
          throw new Error("Refill closure review missing");
        checkRefill(result.context.refill, prior);
        if (
          result.context.refill.refill.id !== close.id ||
          result.context.refill.refill.version !== close.expected_version ||
          result.context.dispense.refill_id !== close.id
        )
          throw new Error("Pickup refill target differs");
      }
      return result;
    },
    async read() {
      const raw = await rpc("read_native_fulfillment", {
        p_authorization_id: prior.id,
        p_pet_id: prior.pet_id,
      });
      if (raw === null) return null;
      const r = z
        .object({
          version: z.literal(1),
          authorization: headSchema,
          usage: prescriptionUsageV2Schema,
          open_slot: fillSlotSchema.nullable(),
        })
        .strict()
        .parse(raw);
      checkHead(r.authorization, prior);
      checkUsage(r.usage, prior);
      if (r.open_slot) {
        checkSlot(r.open_slot, prior);
        if (
          r.open_slot.state !== "open" ||
          !same(r.usage.open_slot, {
            id: r.open_slot.id,
            index: r.open_slot.index,
            version: r.open_slot.version,
            remaining_quantity: r.open_slot.remaining_quantity,
          })
        )
          throw new Error("Open slot projection differs");
      } else if (r.usage.open_slot !== null)
        throw new Error("Open slot detail missing");
      return r;
    },
    async slots(afterIndex: number | null = null, limit = 20) {
      if (afterIndex !== null) index.parse(afterIndex);
      z.number().int().min(1).max(100).parse(limit);
      const page = z
        .object({
          version: z.literal(1),
          authorization_id: uuid,
          pet_id: uuid,
          slots: z.array(fillSlotSchema).max(100),
          has_more: z.boolean(),
          next_index: index.nullable(),
        })
        .strict()
        .parse(
          await rpc("list_native_fill_slots", {
            p_authorization_id: prior.id,
            p_pet_id: prior.pet_id,
            p_after_index: afterIndex,
            p_limit: limit,
          }),
        );
      scope(page);
      let previous = afterIndex ?? -1;
      for (const slot of page.slots) {
        checkSlot(slot, prior);
        if (slot.index <= previous) throw new Error("Slot ordering differs");
        previous = slot.index;
      }
      if (
        page.slots.length > limit ||
        page.has_more !== (page.next_index !== null) ||
        (page.has_more &&
          (page.slots.length !== limit || page.next_index !== previous))
      )
        throw new Error("Slot continuation differs");
      return page;
    },
    async history(
      kind: "dispenses" | "closures" | "pickups",
      cursor: FulfillmentCursor | null = null,
      limit = 20,
    ) {
      if (cursor) cursorSchema.parse(cursor);
      z.number().int().min(1).max(100).parse(limit);
      const names = {
          dispenses: "list_native_dispenses",
          closures: "list_native_slot_closures",
          pickups: "list_native_pickups",
        },
        schemas = {
          dispenses: dispenseSchema,
          closures: closureSchema,
          pickups: pickupSchema,
        };
      if (!Object.prototype.hasOwnProperty.call(names, kind))
        throw new Error("Unknown fulfillment history");
      const page = z
        .object({
          version: z.literal(1),
          authorization_id: uuid,
          pet_id: uuid,
          [kind]: z.array(schemas[kind]).max(100),
          has_more: z.boolean(),
          next_cursor: cursorSchema.nullable(),
        })
        .strict()
        .parse(
          await rpc(names[kind], {
            p_authorization_id: prior.id,
            p_pet_id: prior.pet_id,
            p_before_at: cursor?.before_at ?? null,
            p_before_id: cursor?.before_id ?? null,
            p_limit: limit,
          }),
        );
      scope({
        authorization_id: uuid.parse(page.authorization_id),
        pet_id: uuid.parse(page.pet_id),
      });
      const values = page[kind] as Array<
        NativeDispense | NativeSlotClosure | NativePickup
      >;
      let previous = cursor;
      const ids = new Set<string>();
      for (const item of values) {
        let at: string;
        if (kind === "dispenses") {
          checkDispense(item as NativeDispense, prior);
          at = (item as NativeDispense).dispensed_at;
        } else if (kind === "closures") {
          checkClosure(item as NativeSlotClosure, prior);
          at = (item as NativeSlotClosure).created_at;
        } else {
          checkPickup(item as NativePickup, prior);
          at = (item as NativePickup).picked_up_at;
        }
        if (
          ids.has(item.id) ||
          (previous &&
            !(
              micros(at) < micros(previous.before_at) ||
              (micros(at) === micros(previous.before_at) &&
                item.id < previous.before_id)
            ))
        )
          throw new Error("Fulfillment history order differs");
        previous = { before_at: at, before_id: item.id };
        ids.add(item.id);
      }
      if (
        values.length > limit ||
        page.has_more !== !!page.next_cursor ||
        (page.has_more &&
          (values.length !== limit || !same(page.next_cursor, previous)))
      )
        throw new Error("Fulfillment history continuation differs");
      return page;
    },
  };
}
export interface FulfillmentApi
  extends ReturnType<typeof createFulfillmentApi> {}
