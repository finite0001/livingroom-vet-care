import { z } from "zod";
const uuid = z.string().uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const positive = z.number().int().positive();
const timestamp = z.string().refine((v) => Number.isFinite(Date.parse(v)));
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const date = new Date(`${v}T12:00:00Z`);
    return (
      Number(v.slice(0, 4)) >= 1 &&
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === v
    );
  }, "Use a real calendar date");
const dateStatus = z.enum(["date", "unknown", "uninterpreted"]);
const reviewedVaccinationFields = z.object({
  administered_on: calendarDate.nullable(),
  administration_date_status: dateStatus,
  source_next_due_on: calendarDate.nullable(),
  next_date_status: dateStatus,
  status: z.enum(["administered", "not_administered", "unknown"]),
  outside_author: z.string().trim().min(1).max(500).nullable(),
});
export const reviewedVaccinationSchema = reviewedVaccinationFields.superRefine(
  (v, ctx) => {
    if (
      (v.administration_date_status === "date") !==
        (v.administered_on !== null) ||
      (v.next_date_status === "date") !== (v.source_next_due_on !== null)
    )
      ctx.addIssue({
        code: "custom",
        message: "Reviewed dates and their interpretation differ",
      });
  },
);
export const vaccinationReviewPayloadSchema = reviewedVaccinationFields
  .extend({
    animal_link_id: uuid,
    patient_version: positive,
    snapshot_id: uuid,
    payload_hash: hash,
    observed_head_version: positive,
    consult_snapshot_id: uuid,
    consult_payload_hash: hash,
    consult_observed_head_version: positive,
    product_id: uuid.nullable(),
    product_version: positive.nullable(),
    reason: z.string().trim().min(5).max(2000),
    replaces_id: uuid.nullable(),
    expected_predecessor_hash: hash.nullable(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      (v.administration_date_status === "date") !==
        (v.administered_on !== null) ||
      (v.next_date_status === "date") !== (v.source_next_due_on !== null) ||
      (v.product_id === null) !== (v.product_version === null) ||
      (v.replaces_id === null) !== (v.expected_predecessor_hash === null)
    )
      ctx.addIssue({
        code: "custom",
        message: "Explicit review values and their context differ",
      });
  });
export type VaccinationReviewPayload = z.infer<
  typeof vaccinationReviewPayloadSchema
>;
export const reviewCursorSchema = z.object({
  before_at: timestamp,
  before_id: uuid,
});
export type ReviewCursor = z.infer<typeof reviewCursorSchema>;
export const importedVaccinationSchema = z.object({
  id: uuid,
  pet_id: uuid,
  animal_link_id: uuid,
  client_id: uuid,
  version: positive,
  version_hash: hash,
  source: z.object({
    origin: z.string().url(),
    site_uid: z.string(),
    animal_id: z.string(),
    vaccination_id: z.string(),
  }),
  snapshot_id: uuid,
  payload_hash: hash,
  observed_head_version: positive,
  original: z.record(z.unknown()),
  consult: z.object({
    snapshot_id: uuid,
    payload_hash: hash,
    observed_head_version: positive,
    external_id: z.string(),
  }),
  reviewed: reviewedVaccinationSchema,
  product: z
    .object({
      id: uuid,
      version: positive,
      name: z.string(),
      kind: z.literal("vaccine"),
    })
    .nullable(),
  reason: z.string(),
  replaces_id: uuid.nullable(),
  expected_predecessor_hash: hash.nullable(),
  approved_by: uuid,
  approved_at: timestamp,
  current: z.object({
    is_current: z.boolean(),
    is_latest: z.boolean(),
    snapshot_id: uuid.nullable(),
    head_version: positive.nullable(),
    consult_snapshot_id: uuid.nullable(),
    consult_head_version: positive.nullable(),
    identity_valid: z.boolean(),
  }),
  correction_history: z.array(
    z.object({
      id: uuid,
      version: positive,
      version_hash: hash,
      replaces_id: uuid.nullable(),
      reason: z.string(),
      approved_by: uuid,
      approved_at: timestamp,
    }),
  ),
});
export type ImportedVaccination = z.infer<typeof importedVaccinationSchema>;
export const vaccinationReviewContextSchema = importedVaccinationSchema.pick({
  pet_id: true,
  client_id: true,
  animal_link_id: true,
  source: true,
  snapshot_id: true,
  payload_hash: true,
  observed_head_version: true,
  original: true,
  consult: true,
  reviewed: true,
  product: true,
});
const requestSchema = z.object({
  id: uuid,
  actor_id: uuid,
  pet_id: uuid,
  status: z.enum(["prepared", "approved", "abandoned"]),
  payload: vaccinationReviewPayloadSchema.nullable(),
  request_hash: hash.nullable(),
  review_context: vaccinationReviewContextSchema.nullable(),
  created_at: timestamp,
  resolved_at: timestamp.nullable(),
  approved_record_id: uuid.nullable(),
});
const envelopeSchema = z.object({
  request: requestSchema,
  receipt: importedVaccinationSchema.nullable(),
});
export type VaccinationReviewEnvelope = z.infer<typeof envelopeSchema>;
export function sameReviewPayload(a: unknown, b: unknown): boolean {
  const canonical = (v: unknown): string =>
    v !== null && typeof v === "object"
      ? Array.isArray(v)
        ? `[${v.map(canonical).join(",")}]`
        : `{${Object.entries(v)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, value]) => `${JSON.stringify(k)}:${canonical(value)}`)
            .join(",")}}`
      : JSON.stringify(v);
  return canonical(a) === canonical(b);
}
export function parseVaccinationReview(
  value: unknown,
  actor: string,
  pet: string,
  id?: string,
  expected?: VaccinationReviewPayload | null,
) {
  if (value === null) return null;
  const e = envelopeSchema.parse(value),
    r = e.request;
  if (
    r.actor_id !== actor ||
    r.pet_id !== pet ||
    (id && r.id !== id) ||
    (expected && r.payload && !sameReviewPayload(r.payload, expected)) ||
    (r.status !== "abandoned" &&
      (!r.payload || !r.request_hash || !r.review_context)) ||
    (r.status === "approved"
      ? !e.receipt ||
        e.receipt.pet_id !== pet ||
        e.receipt.id !== r.approved_record_id
      : e.receipt !== null || r.approved_record_id !== null)
  )
    throw new Error(
      "Recovered vaccination review differs. Keep the original reference.",
    );
  if (r.payload && r.review_context) {
    const p = r.payload,
      c = r.review_context;
    if (
      String(c.original.id) !== c.source.vaccination_id ||
      String(c.original.consult_id) !== c.consult.external_id ||
      c.pet_id !== pet ||
      c.animal_link_id !== p.animal_link_id ||
      c.snapshot_id !== p.snapshot_id ||
      c.payload_hash !== p.payload_hash ||
      c.observed_head_version !== p.observed_head_version ||
      c.consult.snapshot_id !== p.consult_snapshot_id ||
      c.consult.payload_hash !== p.consult_payload_hash ||
      c.consult.observed_head_version !== p.consult_observed_head_version ||
      (c.product?.id ?? null) !== p.product_id ||
      (c.product?.version ?? null) !== p.product_version ||
      !sameReviewPayload(c.reviewed, reviewedVaccinationSchema.parse(p))
    )
      throw new Error(
        "Frozen vaccination evidence differs. Keep the original reference.",
      );
    if (
      e.receipt &&
      (!sameReviewPayload(vaccinationReviewContextSchema.parse(e.receipt), c) ||
        e.receipt.replaces_id !== p.replaces_id ||
        e.receipt.expected_predecessor_hash !== p.expected_predecessor_hash)
    )
      throw new Error(
        "Approved vaccination evidence differs. Keep the original reference.",
      );
  }
  return e;
}
export const vaccinationReviewIntentSchema = z
  .object({
    id: uuid,
    actor: uuid,
    pet: uuid,
    payload: vaccinationReviewPayloadSchema.nullable(),
  })
  .strict();
export type VaccinationReviewIntent = z.infer<
  typeof vaccinationReviewIntentSchema
>;
export function vaccinationReviewKey(actor: string, pet: string) {
  return `ezyvet-vaccination-review:${uuid.parse(actor)}:${uuid.parse(pet)}`;
}
export function readVaccinationReviewIntent(
  key: string,
): VaccinationReviewIntent | null {
  const raw = sessionStorage.getItem(key);
  if (!raw) return null;
  const value = vaccinationReviewIntentSchema.parse(JSON.parse(raw));
  if (vaccinationReviewKey(value.actor, value.pet) !== key)
    throw new Error("Retained review identity differs");
  return value;
}
export function saveVaccinationReviewIntent(value: VaccinationReviewIntent) {
  const valid = vaccinationReviewIntentSchema.parse(value);
  try {
    sessionStorage.setItem(
      vaccinationReviewKey(valid.actor, valid.pet),
      JSON.stringify(valid),
    );
  } catch {
    throw new Error(
      "Browser recovery storage unavailable. No review request was submitted.",
    );
  }
}
