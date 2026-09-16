/** Closed native custody/stock-return boundaries; quantities remain exact decimals. */
import { z } from "zod";
import type { PrescriptionRpc } from "./prescription-api.ts";
import type { PrescriptionOperation } from "./prescription-state.ts";
import {
  correctionEqual,
  correctionHeadSchema,
  correctionTargetSchema,
} from "./fulfillment-corrections-api.ts";
const uuid = z
    .string()
    .uuid()
    .refine((v) => v === v.toLowerCase()),
  hash = z.string().regex(/^[a-f0-9]{64}$/),
  version = z.number().int().min(0).max(2147483647),
  sequence = version.refine((v) => v > 0);
const instant = z
  .string()
  .datetime({ offset: true })
  .refine((v) => Number.isFinite(Date.parse(v)) && !/\.\d{7}/.test(v));
const text = (n: number) =>
  z
    .string()
    .min(1)
    .refine(
      (v) =>
        v === v.trim() &&
        Array.from(v).length <= n &&
        !Array.from(v).some((c) => {
          const n = c.charCodeAt(0);
          return n === 127 || (n < 32 && n !== 9 && n !== 10);
        }),
    );
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      Number.isFinite(Date.parse(v + "T00:00:00Z")) &&
      new Date(v + "T00:00:00Z").toISOString().slice(0, 10) === v,
  );
const decimal = z.string().regex(/^(?:0|[1-9]\d{0,10})\.\d{3}$/),
  input = z
    .string()
    .regex(/^(?:0|[1-9]\d{0,10})(?:\.\d{1,3})?$/)
    .refine((v) => /[1-9]/.test(v));
export function returnMilli(v: string) {
  const [a, b = ""] = v.split(".");
  return BigInt(a) * 1000n + BigInt(b.padEnd(3, "0"));
}
function micros(v: string) {
  const f = v.match(/\.(\d+)(?:Z|[+-]\d\d:\d\d)$/)?.[1] ?? "";
  return BigInt(Date.parse(v)) * 1000n + BigInt(f.padEnd(6, "0").slice(3));
}
function check(v: unknown): asserts v {
  if (!v)
    throw new Error(
      "Return evidence does not match this exact reviewed record.",
    );
}
const ordered = (a: { allocation_id: string }[]) =>
  a.every((v, i) => i === 0 || a[i - 1].allocation_id < v.allocation_id);
const custody = z.enum(["clinic_retained", "client_returned", "unknown"]),
  condition = z.enum(["sealed_intact", "opened", "damaged", "unknown"]),
  storage = z.enum(["controlled", "compromised", "unknown"]);
export const returnPolicySchema = z
  .object({
    version,
    enabled: z.boolean(),
    review_reference: text(2000).nullable(),
    actor_id: uuid.nullable(),
    actor_name: text(200).nullable(),
    reviewed_at: instant.nullable(),
    record_hash: hash.nullable(),
  })
  .strict()
  .refine((p) =>
    p.version === 0
      ? !p.enabled &&
        p.review_reference === null &&
        p.actor_id === null &&
        p.actor_name === null &&
        p.reviewed_at === null &&
        p.record_hash === null
      : p.review_reference !== null &&
        p.actor_id !== null &&
        p.actor_name !== null &&
        p.reviewed_at !== null &&
        p.record_hash !== null,
  );
export const returnPolicyRequestSchema = z
  .object({
    expected_version: version,
    enabled: z.boolean(),
    review_reference: text(2000),
    attest_review: z.literal(true),
  })
  .strict();
const policyReceiptSchema = z
  .object({
    version: z.literal(1),
    id: uuid,
    actor_id: uuid,
    request: returnPolicyRequestSchema,
    request_hash: hash,
    result: returnPolicySchema,
    created_at: instant,
  })
  .strict();
const targetSchema = correctionTargetSchema.refine((t) =>
  Object.values(t).every((v) => v === v.toLowerCase()),
);
export const returnIntentSchema = z
  .object({
    target: targetSchema,
    action: z.enum(["intake", "dispose", "restock"]),
    intake_id: uuid.nullable(),
    allocations: z
      .array(z.object({ allocation_id: uuid, quantity: input }).strict())
      .min(1)
      .max(100)
      .refine(ordered),
    custody: custody.nullable(),
    package_condition: condition.nullable(),
    storage_history: storage.nullable(),
    reason: text(2000),
    note: text(4000),
  })
  .strict()
  .refine((i) =>
    i.action === "intake"
      ? i.intake_id === null &&
        i.custody !== null &&
        i.package_condition !== null &&
        i.storage_history !== null
      : i.intake_id !== null &&
        i.custody === null &&
        i.package_condition === null &&
        i.storage_history === null,
  );
export const returnRequestSchema = z
  .object({
    intent: returnIntentSchema,
    expected_context_hash: hash,
    expected_head: correctionHeadSchema,
    attest_review: z.literal(true),
    attest_restock: z.boolean(),
  })
  .strict()
  .refine(
    (r) =>
      r.attest_restock === (r.intent.action === "restock") &&
      (r.expected_head.event_id === null ||
        r.expected_head.event_id === r.expected_head.event_id.toLowerCase()),
  );
const balanceSchema = z
  .object({
    allocation_id: uuid,
    lot_id: uuid,
    lot_number: text(200),
    expires_on: day,
    dispensed_quantity: decimal,
    returned_quantity: decimal,
    remaining_returnable_quantity: decimal,
    held_quantity: decimal,
    disposed_quantity: decimal,
    restocked_quantity: decimal,
  })
  .strict()
  .refine(
    (b) =>
      returnMilli(b.dispensed_quantity) > 0n &&
      returnMilli(b.dispensed_quantity) ===
        returnMilli(b.returned_quantity) +
          returnMilli(b.remaining_returnable_quantity) &&
      returnMilli(b.returned_quantity) ===
        returnMilli(b.held_quantity) +
          returnMilli(b.disposed_quantity) +
          returnMilli(b.restocked_quantity),
  );
const balances = z.array(balanceSchema).min(1).max(100).refine(ordered);
const intakeAllocation = z
  .object({
    allocation_id: uuid,
    lot_id: uuid,
    quantity: decimal,
    held_quantity: decimal,
    disposed_quantity: decimal,
    restocked_quantity: decimal,
  })
  .strict()
  .refine(
    (b) =>
      returnMilli(b.quantity) > 0n &&
      returnMilli(b.quantity) ===
        returnMilli(b.held_quantity) +
          returnMilli(b.disposed_quantity) +
          returnMilli(b.restocked_quantity),
  );
const intakeSchema = z
  .object({
    id: uuid,
    sequence,
    custody,
    package_condition: condition,
    storage_history: storage,
    allocations: z.array(intakeAllocation).min(1).max(100).refine(ordered),
  })
  .strict();
const pickupSchema = z
  .object({
    id: uuid,
    document_hash: hash,
    picked_up_at: instant,
    recipient_name: text(200),
    recipient_relationship: text(200),
    actor_id: uuid,
  })
  .strict();
const stockSchema = z
  .object({
    product: z
      .object({
        id: uuid,
        name: text(200),
        unit: text(50),
        active: z.boolean(),
        version: sequence,
      })
      .strict(),
    lots: z
      .array(z.object({ lot_id: uuid, balance: decimal }).strict())
      .min(1)
      .max(100),
    practice_date: day,
  })
  .strict();
const contextSchema = z
  .object({
    version: z.literal(1),
    target: targetSchema,
    authorization_hash: hash,
    dispense_document_hash: hash,
    dispensed_at: instant,
    head: correctionHeadSchema,
    original_pickup: pickupSchema.nullable(),
    correction_head: correctionHeadSchema,
    allocations: balances,
    intake: intakeSchema.nullable(),
    stock_review: stockSchema.nullable(),
    policy: returnPolicySchema.nullable(),
    intent: returnIntentSchema,
  })
  .strict();
export const returnBlockers = [
  "policy_disabled",
  "dvm_required",
  "custody_not_retained",
  "package_not_sealed",
  "storage_not_controlled",
  "original_pickup_exists",
  "product_inactive",
  "unit_changed",
  "lot_expired",
] as const;
const previewSchema = z
  .object({
    version: z.literal(1),
    actor_id: uuid,
    observed_at: instant,
    context: contextSchema,
    context_hash: hash,
    allowed: z.boolean(),
    blockers: z.array(z.enum(returnBlockers)),
  })
  .strict()
  .refine(
    (p) =>
      p.allowed === (p.blockers.length === 0) &&
      new Set(p.blockers).size === p.blockers.length,
  );
const eventSchema = z
  .object({
    version: z.literal(1),
    id: uuid,
    target: targetSchema,
    authorization_hash: hash,
    dispense_document_hash: hash,
    sequence,
    prior_event_id: uuid.nullable(),
    prior_record_hash: hash.nullable(),
    actor: z
      .object({
        id: uuid,
        name: text(200),
        authority: z.enum(["active_staff", "active_dvm"]),
      })
      .strict(),
    action: z.enum(["intake", "dispose", "restock"]),
    intake_id: uuid.nullable(),
    allocations: z
      .array(
        z
          .object({
            allocation_id: uuid,
            lot_id: uuid,
            quantity: decimal.refine((v) => returnMilli(v) > 0n),
            movement_id: uuid.nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(100)
      .refine(ordered),
    custody: custody.nullable(),
    package_condition: condition.nullable(),
    storage_history: storage.nullable(),
    reason: text(2000),
    note: text(4000),
    policy: returnPolicySchema.nullable(),
    reviewed_context_hash: hash,
    created_at: instant,
    record_hash: hash,
  })
  .strict()
  .refine(
    (e) =>
      (e.sequence === 1
        ? e.prior_event_id === null && e.prior_record_hash === null
        : e.prior_event_id !== null && e.prior_record_hash !== null) &&
      (e.action === "intake"
        ? e.intake_id === null &&
          e.custody !== null &&
          e.package_condition !== null &&
          e.storage_history !== null
        : e.intake_id !== null &&
          e.custody === null &&
          e.package_condition === null &&
          e.storage_history === null) &&
      (e.action === "restock"
        ? e.actor.authority === "active_dvm" &&
          e.policy?.enabled === true &&
          e.allocations.every((a) => a.movement_id !== null)
        : e.policy === null &&
          e.allocations.every((a) => a.movement_id === null)),
  );
const receiptSchema = z
  .object({
    version: z.literal(1),
    id: uuid,
    actor_id: uuid,
    request: returnRequestSchema,
    request_hash: hash,
    result: eventSchema,
    created_at: instant,
  })
  .strict();
const readSchema = z
  .object({
    version: z.literal(1),
    target: targetSchema,
    authorization_hash: hash,
    dispense_document_hash: hash,
    dispensed_at: instant,
    head: correctionHeadSchema,
    allocations: balances,
  })
  .strict();
const pageSchema = z
  .object({
    version: z.literal(1),
    target: targetSchema,
    head: correctionHeadSchema,
    events: z.array(eventSchema).max(100),
    next_before_version: sequence.nullable(),
  })
  .strict();
export type ReturnIntent = z.infer<typeof returnIntentSchema>;
export type ReturnPreview = z.infer<typeof previewSchema>;
export type ReturnEvent = z.infer<typeof eventSchema>;
export type ReturnIntakeBalance = z.infer<typeof intakeSchema>;
export type ReturnRead = z.infer<typeof readSchema>;
export type ReturnPolicy = z.infer<typeof returnPolicySchema>;
export type ReturnReceipt = z.infer<typeof receiptSchema>;
function transport(client: PrescriptionRpc) {
  return async (name: string, args: Record<string, unknown> = {}) => {
    const { data, error } = await client.rpc(name, args);
    if (error) throw error;
    return data;
  };
}
export function createNativeReturnPolicyApi(
  client: PrescriptionRpc,
  actor: string,
) {
  uuid.parse(actor);
  const rpc = transport(client);
  function request(op: Readonly<PrescriptionOperation>) {
    uuid.parse(op.id);
    check(op.kind === "configure_return_policy");
    return returnPolicyRequestSchema.parse(op.payload);
  }
  function receipt(raw: unknown, op: Readonly<PrescriptionOperation>) {
    const q = request(op),
      r = policyReceiptSchema.parse(raw);
    check(
      r.id === op.id &&
        r.actor_id === actor &&
        r.result.actor_id === actor &&
        correctionEqual(r.request, q) &&
        r.result.version === q.expected_version + 1 &&
        r.result.enabled === q.enabled &&
        r.result.review_reference === q.review_reference &&
        r.result.reviewed_at !== null &&
        micros(r.result.reviewed_at) === micros(r.created_at),
    );
    return r;
  }
  return {
    async read() {
      return returnPolicySchema.parse(await rpc("read_native_return_policy"));
    },
    async execute(op: Readonly<PrescriptionOperation>) {
      const q = request(op);
      return receipt(
        await rpc("configure_native_return_policy", {
          p_id: op.id,
          p_request: q,
        }),
        op,
      );
    },
    async recover(op: Readonly<PrescriptionOperation>) {
      request(op);
      const raw = await rpc("recover_native_return_policy", { p_id: op.id });
      return raw === null ? null : receipt(raw, op);
    },
  };
}
export function createNativeReturnsApi(
  client: PrescriptionRpc,
  actor: string,
  target: z.infer<typeof targetSchema>,
) {
  uuid.parse(actor);
  targetSchema.parse(target);
  const rpc = transport(client),
    args = {
      p_authorization_id: target.authorization_id,
      p_pet_id: target.pet_id,
      p_dispense_id: target.dispense_id,
    };
  const contexts = new Map<string, z.infer<typeof contextSchema>>();
  function intent(value: unknown) {
    const i = returnIntentSchema.parse(value);
    check(correctionEqual(i.target, target));
    return i;
  }
  function request(op: Readonly<PrescriptionOperation>) {
    uuid.parse(op.id);
    check(op.kind === "record_return");
    const q = returnRequestSchema.parse(op.payload);
    intent(q.intent);
    return q;
  }
  function receipt(raw: unknown, op: Readonly<PrescriptionOperation>) {
    const q = request(op),
      r = receiptSchema.parse(raw),
      e = r.result;
    check(
      r.id === op.id &&
        r.actor_id === actor &&
        e.id === op.id &&
        e.actor.id === actor &&
        correctionEqual(r.request, q) &&
        correctionEqual(e.target, target) &&
        e.sequence === q.expected_head.version + 1 &&
        e.prior_event_id === q.expected_head.event_id &&
        e.prior_record_hash === q.expected_head.record_hash &&
        e.reviewed_context_hash === q.expected_context_hash &&
        micros(e.created_at) === micros(r.created_at),
    );
    for (const k of [
      "action",
      "intake_id",
      "custody",
      "package_condition",
      "storage_history",
      "reason",
      "note",
    ] as const)
      check(correctionEqual(e[k], q.intent[k]));
    check(e.allocations.length === q.intent.allocations.length);
    e.allocations.forEach((a, i) =>
      check(
        a.allocation_id === q.intent.allocations[i].allocation_id &&
          returnMilli(a.quantity) ===
            returnMilli(q.intent.allocations[i].quantity),
      ),
    );
    const c = contexts.get(q.expected_context_hash);
    if (c) {
      check(
        e.authorization_hash === c.authorization_hash &&
          e.dispense_document_hash === c.dispense_document_hash &&
          micros(e.created_at) >= micros(c.dispensed_at),
      );
      e.allocations.forEach((a) =>
        check(
          c.allocations.find((b) => b.allocation_id === a.allocation_id)
            ?.lot_id === a.lot_id,
        ),
      );
      check(correctionEqual(e.policy, c.policy));
    }
    return r;
  }
  return {
    async read() {
      const raw = await rpc("read_native_dispense_returns", args);
      if (raw === null) return null;
      const r = readSchema.parse(raw);
      check(correctionEqual(r.target, target));
      return r;
    },
    async readIntake(id: string) {
      uuid.parse(id);
      const raw = await rpc("read_native_return_intake", {
        ...args,
        p_intake_id: id,
      });
      if (raw === null) return null;
      const r = z
        .object({
          version: z.literal(1),
          target: targetSchema,
          head: correctionHeadSchema,
          intake: intakeSchema,
        })
        .strict()
        .parse(raw);
      check(correctionEqual(r.target, target) && r.intake.id === id && r.intake.sequence <= r.head.version);
      return r;
    },
    async preview(value: ReturnIntent) {
      const i = intent(value),
        p = previewSchema.parse(
          await rpc("preview_native_dispense_return", { p_intent: i }),
        ),
        c = p.context;
      check(
        p.actor_id === actor &&
          correctionEqual(c.target, target) &&
          correctionEqual(c.intent, i) &&
          micros(p.observed_at) >= micros(c.dispensed_at),
      );
      check(
        i.action === "intake"
          ? c.intake === null
          : c.intake?.id === i.intake_id && c.intake.sequence <= c.head.version,
      );
      check(
        i.action === "restock"
          ? c.policy !== null && c.stock_review !== null
          : c.policy === null && c.stock_review === null && p.allowed,
      );
      i.allocations.forEach((a) => {
        const b = c.allocations.find(
          (b) => b.allocation_id === a.allocation_id,
        );
        check(b);
        const available =
          i.action === "intake"
            ? b.remaining_returnable_quantity
            : c.intake?.allocations.find(
                (b) => b.allocation_id === a.allocation_id,
              )?.held_quantity;
        check(
          available !== undefined &&
            returnMilli(a.quantity) <= returnMilli(available),
        );
      });
      if (i.action === "restock") {
        const known = {
          policy_disabled: !c.policy!.enabled,
          custody_not_retained: c.intake!.custody !== "clinic_retained",
          package_not_sealed: c.intake!.package_condition !== "sealed_intact",
          storage_not_controlled: c.intake!.storage_history !== "controlled",
          original_pickup_exists: c.original_pickup !== null,
          product_inactive: !c.stock_review!.product.active,
          lot_expired: i.allocations.some(
            (a) =>
              c.allocations.find((b) => b.allocation_id === a.allocation_id)!
                .expires_on < c.stock_review!.practice_date,
          ),
        };
        for (const [code, blocked] of Object.entries(known))
          check(
            p.blockers.includes(code as (typeof returnBlockers)[number]) ===
              blocked,
          );
        check(
          new Set(c.stock_review!.lots.map((l) => l.lot_id)).size ===
            c.stock_review!.lots.length,
        );
        check(
          c.stock_review!.lots.length === i.allocations.length &&
            c.stock_review!.lots.every(
              (l, index, all) =>
                index === 0 || all[index - 1].lot_id < l.lot_id,
            ),
        );
        for (const a of i.allocations)
          check(
            c.stock_review!.lots.some(
              (l) =>
                l.lot_id ===
                c.allocations.find((b) => b.allocation_id === a.allocation_id)!
                  .lot_id,
            ),
          );
      }
      contexts.set(p.context_hash, c);
      return p;
    },
    async history(before: number | null = null, limit = 25) {
      if (before !== null) sequence.parse(before);
      z.number().int().min(1).max(100).parse(limit);
      const raw = await rpc("list_native_dispense_returns", {
        ...args,
        p_before_version: before,
        p_limit: limit,
      });
      const p = pageSchema.parse(raw);
      check(correctionEqual(p.target, target) && p.events.length <= limit);
      p.events.forEach((e, i) => {
        check(
          correctionEqual(e.target, target) &&
            e.sequence <= p.head.version &&
            (before === null || e.sequence < before),
        );
        if (i > 0)
          check(
            p.events[i - 1].sequence === e.sequence + 1 &&
              p.events[i - 1].prior_event_id === e.id &&
              p.events[i - 1].prior_record_hash === e.record_hash,
          );
        if (e.sequence === p.head.version)
          check(
            e.id === p.head.event_id && e.record_hash === p.head.record_hash,
          );
      });
      if (before === null)
        check(
          p.head.version === 0
            ? p.events.length === 0
            : p.events[0]?.sequence === p.head.version,
        );
      if (p.next_before_version !== null)
        check(
          p.events.length === limit &&
            p.next_before_version === p.events.at(-1)?.sequence &&
            p.next_before_version > 1,
        );
      else if (p.events.length) check(p.events.at(-1)?.sequence === 1);
      return p;
    },
    async execute(op: Readonly<PrescriptionOperation>) {
      const q = request(op);
      return receipt(
        await rpc("record_native_dispense_return", {
          p_id: op.id,
          p_request: q,
        }),
        op,
      );
    },
    async recover(op: Readonly<PrescriptionOperation>) {
      request(op);
      const raw = await rpc("recover_native_dispense_return", { p_id: op.id });
      return raw === null ? null : receipt(raw, op);
    },
  };
}
