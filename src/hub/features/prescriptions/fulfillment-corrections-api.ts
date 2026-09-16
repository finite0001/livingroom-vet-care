import { z } from "zod";
import type { PrescriptionRpc } from "./prescription-api.ts";
import type { PrescriptionOperation } from "./prescription-state.ts";
const uuid = z.string().uuid(),
  hash = z.string().regex(/^[a-f0-9]{64}$/);
const sequence = z.number().int().min(1).max(2147483647);
const instant = z
  .string()
  .datetime({ offset: true })
  .refine((v) => Number.isFinite(Date.parse(v)) && !/\.\d{7}/.test(v));
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
          return n === 127 || (n < 32 && n !== 9 && n !== 10);
        }),
    );
export const correctionTargetSchema = z
  .object({ authorization_id: uuid, pet_id: uuid, dispense_id: uuid })
  .strict();
export const correctionHeadSchema = z
  .object({
    event_id: uuid.nullable(),
    version: z.number().int().min(0).max(2147483647),
    record_hash: hash.nullable(),
  })
  .strict()
  .refine((h) =>
    h.version === 0
      ? h.event_id === null && h.record_hash === null
      : h.event_id !== null && h.record_hash !== null,
  );
const handoffSchema = z
  .object({
    picked_up_at: instant,
    recipient_name: text(200),
    recipient_relationship: text(200),
  })
  .strict();
const pickupSchema = z
  .object({
    original_pickup_id: uuid,
    disposition: z.enum(["recorded_in_error", "corrected_handoff"]),
    handoff: handoffSchema.nullable(),
  })
  .strict()
  .refine((p) =>
    p.disposition === "recorded_in_error"
      ? p.handoff === null
      : p.handoff !== null,
  );
const originalPickupSchema = handoffSchema
  .extend({ id: uuid, document_hash: hash, actor_id: uuid })
  .strict();
const latestSchema = z
  .object({ event_id: uuid, version: sequence, value: pickupSchema })
  .strict();
export const correctionContextSchema = z
  .object({
    version: z.literal(1),
    target: correctionTargetSchema,
    authorization_hash: hash,
    dispense_document_hash: hash,
    dispense_artifact_hash: hash,
    dispensed_at: instant,
    original_pickup: originalPickupSchema.nullable(),
    head: correctionHeadSchema,
    latest_pickup_amendment: latestSchema.nullable(),
  })
  .strict();
const kindSchema = z.enum([
  "clinical_annotation",
  "operational_annotation",
  "pickup_amendment",
]);
export const correctionRequestSchema = correctionTargetSchema
  .extend({
    kind: kindSchema,
    expected_context_hash: hash,
    expected_head: correctionHeadSchema,
    reason: text(2000),
    note: text(4000),
    amends_event_id: uuid.nullable(),
    pickup_amendment: pickupSchema.nullable(),
    attest_review: z.literal(true),
  })
  .strict()
  .refine((r) =>
    r.kind === "pickup_amendment"
      ? r.pickup_amendment !== null
      : r.pickup_amendment === null,
  )
  .refine((r) =>
    [
      r.authorization_id,
      r.pet_id,
      r.dispense_id,
      r.amends_event_id,
      r.expected_head.event_id,
      r.pickup_amendment?.original_pickup_id,
    ].every((value) => value == null || value === value.toLowerCase()),
  );
export const correctionEventSchema = z
  .object({
    version: z.literal(1),
    id: uuid,
    target: correctionTargetSchema,
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
    kind: kindSchema,
    reason: text(2000),
    note: text(4000),
    amends_event_id: uuid.nullable(),
    pickup_amendment: pickupSchema.nullable(),
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
      (e.kind === "pickup_amendment"
        ? e.pickup_amendment !== null
        : e.pickup_amendment === null) &&
      (e.kind !== "clinical_annotation" || e.actor.authority === "active_dvm"),
  );
const previewSchema = z
  .object({
    version: z.literal(1),
    actor_id: uuid,
    context: correctionContextSchema,
    context_hash: hash,
    observed_at: instant,
  })
  .strict();
const readSchema = z
  .object({
    version: z.literal(1),
    context: correctionContextSchema,
    context_hash: hash,
  })
  .strict();
const pageSchema = z
  .object({
    version: z.literal(1),
    target: correctionTargetSchema,
    head: correctionHeadSchema,
    events: z.array(correctionEventSchema).max(100),
    next_before_version: sequence.nullable(),
  })
  .strict();
const receiptSchema = z
  .object({
    version: z.literal(1),
    id: uuid,
    actor_id: uuid,
    request: correctionRequestSchema,
    request_hash: hash,
    result: correctionEventSchema,
    created_at: instant,
  })
  .strict();
export type CorrectionTarget = z.infer<typeof correctionTargetSchema>;
export type CorrectionContext = z.infer<typeof correctionContextSchema>;
export type CorrectionPreview = z.infer<typeof previewSchema>;
export type CorrectionRequest = z.infer<typeof correctionRequestSchema>;
export type CorrectionEvent = z.infer<typeof correctionEventSchema>;
export type CorrectionReceipt = z.infer<typeof receiptSchema>;
export function correctionEqual(a: unknown, b: unknown): boolean {
  const canonical = (v: unknown): string =>
    JSON.stringify(
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
  return canonical(a) === canonical(b);
}
function requireMatch(ok: unknown): asserts ok {
  if (!ok)
    throw new Error(
      "Correction evidence does not match this exact reviewed record.",
    );
}
function micros(value: string) {
  const fraction = value.match(/\.(\d+)(?:Z|[+-]\d\d:\d\d)$/)?.[1] ?? "";
  return (
    BigInt(Date.parse(value)) * 1000n + BigInt(fraction.padEnd(6, "0").slice(3))
  );
}
export function createFulfillmentCorrectionsApi(
  client: PrescriptionRpc,
  actor: string,
  target: CorrectionTarget,
) {
  const reviewedContexts = new Map<string, CorrectionContext>();
  uuid.parse(actor);
  correctionTargetSchema.parse(target);
  const args = {
    p_authorization_id: target.authorization_id,
    p_pet_id: target.pet_id,
    p_dispense_id: target.dispense_id,
  };
  async function rpc(name: string, args: Record<string, unknown>) {
    const { data, error } = await client.rpc(name, args);
    if (error) throw error;
    return data;
  }
  function context(c: CorrectionContext) {
    requireMatch(correctionEqual(c.target, target));
    if (c.original_pickup)
      requireMatch(
        micros(c.original_pickup.picked_up_at) >= micros(c.dispensed_at),
      );
    const latest = c.latest_pickup_amendment;
    if (latest)
      requireMatch(
        c.original_pickup &&
          latest.value.original_pickup_id === c.original_pickup.id &&
          latest.version <= c.head.version &&
          (latest.version !== c.head.version ||
            latest.event_id === c.head.event_id),
      );
  }
  function operation(op: Readonly<PrescriptionOperation>) {
    uuid.parse(op.id);
    requireMatch(op.kind === "append_correction");
    const request = correctionRequestSchema.parse(op.payload);
    requireMatch(
      correctionEqual(
        {
          authorization_id: request.authorization_id,
          pet_id: request.pet_id,
          dispense_id: request.dispense_id,
        },
        target,
      ),
    );
    return request;
  }
  function receipt(value: unknown, op: Readonly<PrescriptionOperation>) {
    const request = operation(op),
      r = receiptSchema.parse(value),
      e = r.result;
    const reviewed = reviewedContexts.get(request.expected_context_hash);
    if (reviewed) {
      requireMatch(
        e.authorization_hash === reviewed.authorization_hash &&
          e.dispense_document_hash === reviewed.dispense_document_hash &&
          micros(e.created_at) >= micros(reviewed.dispensed_at),
      );
      if (e.pickup_amendment)
        requireMatch(
          e.pickup_amendment.original_pickup_id ===
            reviewed.original_pickup?.id &&
            e.amends_event_id ===
              (reviewed.latest_pickup_amendment?.event_id ?? null),
        );
      if (e.pickup_amendment?.handoff)
        requireMatch(
          micros(e.pickup_amendment.handoff.picked_up_at) >=
            micros(reviewed.dispensed_at),
        );
    }
    requireMatch(
      r.id === op.id &&
        e.id === op.id &&
        r.actor_id === actor &&
        e.actor.id === actor &&
        correctionEqual(r.request, request) &&
        correctionEqual(e.target, target),
    );
    requireMatch(
      e.sequence === request.expected_head.version + 1 &&
        e.prior_event_id === request.expected_head.event_id &&
        e.prior_record_hash === request.expected_head.record_hash &&
        e.reviewed_context_hash === request.expected_context_hash &&
        micros(e.created_at) === micros(r.created_at),
    );
    for (const key of [
      "kind",
      "reason",
      "note",
      "amends_event_id",
      "pickup_amendment",
    ] as const)
      requireMatch(correctionEqual(e[key], request[key]));
    if (e.pickup_amendment?.handoff)
      requireMatch(
        micros(e.pickup_amendment.handoff.picked_up_at) <= micros(e.created_at),
      );
    return r;
  }
  return {
    async preview() {
      const p = previewSchema.parse(
        await rpc("preview_native_dispense_correction", args),
      );
      context(p.context);
      reviewedContexts.set(p.context_hash, p.context);
      requireMatch(
        p.actor_id === actor &&
          micros(p.observed_at) >= micros(p.context.dispensed_at),
      );
      return p;
    },
    async read() {
      const raw = await rpc("read_native_dispense_corrections", args);
      if (raw === null) return null;
      const r = readSchema.parse(raw);
      context(r.context);
      return r;
    },
    async history(before: number | null = null, limit = 25) {
      if (before !== null) sequence.parse(before);
      z.number().int().min(1).max(100).parse(limit);
      const raw = await rpc("list_native_dispense_corrections", {
        ...args,
        p_before_version: before,
        p_limit: limit,
      });
      if (raw === null) return null;
      const p = pageSchema.parse(raw);
      requireMatch(
        correctionEqual(p.target, target) && p.events.length <= limit,
      );
      p.events.forEach((e, i) => {
        requireMatch(
          correctionEqual(e.target, target) &&
            e.sequence <= p.head.version &&
            (before === null || e.sequence < before),
        );
        if (i > 0)
          requireMatch(
            p.events[i - 1].sequence === e.sequence + 1 &&
              p.events[i - 1].prior_event_id === e.id &&
              p.events[i - 1].prior_record_hash === e.record_hash,
          );
        if (e.sequence === p.head.version)
          requireMatch(
            e.id === p.head.event_id && e.record_hash === p.head.record_hash,
          );
      });
      if (before === null)
        requireMatch(
          p.head.version === 0
            ? p.events.length === 0
            : p.events[0]?.sequence === p.head.version,
        );
      if (p.next_before_version !== null)
        requireMatch(
          p.events.length === limit &&
            p.next_before_version === p.events.at(-1)?.sequence &&
            p.next_before_version > 1,
        );
      else if (p.events.length) requireMatch(p.events.at(-1)?.sequence === 1);
      return p;
    },
    async execute(op: Readonly<PrescriptionOperation>) {
      const request = operation(op);
      return receipt(
        await rpc("append_native_dispense_correction", {
          p_id: op.id,
          p_request: request,
        }),
        op,
      );
    },
    async recover(op: Readonly<PrescriptionOperation>) {
      operation(op);
      const raw = await rpc("recover_native_dispense_correction", {
        p_id: op.id,
      });
      return raw === null ? null : receipt(raw, op);
    },
  };
}
