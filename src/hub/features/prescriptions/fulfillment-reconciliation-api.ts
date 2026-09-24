/** Exact, actor-bound transport for physical return reconciliation. Hash verification is server-owned. */
import { z } from "zod";
import type { PrescriptionRpc } from "./prescription-api.ts";
import type { PrescriptionOperation } from "./prescription-state.ts";
import {
  correctionEqual,
  correctionHeadSchema,
  correctionTargetSchema,
} from "./fulfillment-corrections-api.ts";
import { returnMilli, returnPolicySchema } from "./fulfillment-returns-api.ts";
import type {
  ReconciliationEvent,
  ReconciliationRead,
  ReconciliationPreview,
  ReconciliationReceipt,
  ReconciliationPage,
  ReconciliationIntakeRead,
  ReconciliationIntent,
  ReturnDiscrepancyIntent,
  ReturnDiscrepancyPreview,
  ReturnDiscrepancyReceipt,
  ReturnDiscrepancyState,
} from "../../../../supabase/functions/_shared/native-return-reconciliation-contract.ts";
import type { ReturnEvent } from "../../../../supabase/functions/_shared/native-dispense-returns.ts";
import {
  validateReconciliationEventShape,
  validateDiscrepancyEventShape,
  validateDiscrepancyStateShape,
  validateReconciliationReplayShape,
} from "../../../../supabase/functions/_shared/native-return-reconciliation.ts";
const uuid = z
    .string()
    .uuid()
    .refine((v) => v === v.toLowerCase()),
  hash = z.string().regex(/^[a-f0-9]{64}$/),
  integer = z.number().int().min(0).max(2147483647),
  positive = integer.refine((v) => v > 0);
const text = (max: number) =>
  z.string().refine(
    (v) =>
      v.length > 0 &&
      v === v.trim() &&
      Array.from(v).length <= max &&
      !Array.from(v).some((c) => {
        const n = c.charCodeAt(0);
        return n === 127 || (n < 32 && n !== 9 && n !== 10);
      }),
  );
const instant = z
  .string()
  .datetime({ offset: true })
  .refine((v) => Number.isFinite(Date.parse(v)) && !/\.\d{7}/.test(v));
const decimal = z.string().regex(/^(?:0|[1-9]\d{0,10})\.\d{3}$/),
  input = z
    .string()
    .regex(/^(?:0|[1-9]\d{0,10})(?:\.\d{1,3})?$/)
    .refine((v) => returnMilli(v) > 0n),
  historical = z.string().regex(/^(?:0|[1-9]\d*)\.\d{3}$/);
const target = correctionTargetSchema.refine((t) =>
    Object.values(t).every((v) => v === v.toLowerCase()),
  ),
  head = correctionHeadSchema;
const source = z.object({ event_id: uuid, record_hash: hash }).strict();
const ordered = (a: { allocation_id: string }[]) =>
  a.every((v, i) => i === 0 || a[i - 1].allocation_id < v.allocation_id);
const inputs = z
  .array(z.object({ allocation_id: uuid, quantity: input }).strict())
  .min(1)
  .max(100)
  .refine(ordered);
const custody = z.enum(["clinic_retained", "client_returned", "unknown"]),
  condition = z.enum(["sealed_intact", "opened", "damaged", "unknown"]),
  storage = z.enum(["controlled", "compromised", "unknown"]);
export const reconciliationIntentSchema = z
  .object({
    target,
    action: z.enum([
      "intake",
      "dispose",
      "restock",
      "retract_intake",
      "retract_disposal",
      "retract_restock",
    ]),
    intake_id: uuid.nullable(),
    correction_target: source.nullable(),
    discrepancy_id: uuid.nullable(),
    allocations: inputs,
    custody: custody.nullable(),
    package_condition: condition.nullable(),
    storage_history: storage.nullable(),
    reason: text(2000),
    note: text(4000),
  })
  .strict()
  .refine(
    (i) =>
      (i.action === "intake"
        ? i.intake_id === null &&
          i.custody !== null &&
          i.package_condition !== null &&
          i.storage_history !== null
        : i.intake_id !== null &&
          i.custody === null &&
          i.package_condition === null &&
          i.storage_history === null) &&
      (i.action.startsWith("retract_")
        ? i.correction_target !== null
        : i.correction_target === null && i.discrepancy_id === null),
  );
const physical = z
  .object({
    reviewed_physical_facts: z.literal(true),
    intake_claim_incorrect: z.boolean(),
    remains_physically_held: z.boolean(),
    was_not_destroyed: z.boolean(),
    removed_from_available_stock: z.boolean(),
  })
  .strict();
function correctPhysical(a: string, p: z.infer<typeof physical>) {
  return (
    p.intake_claim_incorrect === (a === "retract_intake") &&
    p.remains_physically_held ===
      (a === "retract_disposal" || a === "retract_restock") &&
    p.was_not_destroyed === (a === "retract_disposal") &&
    p.removed_from_available_stock === (a === "retract_restock")
  );
}
export function reconciliationAttestations(
  action: ReconciliationIntent["action"],
): z.infer<typeof physical> {
  return {
    reviewed_physical_facts: true,
    intake_claim_incorrect: action === "retract_intake",
    remains_physically_held:
      action === "retract_disposal" || action === "retract_restock",
    was_not_destroyed: action === "retract_disposal",
    removed_from_available_stock: action === "retract_restock",
  };
}
const request = z
  .object({
    intent: reconciliationIntentSchema,
    expected_context_hash: hash,
    expected_head: head,
    expected_discrepancy_head: head,
    attest_review: z.literal(true),
    attest_restock: z.boolean(),
    physical_attestations: physical,
  })
  .strict()
  .refine(
    (q) =>
      q.attest_restock === (q.intent.action === "restock") &&
      correctPhysical(q.intent.action, q.physical_attestations),
  );
const allocationFields = {
  allocation_id: uuid,
  lot_id: uuid,
  dispensed_quantity: decimal,
  returned_quantity: decimal,
  remaining_returnable_quantity: decimal,
  held_quantity: decimal,
  disposed_quantity: decimal,
  restocked_quantity: decimal,
};
const validBalance = (b: z.infer<typeof replayBalance>) =>
  returnMilli(b.dispensed_quantity) ===
    returnMilli(b.returned_quantity) +
      returnMilli(b.remaining_returnable_quantity) &&
  returnMilli(b.returned_quantity) ===
    returnMilli(b.held_quantity) +
      returnMilli(b.disposed_quantity) +
      returnMilli(b.restocked_quantity);
const replayBalance = z.object(allocationFields).strict();
const balances = z
  .array(
    z
      .object({
        ...allocationFields,
        lot_number: text(200),
        expires_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .strict()
      .refine(validBalance),
  )
  .min(1)
  .max(100)
  .refine(ordered);
const intakeLines = z
  .array(
    z
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
          returnMilli(b.quantity) ===
          returnMilli(b.held_quantity) +
            returnMilli(b.disposed_quantity) +
            returnMilli(b.restocked_quantity),
      ),
  )
  .min(1)
  .max(100)
  .refine(ordered);
const intake = z
  .object({
    id: uuid,
    sequence: positive,
    custody,
    package_condition: condition,
    storage_history: storage,
    allocations: intakeLines,
  })
  .strict();
const replay = z
  .object({
    allocations: z
      .array(replayBalance.refine(validBalance))
      .min(1)
      .max(100)
      .refine(ordered),
    intakes: z.array(z.object({ id: uuid, allocations: intakeLines }).strict()),
    correction_remaining: z.array(
      z
        .object({
          event_id: uuid,
          allocations: z
            .array(
              z.object({ allocation_id: uuid, quantity: decimal }).strict(),
            )
            .min(1)
            .max(100)
            .refine(ordered),
        })
        .strict(),
    ),
    historical: z
      .array(
        z
          .object({
            allocation_id: uuid,
            lot_id: uuid,
            gross_intake_quantity: historical,
            gross_disposed_quantity: historical,
            gross_restocked_quantity: historical,
            retracted_intake_quantity: historical,
            retracted_disposed_quantity: historical,
            retracted_restocked_quantity: historical,
          })
          .strict(),
      )
      .min(1)
      .max(100)
      .refine(ordered),
  })
  .strict();
const actorSchema = z
  .object({
    id: uuid,
    name: text(200),
    authority: z.enum(["active_staff", "active_dvm"]),
  })
  .strict();
const eventFields = {
  id: uuid,
  target,
  authorization_hash: hash,
  dispense_document_hash: hash,
  sequence: positive,
  prior_event_id: uuid.nullable(),
  prior_record_hash: hash.nullable(),
  actor: actorSchema,
  action: z.enum([
    "intake",
    "dispose",
    "restock",
    "retract_intake",
    "retract_disposal",
    "retract_restock",
  ]),
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
};
const event = z
  .union([
    z
      .object({
        ...eventFields,
        version: z.literal(1),
        action: z.enum(["intake", "dispose", "restock"]),
      })
      .strict(),
    z
      .object({
        ...eventFields,
        version: z.literal(2),
        correction_target: source.nullable(),
        discrepancy_id: uuid.nullable(),
        physical_attestations: physical,
      })
      .strict(),
  ])
  .superRefine((e, c) => {
    if (
      (e.sequence === 1) !==
        (e.prior_event_id === null && e.prior_record_hash === null) ||
      (e.sequence > 1 &&
        (e.prior_event_id === null || e.prior_record_hash === null))
    )
      c.addIssue({ code: "custom", message: "Invalid event predecessor" });
    if (e.version === 2 && !correctPhysical(e.action, e.physical_attestations))
      c.addIssue({ code: "custom", message: "Invalid physical attestation" });
  });
export const discrepancyIntentSchema = z
  .object({
    target,
    action: z.enum([
      "report",
      "note",
      "resolve_corrected",
      "resolve_confirmed_original",
    ]),
    case_id: uuid.nullable(),
    source,
    allocations: inputs,
    observation: text(4000),
    correction_ids: z
      .array(uuid)
      .max(100)
      .refine((ids) => ids.every((v, i) => i === 0 || ids[i - 1] < v)),
  })
  .strict()
  .refine(
    (i) =>
      (i.action === "report" ? i.case_id === null : i.case_id !== null) &&
      (i.action === "resolve_corrected"
        ? i.correction_ids.length > 0
        : i.correction_ids.length === 0),
  );
const discrepancyEvent = z
  .object({
    version: z.literal(1),
    id: uuid,
    target,
    sequence: positive,
    prior_event_id: uuid.nullable(),
    prior_record_hash: hash.nullable(),
    actor: actorSchema,
    action: z.enum([
      "report",
      "note",
      "resolve_corrected",
      "resolve_confirmed_original",
    ]),
    case_id: uuid,
    source,
    allocations: z
      .array(
        z
          .object({
            allocation_id: uuid,
            lot_id: uuid,
            quantity: decimal.refine((v) => returnMilli(v) > 0n),
          })
          .strict(),
      )
      .min(1)
      .max(100)
      .refine(ordered),
    observation: text(4000),
    correction_ids: z.array(uuid).max(100),
    return_head: head,
    reviewed_context_hash: hash,
    created_at: instant,
    record_hash: hash,
  })
  .strict();
const discrepancies = z
  .object({
    version: z.literal(1),
    head,
    open_case_count: integer,
    held_lot_ids: z.array(uuid),
    cases: z.array(
      z
        .object({
          id: uuid,
          source,
          allocations: z
            .array(
              z
                .object({
                  allocation_id: uuid,
                  lot_id: uuid,
                  quantity: decimal,
                })
                .strict(),
            )
            .min(1)
            .max(100)
            .refine(ordered),
          status: z.enum([
            "open",
            "resolved_corrected",
            "resolved_confirmed_original",
          ]),
          report: discrepancyEvent,
          decisions: z.array(discrepancyEvent),
        })
        .strict(),
    ),
  })
  .strict();
const pickup = z
  .object({
    id: uuid,
    document_hash: hash,
    picked_up_at: instant,
    recipient_name: text(200),
    recipient_relationship: text(200),
    actor_id: uuid,
  })
  .strict();
const stock = z
  .object({
    product: z
      .object({
        id: uuid,
        name: text(200),
        unit: text(50),
        active: z.boolean(),
        version: positive,
      })
      .strict(),
    lots: z
      .array(z.object({ lot_id: uuid, balance: decimal }).strict())
      .min(1)
      .max(100),
    practice_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict();
const context = z
  .object({
    version: z.literal(2),
    target,
    authorization_hash: hash,
    dispense_document_hash: hash,
    dispensed_at: instant,
    head,
    discrepancy_head: head,
    original_pickup: pickup.nullable(),
    correction_head: head,
    allocations: balances,
    intake: intake.nullable(),
    replay,
    discrepancies,
    stock_review: stock.nullable(),
    policy: returnPolicySchema.nullable(),
    intent: reconciliationIntentSchema,
  })
  .strict();
const preview = z
  .object({
    version: z.literal(2),
    actor_id: uuid,
    observed_at: instant,
    context,
    context_hash: hash,
    allowed: z.boolean(),
    blockers: z.array(text(100)),
  })
  .strict();
const receipt = z
  .object({
    version: z.literal(2),
    id: uuid,
    actor_id: uuid,
    request,
    request_hash: hash,
    result: event,
    created_at: instant,
  })
  .strict();
const read = z
  .object({
    version: z.literal(2),
    target,
    authorization_hash: hash,
    dispense_document_hash: hash,
    dispensed_at: instant,
    head,
    allocations: balances,
    replay,
    discrepancies,
  })
  .strict();
const page = z
  .object({
    version: z.literal(2),
    target,
    head,
    discrepancy_head: head,
    events: z.array(event).max(100),
    next_before_version: positive.nullable(),
  })
  .strict();
const discrepancyRequest = z
  .object({
    intent: discrepancyIntentSchema,
    expected_context_hash: hash,
    expected_return_head: head,
    expected_discrepancy_head: head,
    attest_physical_review: z.literal(true),
    attest_original_quantities_custody_and_stock_accurate: z.boolean(),
  })
  .strict()
  .refine(
    (q) =>
      q.attest_original_quantities_custody_and_stock_accurate ===
      (q.intent.action === "resolve_confirmed_original"),
  );
const discrepancyPreview = z
  .object({
    version: z.literal(1),
    actor_id: uuid,
    observed_at: instant,
    context: z
      .object({
        version: z.literal(1),
        target,
        return_head: head,
        discrepancy_head: head,
        source: event,
        replay,
        discrepancies,
        intent: discrepancyIntentSchema,
      })
      .strict(),
    context_hash: hash,
    allowed: z.boolean(),
    blockers: z.array(text(100)),
  })
  .strict();
const discrepancyReceipt = z
  .object({
    version: z.literal(1),
    id: uuid,
    actor_id: uuid,
    request: discrepancyRequest,
    request_hash: hash,
    result: discrepancyEvent,
    created_at: instant,
  })
  .strict();
function ensure(value: unknown): asserts value {
  if (!value)
    throw new Error(
      "Reconciliation evidence does not match this exact reviewed record.",
    );
}
const equal = correctionEqual;
function micros(s: string) {
  const f = s.match(/\.(\d+)(?:Z|[+-]\d\d:\d\d)$/)?.[1] ?? "";
  return BigInt(Date.parse(s)) * 1000n + BigInt(f.padEnd(6, "0").slice(3));
}
function stateCheck(
  s: z.infer<typeof discrepancies>,
  t: z.infer<typeof target>,
) {
  validateDiscrepancyStateShape(
    s as ReturnDiscrepancyState,
    t as ReturnDiscrepancyState["cases"][number]["report"]["target"],
  );
  ensure(
    s.open_case_count === s.cases.filter((c) => c.status === "open").length,
  );
  ensure(new Set(s.cases.map((c) => c.id)).size === s.cases.length);
  const lots = [
    ...new Set(
      s.cases
        .filter((c) => c.status === "open")
        .flatMap((c) => c.allocations.map((a) => a.lot_id)),
    ),
  ].sort();
  ensure(equal(lots, s.held_lot_ids));
  const events = s.cases
    .flatMap((c) => {
      ensure(
        c.id === c.report.id &&
          c.report.case_id === c.id &&
          c.report.action === "report" &&
          equal(c.source, c.report.source) &&
          equal(c.allocations, c.report.allocations),
      );
      c.decisions.forEach((e) =>
        ensure(
          e.case_id === c.id &&
            equal(e.source, c.source) &&
            equal(e.allocations, c.allocations),
        ),
      );
      const last = c.decisions.at(-1);
      ensure(
        c.status ===
          (last?.action === "resolve_corrected"
            ? "resolved_corrected"
            : last?.action === "resolve_confirmed_original"
              ? "resolved_confirmed_original"
              : "open"),
      );
      return [c.report, ...c.decisions];
    })
    .sort((a, b) => a.sequence - b.sequence);
  ensure(events.length === s.head.version);
  events.forEach((e, i) => {
    ensure(
      equal(e.target, t) &&
        e.sequence === i + 1 &&
        e.prior_event_id === (events[i - 1]?.id ?? null) &&
        e.prior_record_hash === (events[i - 1]?.record_hash ?? null),
    );
    if (i) ensure(micros(e.created_at) >= micros(events[i - 1].created_at));
  });
  ensure(
    (events.at(-1)?.id ?? null) === s.head.event_id &&
      (events.at(-1)?.record_hash ?? null) === s.head.record_hash,
  );
}
function replayCheck(r: z.infer<typeof replay>, a: z.infer<typeof balances>) {
  validateReconciliationReplayShape(r as ReconciliationRead["replay"]);
  ensure(
    equal(
      r.allocations,
      a.map(({ lot_number: _, expires_on: __, ...rest }) => rest),
    ),
  );
  ensure(
    new Set(r.intakes.map((i) => i.id)).size === r.intakes.length &&
      new Set(r.correction_remaining.map((i) => i.event_id)).size ===
        r.correction_remaining.length,
  );
  for (const i of r.intakes)
    for (const x of i.allocations)
      ensure(
        a.some(
          (b) => b.allocation_id === x.allocation_id && b.lot_id === x.lot_id,
        ),
      );
}
export function createNativeReconciliationApi(
  client: PrescriptionRpc,
  actor: string,
  t: z.infer<typeof target>,
) {
  uuid.parse(actor);
  target.parse(t);
  const args = {
    p_authorization_id: t.authorization_id,
    p_pet_id: t.pet_id,
    p_dispense_id: t.dispense_id,
  };
  const contexts = new Map<string, z.infer<typeof context>>();
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const { data, error } = await client.rpc(name, args);
    if (error) throw error;
    return data;
  };
  function parsedRequest(op: Readonly<PrescriptionOperation>) {
    uuid.parse(op.id);
    ensure(op.kind === "record_return_v2");
    const q = request.parse(op.payload);
    ensure(equal(q.intent.target, t));
    return q;
  }
  function validatedReceipt(
    raw: unknown,
    op: Readonly<PrescriptionOperation>,
  ): ReconciliationReceipt {
    const q = parsedRequest(op),
      r = receipt.parse(raw),
      e = r.result;
    validateReconciliationEventShape(e as ReconciliationHistoryEvent);
    ensure(
      e.version === 2 &&
        r.id === op.id &&
        e.id === op.id &&
        r.actor_id === actor &&
        e.actor.id === actor &&
        equal(r.request, q) &&
        equal(e.target, t) &&
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
      "correction_target",
      "discrepancy_id",
    ] as const)
      ensure(equal(e[k], q.intent[k]));
    ensure(equal(e.physical_attestations, q.physical_attestations));
    ensure(e.allocations.length === q.intent.allocations.length);
    e.allocations.forEach((a, i) =>
      ensure(
        a.allocation_id === q.intent.allocations[i].allocation_id &&
          returnMilli(a.quantity) ===
            returnMilli(q.intent.allocations[i].quantity),
      ),
    );
    const c = contexts.get(q.expected_context_hash);
    if (c) {
      ensure(
        e.authorization_hash === c.authorization_hash &&
          e.dispense_document_hash === c.dispense_document_hash &&
          micros(e.created_at) >= micros(c.dispensed_at),
      );
      e.allocations.forEach((a) =>
        ensure(
          c.allocations.some(
            (b) => b.allocation_id === a.allocation_id && b.lot_id === a.lot_id,
          ),
        ),
      );
      ensure(equal(e.policy, c.policy));
    }
    return r as ReconciliationReceipt;
  }
  return {
    async read(): Promise<ReconciliationRead | null> {
      const raw = await rpc("read_native_dispense_returns_v2", args);
      if (raw === null) return null;
      const r = read.parse(raw);
      ensure(equal(r.target, t));
      replayCheck(r.replay, r.allocations);
      stateCheck(r.discrepancies, t);
      return r as ReconciliationRead;
    },
    async readIntake(id: string): Promise<ReconciliationIntakeRead | null> {
      uuid.parse(id);
      const raw = await rpc("read_native_return_intake_v2", {
        ...args,
        p_intake_id: id,
      });
      if (raw === null) return null;
      const r = z
        .object({
          version: z.literal(2),
          target,
          head,
          discrepancy_head: head,
          intake,
        })
        .strict()
        .parse(raw);
      ensure(
        equal(r.target, t) &&
          r.intake.id === id &&
          r.intake.sequence <= r.head.version,
      );
      return r as ReconciliationIntakeRead;
    },
    async preview(value: unknown): Promise<ReconciliationPreview> {
      const i = reconciliationIntentSchema.parse(value);
      ensure(equal(i.target, t));
      const p = preview.parse(
          await rpc("preview_native_dispense_return_v2", { p_intent: i }),
        ),
        c = p.context;
      ensure(
        p.actor_id === actor &&
          equal(c.target, t) &&
          equal(c.intent, i) &&
          p.allowed === (p.blockers.length === 0) &&
          new Set(p.blockers).size === p.blockers.length &&
          micros(p.observed_at) >= micros(c.dispensed_at),
      );
      stateCheck(c.discrepancies, t);
      ensure(equal(c.discrepancy_head, c.discrepancies.head));
      replayCheck(c.replay, c.allocations);
      ensure(
        i.action === "intake"
          ? c.intake === null
          : c.intake?.id === i.intake_id,
      );
      if (c.intake) {
        const effective = c.replay.intakes.find((v) => v.id === c.intake!.id);
        ensure(
          effective &&
            equal(effective.allocations, c.intake.allocations) &&
            c.intake.sequence <= c.head.version,
        );
      }
      const correction = i.correction_target
        ? c.replay.correction_remaining.find(
            (r) => r.event_id === i.correction_target!.event_id,
          )
        : null;
      for (const a of i.allocations) {
        const b = c.allocations.find(
          (b) => b.allocation_id === a.allocation_id,
        );
        ensure(b);
        const held = c.intake?.allocations.find(
          (b) => b.allocation_id === a.allocation_id,
        )?.held_quantity;
        const available =
          i.action === "intake"
            ? b.remaining_returnable_quantity
            : i.action.startsWith("retract_")
              ? correction?.allocations.find(
                  (b) => b.allocation_id === a.allocation_id,
                )?.quantity
              : held;
        ensure(
          available !== undefined &&
            returnMilli(a.quantity) <= returnMilli(available),
        );
        if (i.action === "retract_intake")
          ensure(
            held !== undefined && returnMilli(a.quantity) <= returnMilli(held),
          );
      }
      ensure((i.action === "restock") === (c.policy !== null));
      ensure(
        ["restock", "retract_restock"].includes(i.action) ===
          (c.stock_review !== null),
      );
      if (c.stock_review) {
        const lots = i.allocations
          .map(
            (a) =>
              c.allocations.find((b) => b.allocation_id === a.allocation_id)!
                .lot_id,
          )
          .sort();
        ensure(
          equal(
            lots,
            c.stock_review.lots.map((l) => l.lot_id),
          ),
        );
        if (i.action === "retract_restock") {
          const insufficient = i.allocations.some(
            (a) =>
              returnMilli(a.quantity) >
              returnMilli(
                c.stock_review!.lots.find(
                  (l) =>
                    l.lot_id ===
                    c.allocations.find(
                      (b) => b.allocation_id === a.allocation_id,
                    )!.lot_id,
                )!.balance,
              ),
          );
          ensure(
            p.blockers.includes("insufficient_available_stock") ===
              insufficient,
          );
        }
      }
      if (i.action === "restock") {
        const facts = {
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
          lot_review_hold: i.allocations.some((a) =>
            c.discrepancies.held_lot_ids.includes(
              c.allocations.find((b) => b.allocation_id === a.allocation_id)!
                .lot_id,
            ),
          ),
        };
        for (const [code, blocked] of Object.entries(facts))
          ensure(
            code === "lot_review_hold"
              ? !blocked || p.blockers.includes(code)
              : p.blockers.includes(code) === blocked,
          );
      }
      contexts.set(p.context_hash, c);
      return p as ReconciliationPreview;
    },
    async history(
      before: number | null = null,
      limit = 25,
    ): Promise<ReconciliationPage> {
      if (before !== null) positive.parse(before);
      z.number().int().min(1).max(100).parse(limit);
      const p = page.parse(
        await rpc("list_native_dispense_returns_v2", {
          ...args,
          p_before_version: before,
          p_limit: limit,
        }),
      );
      ensure(equal(p.target, t) && p.events.length <= limit);
      p.events.forEach((e, i) => {
        validateReconciliationEventShape(e as ReconciliationHistoryEvent);
        ensure(
          equal(e.target, t) &&
            e.sequence <= p.head.version &&
            (before === null || e.sequence < before),
        );
        if (i)
          ensure(
            p.events[i - 1].sequence === e.sequence + 1 &&
              p.events[i - 1].prior_event_id === e.id &&
              p.events[i - 1].prior_record_hash === e.record_hash,
          );
        if (e.sequence === p.head.version)
          ensure(
            e.id === p.head.event_id && e.record_hash === p.head.record_hash,
          );
      });
      if (before === null)
        ensure(
          p.head.version === 0
            ? p.events.length === 0
            : p.events[0]?.sequence === p.head.version,
        );
      if (p.next_before_version !== null)
        ensure(
          p.events.length === limit &&
            p.next_before_version === p.events.at(-1)?.sequence &&
            p.next_before_version > 1,
        );
      else if (p.events.length) ensure(p.events.at(-1)?.sequence === 1);
      return p as ReconciliationPage;
    },
    async execute(op: Readonly<PrescriptionOperation>) {
      const q = parsedRequest(op);
      return validatedReceipt(
        await rpc("record_native_dispense_return_v2", {
          p_id: op.id,
          p_request: q,
        }),
        op,
      );
    },
    async recover(op: Readonly<PrescriptionOperation>) {
      parsedRequest(op);
      const raw = await rpc("recover_native_dispense_return_v2", {
        p_id: op.id,
      });
      return raw === null ? null : validatedReceipt(raw, op);
    },
  };
}
export function createNativeReturnDiscrepancyApi(
  client: PrescriptionRpc,
  actor: string,
  t: z.infer<typeof target>,
) {
  uuid.parse(actor);
  target.parse(t);
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const { data, error } = await client.rpc(name, args);
    if (error) throw error;
    return data;
  };
  const contexts = new Map<
    string,
    z.infer<typeof discrepancyPreview>["context"]
  >();
  function requestFor(op: Readonly<PrescriptionOperation>) {
    uuid.parse(op.id);
    ensure(op.kind === "record_return_discrepancy");
    const q = discrepancyRequest.parse(op.payload);
    ensure(equal(q.intent.target, t));
    return q;
  }
  function receiptFor(
    raw: unknown,
    op: Readonly<PrescriptionOperation>,
  ): ReturnDiscrepancyReceipt {
    const q = requestFor(op),
      r = discrepancyReceipt.parse(raw),
      e = r.result;
    validateDiscrepancyEventShape(
      e as ReturnDiscrepancyReceipt["result"],
      t as ReturnDiscrepancyReceipt["result"]["target"],
    );
    ensure(
      r.id === op.id &&
        e.id === op.id &&
        r.actor_id === actor &&
        e.actor.id === actor &&
        equal(r.request, q) &&
        equal(e.target, t) &&
        e.action === q.intent.action &&
        e.case_id === (q.intent.case_id ?? op.id) &&
        equal(e.source, q.intent.source) &&
        e.observation === q.intent.observation &&
        equal(e.correction_ids, q.intent.correction_ids) &&
        equal(e.return_head, q.expected_return_head) &&
        e.sequence === q.expected_discrepancy_head.version + 1 &&
        e.prior_event_id === q.expected_discrepancy_head.event_id &&
        e.prior_record_hash === q.expected_discrepancy_head.record_hash &&
        e.reviewed_context_hash === q.expected_context_hash &&
        micros(e.created_at) === micros(r.created_at),
    );
    ensure(e.allocations.length === q.intent.allocations.length);
    e.allocations.forEach((a, i) =>
      ensure(
        a.allocation_id === q.intent.allocations[i].allocation_id &&
          returnMilli(a.quantity) ===
            returnMilli(q.intent.allocations[i].quantity),
      ),
    );
    const reviewed = contexts.get(q.expected_context_hash);
    if (reviewed) {
      ensure(micros(e.created_at) >= micros(reviewed.source.created_at));
      e.allocations.forEach((a) =>
        ensure(
          reviewed.source.allocations.some(
            (b) => b.allocation_id === a.allocation_id && b.lot_id === a.lot_id,
          ),
        ),
      );
    }
    if (e.action === "resolve_confirmed_original")
      ensure(e.actor.authority === "active_dvm");
    return r as ReturnDiscrepancyReceipt;
  }
  return {
    async preview(value: unknown): Promise<ReturnDiscrepancyPreview> {
      const i = discrepancyIntentSchema.parse(value);
      ensure(equal(i.target, t));
      const p = discrepancyPreview.parse(
          await rpc("preview_native_return_discrepancy", { p_intent: i }),
        ),
        c = p.context;
      validateReconciliationEventShape(c.source as ReconciliationHistoryEvent);
      ensure(
        p.actor_id === actor &&
          equal(c.target, t) &&
          equal(c.intent, i) &&
          c.source.id === i.source.event_id &&
          c.source.record_hash === i.source.record_hash &&
          equal(c.source.target, t) &&
          equal(c.discrepancy_head, c.discrepancies.head) &&
          p.allowed === (p.blockers.length === 0) &&
          new Set(p.blockers).size === p.blockers.length,
      );
      stateCheck(c.discrepancies, t);
      if (i.case_id)
        ensure(
          c.discrepancies.cases.some(
            (k) =>
              k.id === i.case_id &&
              k.status === "open" &&
              equal(k.source, i.source),
          ),
        );
      ensure(micros(p.observed_at) >= micros(c.source.created_at));
      const caseRecord = i.case_id
        ? c.discrepancies.cases.find((k) => k.id === i.case_id)
        : null;
      if (caseRecord)
        ensure(caseRecord.allocations.length === i.allocations.length);
      for (const a of i.allocations) {
        const b = c.source.allocations.find(
          (b) => b.allocation_id === a.allocation_id,
        );
        ensure(b && returnMilli(a.quantity) <= returnMilli(b.quantity));
        if (caseRecord) {
          const fixed = caseRecord.allocations.find(
            (b) => b.allocation_id === a.allocation_id,
          );
          ensure(
            fixed && returnMilli(fixed.quantity) === returnMilli(a.quantity),
          );
        }
      }
      contexts.set(p.context_hash, c);
      return p as ReturnDiscrepancyPreview;
    },
    async execute(op: Readonly<PrescriptionOperation>) {
      const q = requestFor(op);
      return receiptFor(
        await rpc("record_native_return_discrepancy", {
          p_id: op.id,
          p_request: q,
        }),
        op,
      );
    },
    async recover(op: Readonly<PrescriptionOperation>) {
      requestFor(op);
      const raw = await rpc("recover_native_return_discrepancy", {
        p_id: op.id,
      });
      return raw === null ? null : receiptFor(raw, op);
    },
  };
}
export type ReconciliationHistoryEvent = ReturnEvent | ReconciliationEvent;
