import { z } from "zod";

export const soapFields = [
  "subjective",
  "objective",
  "assessment",
  "plan",
] as const;
export const uuid = z.string().uuid();
const version = z.number().int().min(1).max(2147483647);
const text = (maximum: number) =>
  z
    .string()
    .max(maximum)
    .refine((s) => !s.includes("\0"), "Null characters are not supported.");
const nonempty = (maximum: number) =>
  text(maximum).refine((s) => Boolean(s.trim()), "Enter nonempty text.");
const sectionSchema = z
  .object({ text: text(50000), quote: text(2000) })
  .strict();
export const sectionsSchema = z
  .object({
    subjective: sectionSchema,
    objective: sectionSchema,
    assessment: sectionSchema,
    plan: sectionSchema,
  })
  .strict();
export function emptySections(): z.infer<typeof sectionsSchema> {
  return {
    subjective: { text: "", quote: "" },
    objective: { text: "", quote: "" },
    assessment: { text: "", quote: "" },
    plan: { text: "", quote: "" },
  };
}
export const submitSchema = z
  .object({
    pet_id: uuid,
    encounter_id: uuid,
    expected_version: version.max(2147483646),
    transcript: nonempty(60000),
    source_note: nonempty(1000),
    attest_authorized: z.literal(true),
    sections: sectionsSchema,
  })
  .strict()
  .superRefine((value, context) => {
    let provided = 0;
    for (const field of soapFields) {
      const section = value.sections[field];
      if (section.text.trim()) {
        provided++;
        if (!section.quote.trim() || !value.transcript.includes(section.quote))
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["sections", field, "quote"],
            message: "Copy an exact supporting excerpt from the transcript.",
          });
      } else if (section.text !== "" || section.quote !== "")
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sections", field],
          message: "Leave unused sections completely empty.",
        });
    }
    if (!provided)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sections"],
        message: "Enter at least one proposed SOAP section.",
      });
  });
export const selectedSectionsSchema = z
  .object({
    subjective: nonempty(50000).optional(),
    objective: nonempty(50000).optional(),
    assessment: nonempty(50000).optional(),
    plan: nonempty(50000).optional(),
  })
  .strict();
export const reviewSchema = z
  .object({
    pet_id: uuid,
    encounter_id: uuid,
    expected_version: version.max(2147483646),
    proposal_id: uuid,
    decision: z.enum(["accepted", "rejected"]),
    accepted_sections: selectedSectionsSchema,
    review_note: text(2000),
    attest_reviewed: z.literal(true),
  })
  .strict()
  .superRefine((value, context) => {
    const count = Object.keys(value.accepted_sections).length;
    if (
      value.decision === "accepted"
        ? !count
        : count > 0 || !value.review_note.trim()
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          value.decision === "accepted"
            ? "Select at least one section to accept."
            : "Reject with a reason and no selected sections.",
      });
  });
export const encounterSchema = z
  .object({
    id: uuid,
    pet_id: uuid,
    version,
    status: z.literal("draft"),
    visit_at: z.string(),
    visit_type: z.string(),
    location: z.string(),
    subjective: z.string(),
    objective: z.string(),
    assessment: z.string(),
    plan: z.string(),
    created_by: uuid,
    updated_by: uuid,
    created_at: z.string(),
    updated_at: z.string(),
    signed_by: z.null(),
    signed_at: z.null(),
  })
  .strict();
export const currentEncounterSchema = encounterSchema
  .extend({
    status: z.enum(["draft", "signed"]),
    signed_by: uuid.nullable(),
    signed_at: z.string().nullable(),
  })
  .superRefine((row, context) => {
    if (
      row.status === "signed"
        ? !row.signed_by || !row.signed_at
        : row.signed_by !== null || row.signed_at !== null
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Encounter signature state differs.",
      });
  });
const reviewRecordSchema = z
  .object({
    id: uuid,
    proposal_id: uuid,
    actor_id: uuid,
    actor_name: z.string(),
    decision: z.enum(["accepted", "rejected"]),
    accepted_sections: selectedSectionsSchema,
    review_note: z.string(),
    attest_reviewed: z.literal(true),
    encounter_version: version.nullable(),
    created_at: z.string(),
  })
  .strict();
export const proposalSchema = z
  .object({
    id: uuid,
    pet_id: uuid,
    encounter_id: uuid,
    expected_version: version,
    actor_id: uuid,
    actor_name: z.string(),
    transcript: nonempty(60000),
    source_hash: z.string().regex(/^[a-f0-9]{64}$/),
    source_note: nonempty(1000),
    attest_authorized: z.literal(true),
    sections: sectionsSchema,
    created_at: z.string(),
    review: reviewRecordSchema.nullable(),
  })
  .strict();
export const readSchema = z
  .object({
    actor_id: uuid,
    pet_id: uuid,
    encounter_id: uuid,
    items: z.array(proposalSchema).max(20),
    has_more: z.boolean(),
  })
  .strict();
export const receiptSchema = z
  .object({
    id: uuid,
    actor_id: uuid,
    kind: z.enum(["submit", "review"]),
    proposal_id: uuid,
    pet_id: uuid,
    encounter_id: uuid,
    decision: z.enum(["submitted", "accepted", "rejected"]),
    encounter: encounterSchema.nullable(),
  })
  .strict();

export interface DictationAction {
  id: string;
  actor: string;
  kind: "submit" | "review";
  request: Record<string, unknown>;
}
export function actionRequest(action: DictationAction) {
  uuid.parse(action.id);
  uuid.parse(action.actor);
  z.enum(["submit", "review"]).parse(action.kind);
  return action.kind === "submit"
    ? submitSchema.parse(action.request)
    : reviewSchema.parse(action.request);
}
export function verifyReceipt(value: unknown, action: DictationAction) {
  const request = actionRequest(action),
    receipt = receiptSchema.parse(value);
  if (
    receipt.id !== action.id ||
    receipt.actor_id !== action.actor ||
    receipt.kind !== action.kind ||
    receipt.pet_id !== request.pet_id ||
    receipt.encounter_id !== request.encounter_id
  )
    throw new Error("Dictation receipt does not match this action.");
  if (action.kind === "submit") {
    if (
      receipt.proposal_id !== action.id ||
      receipt.decision !== "submitted" ||
      receipt.encounter !== null
    )
      throw new Error("Imported draft receipt differs.");
  } else {
    const review = reviewSchema.parse(request);
    if (
      receipt.proposal_id !== review.proposal_id ||
      receipt.decision !== review.decision
    )
      throw new Error("Review receipt differs.");
    if (review.decision === "rejected") {
      if (receipt.encounter !== null)
        throw new Error("Rejection must not change an encounter.");
    } else {
      const row = encounterSchema.parse(receipt.encounter);
      if (
        row.id !== request.encounter_id ||
        row.pet_id !== request.pet_id ||
        row.version !== request.expected_version + 1 ||
        row.updated_by !== action.actor
      )
        throw new Error("Accepted encounter differs.");
      for (const field of soapFields)
        if (
          review.accepted_sections[field] !== undefined &&
          row[field] !== review.accepted_sections[field]
        )
          throw new Error("Accepted section differs from the reviewed text.");
    }
  }
  return receipt;
}
