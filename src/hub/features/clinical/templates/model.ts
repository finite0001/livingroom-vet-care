import { z } from "zod";
import {
  noteTemplateDefinitionSchema,
  noteTemplateVersionSchema,
  noteJobSchema,
  notePolicySchema,
} from "../../../../../supabase/functions/_shared/clinical-note-model.ts";
export * from "../../../../../supabase/functions/_shared/clinical-note-model.ts";
const uuid = z.string().uuid();
export const templateRootSchema = z
  .object({
    id: uuid,
    revision: z.number().int().positive(),
    latest_version: z.number().int().positive(),
    approved_version: z.number().int().positive().nullable(),
    retired: z.boolean(),
    latest: noteTemplateVersionSchema.pick({
      version: true,
      definition: true,
      sha256: true,
    }),
    approved: noteTemplateVersionSchema
      .pick({ version: true, definition: true, sha256: true })
      .nullable(),
  })
  .strict();
export const configurationSchema = z
  .object({
    actor_id: uuid,
    policy: notePolicySchema,
    templates: z.array(templateRootSchema),
  })
  .strict();
export const notesReadSchema = configurationSchema
  .extend({
    pet_id: uuid,
    encounter_id: uuid,
    jobs: z.array(noteJobSchema).max(10),
  })
  .strict();
export const configurationRequestSchemas = {
  create_template: z
    .object({ template_id: uuid, definition: noteTemplateDefinitionSchema })
    .strict(),
  save_template: z
    .object({
      template_id: uuid,
      expected_revision: z.number().int().positive(),
      definition: noteTemplateDefinitionSchema,
    })
    .strict(),
  approve_template: z
    .object({
      template_id: uuid,
      expected_revision: z.number().int().positive(),
      version: z.number().int().positive(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      attest_reviewed: z.literal(true),
    })
    .strict(),
  retire_template: z
    .object({
      template_id: uuid,
      expected_revision: z.number().int().positive(),
      reason: z.string().trim().min(1).max(1000),
    })
    .strict(),
  policy: z
    .object({
      expected_version: z.number().int().positive(),
      status: z.enum(["draft", "approved"]),
      consent_text: z.string().trim().min(1).max(4000),
      attest_reviewed: z.boolean(),
    })
    .strict(),
};
export interface ConfigurationAction {
  actor: string;
  id: string;
  operation: keyof typeof configurationRequestSchemas;
  request: unknown;
}
export type TemplateRoot = z.infer<typeof templateRootSchema>;
export type TemplateDefinition = z.infer<typeof noteTemplateDefinitionSchema>;
export const starterDefinition: TemplateDefinition = {
  name: "New clinical template",
  detail: "standard",
  fields: [
    {
      id: "history",
      label: "History and presenting concern",
      destination: "subjective",
      instructions:
        "Preserve reported history and its attribution. Do not infer current findings from historical information.",
      required: true,
    },
    {
      id: "exam",
      label: "Exam findings",
      destination: "objective",
      instructions:
        "Include only explicitly reported examination findings and measurements. Omit unexamined systems; do not insert normal findings.",
      required: true,
    },
    {
      id: "assessment",
      label: "Assessment and differentials",
      destination: "assessment",
      instructions:
        "Preserve diagnostic uncertainty and distinguish confirmed diagnoses from differentials.",
      required: true,
    },
    {
      id: "plan",
      label: "Treatment and follow-up",
      destination: "plan",
      instructions:
        "Distinguish planned, performed, declined and historical care. Preserve drug, dose, route and timing exactly when stated.",
      required: true,
    },
  ],
};
