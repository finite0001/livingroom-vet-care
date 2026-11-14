import { z } from "zod";
const uuid = z.string().uuid();
export const labValueSchema = z
  .object({
    analyte: z.string().trim().min(1).max(100),
    value: z.string().trim().min(1).max(100),
    unit: z.string().trim().min(1).max(100),
    reference_range: z.string().trim().min(1).max(200),
  })
  .strict();
export const helperRequestSchema = z.discriminatedUnion("kind", [
  z
    .object({
      id: uuid,
      pet_id: uuid,
      kind: z.literal("discharge"),
      data: z.object({ encounter_id: uuid }).strict(),
    })
    .strict(),
  z
    .object({
      id: uuid,
      pet_id: uuid,
      kind: z.literal("bloodwork"),
      data: z
        .object({
          encounter_id: uuid,
          lab_id: uuid,
          lab_values: z.array(labValueSchema).min(1).max(100),
          attest_reviewed: z.literal(true),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      id: uuid,
      pet_id: uuid,
      kind: z.literal("pill"),
      data: z
        .object({
          imprint: z.string().trim().min(1).max(100),
          shape: z.string().trim().max(100),
          color: z.string().trim().max(100),
        })
        .strict(),
    })
    .strict(),
]);
export const helperResultSchema = z
  .object({
    claims: z
      .array(
        z
          .object({
            text: z.string().min(1).max(1500),
            citations: z
              .array(
                z
                  .object({
                    source_ref: uuid,
                    quote: z.string().min(3).max(1000),
                  })
                  .strict(),
              )
              .min(1)
              .max(4),
          })
          .strict(),
      )
      .min(1)
      .max(40),
    review_flags: z.array(z.string().max(500)).max(20),
  })
  .strict();
export const helperSourceSchema = z.object({
  patient: z.object({ id: uuid, name: z.string(), species: z.string() }),
  sources: z
    .array(
      z.object({
        source_ref: uuid,
        content: z.record(z.string(), z.unknown()),
      }),
    )
    .min(1)
    .max(100),
});
export function validateHelperEvidence(result: unknown, source: unknown) {
  const value = helperResultSchema.parse(result),
    context = helperSourceSchema.parse(source);
  for (const claim of value.claims)
    for (const citation of claim.citations) {
      const original = context.sources.find(
        (s) => s.source_ref === citation.source_ref,
      );
      if (
        !original ||
        !JSON.stringify(original.content).includes(citation.quote)
      )
        throw new Error(
          "Clinical draft citation is not in the selected source.",
        );
    }
  return value;
}
export const helperJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["claims", "review_flags"],
  properties: {
    claims: {
      type: "array",
      minItems: 1,
      maxItems: 40,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "citations"],
        properties: {
          text: { type: "string" },
          citations: {
            type: "array",
            minItems: 1,
            maxItems: 4,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["source_ref", "quote"],
              properties: {
                source_ref: { type: "string" },
                quote: { type: "string" },
              },
            },
          },
        },
      },
    },
    review_flags: { type: "array", items: { type: "string" } },
  },
};
