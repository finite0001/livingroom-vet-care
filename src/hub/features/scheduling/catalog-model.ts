import { z } from "zod";

export const kindSchema = z.enum(["type", "resource"]);
export const modeSchema = z.enum(["clinic", "housecall"]);
export const resourceKindSchema = z.enum([
  "exam",
  "procedure",
  "vehicle",
  "equipment",
  "other",
]);
const uuid = z.string().uuid();
const text = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine(
      (v) =>
        v === v.trim() &&
        Array.from(v).every((character) => {
          const code = character.charCodeAt(0);
          return (code >= 32 && code !== 127) || code === 9 || code === 10;
        }),
      "Use clean text without leading or trailing spaces",
    );
const distinct = (values: string[]) =>
  new Set(values.map((v) => v.toLowerCase())).size === values.length;
const modes = z
  .array(modeSchema)
  .min(1)
  .max(2)
  .refine(distinct, "Choose distinct locations");
export const typeDefinitionSchema = z
  .object({
    name: text(150),
    category: z.enum(["well", "sick", "procedure"]),
    species: z
      .array(text(100))
      .min(1)
      .max(50)
      .refine(distinct, "List distinct species"),
    visit_types: modes,
    duration_minutes: z.number().int().min(15).max(480).nullable(),
    travel_before_minutes: z.number().int().min(0).max(240),
    travel_after_minutes: z.number().int().min(0).max(240),
    resource_kind: resourceKindSchema.nullable(),
    staffing: z.enum(["dvm", "staff"]),
    allow_override: z.boolean(),
  })
  .strict();
export const resourceDefinitionSchema = z
  .object({
    name: text(150),
    resource_kind: resourceKindSchema,
    visit_types: modes,
    aliases: z
      .array(text(150))
      .max(50)
      .refine(distinct, "List distinct aliases"),
  })
  .strict();
export const definitionSchema = z.union([
  typeDefinitionSchema,
  resourceDefinitionSchema,
]);
export interface TypeDefinition extends z.infer<typeof typeDefinitionSchema> {}
export interface ResourceDefinition
  extends z.infer<typeof resourceDefinitionSchema> {}
export const catalogVersionSchema = z
  .object({
    id: uuid,
    entry_id: uuid,
    version: z.number().int().positive(),
    state: z.enum(["draft", "published", "retired"]),
    definition: definitionSchema,
    review_note: text(2000),
    actor_id: uuid,
    recorded_at: z.string().datetime({ offset: true }),
  })
  .strict();
export interface CatalogVersion extends z.infer<typeof catalogVersionSchema> {}
export const catalogEntrySchema = z
  .object({
    id: uuid,
    kind: kindSchema,
    version: z.number().int().positive(),
    current: catalogVersionSchema,
    published: catalogVersionSchema.nullable(),
  })
  .strict()
  .superRefine((entry, ctx) => {
    for (const revision of [entry.current, entry.published]) {
      if (
        revision &&
        (revision.entry_id !== entry.id ||
          !(
            entry.kind === "type"
              ? typeDefinitionSchema
              : resourceDefinitionSchema
          ).safeParse(revision.definition).success)
      )
        ctx.addIssue({
          code: "custom",
          message: "Catalog identity or definition changed",
        });
    }
    if (entry.published && entry.published.state !== "published")
      ctx.addIssue({
        code: "custom",
        message: "Catalog publication is not reviewed",
      });
  });
export interface CatalogEntry extends z.infer<typeof catalogEntrySchema> {}
export const catalogPageSchema = z
  .object({
    items: z.array(catalogEntrySchema).max(100),
    next: uuid.nullable(),
  })
  .strict();
export const bookingValuesSchema = z
  .object({
    type_version_id: uuid,
    resource_version_id: uuid.nullable(),
    client_id: uuid,
    pet_id: uuid,
    scheduled_at: z.string().datetime({ offset: true }),
    duration_minutes: z.number().int().min(15).max(480),
    status: z.enum([
      "SCHEDULED",
      "CONFIRMED",
      "COMPLETED",
      "CANCELLED",
      "NO_SHOW",
    ]),
    assigned_dvm_id: uuid,
    visit_type: modeSchema,
    address_snapshot: text(1000),
    travel_before_minutes: z.number().int().min(0).max(240),
    travel_after_minutes: z.number().int().min(0).max(240),
    notes: z.string().max(10000).nullable(),
    reminder_offsets: z
      .array(z.number().int().min(1).max(720))
      .max(5)
      .refine((v) => new Set(v).size === v.length),
    override_note: z.string().max(2000),
  })
  .strict();
export interface BookingValues extends z.infer<typeof bookingValuesSchema> {}
export const bindingSchema = z
  .object({
    type: catalogVersionSchema,
    resource: catalogVersionSchema.nullable(),
    fields: z
      .object({
        client_id: uuid,
        pet_id: uuid,
        appointment_type: text(150),
        visit_type: modeSchema,
        duration_minutes: z.number().int().min(15).max(480),
        travel_before_minutes: z.number().int().min(0).max(240),
        travel_after_minutes: z.number().int().min(0).max(240),
        resource_name: text(150).nullable(),
      })
      .strict(),
    override_note: z.string().max(2000),
  })
  .strict()
  .superRefine((binding, ctx) => {
    if (
      !typeDefinitionSchema.safeParse(binding.type.definition).success ||
      binding.type.state !== "published" ||
      binding.fields.appointment_type !== binding.type.definition.name ||
      (binding.resource &&
        (!resourceDefinitionSchema.safeParse(binding.resource.definition)
          .success ||
          binding.resource.state !== "published")) ||
      binding.fields.resource_name !==
        (binding.resource?.definition.name ?? null)
    )
      ctx.addIssue({
        code: "custom",
        message: "Booking review identity changed",
      });
  });
export interface CatalogBinding extends z.infer<typeof bindingSchema> {}
export const bookingReceiptSchema = z
  .object({
    appointment: z
      .object({
        id: uuid,
        version: z.number().int().positive(),
        client_id: uuid,
        pet_id: uuid,
        appointment_type: z.string(),
        visit_type: modeSchema,
        duration_minutes: z.number().int(),
        resource_name: z.string().nullable(),
        travel_before_minutes: z.number().int(),
        travel_after_minutes: z.number().int(),
      })
      .passthrough(),
    binding: bindingSchema,
  })
  .strict()
  .superRefine(({ appointment, binding }, ctx) => {
    for (const key of Object.keys(
      binding.fields,
    ) as (keyof CatalogBinding["fields"])[]) {
      if (appointment[key] !== binding.fields[key])
        ctx.addIssue({
          code: "custom",
          message: "Saved booking differs from its reviewed settings",
        });
    }
  });
export interface BookingReceipt extends z.infer<typeof bookingReceiptSchema> {}
export function matchesType(
  definition: TypeDefinition,
  species: string,
  mode: string,
) {
  return (
    definition.species.some(
      (v) => v.toLowerCase() === species.trim().toLowerCase(),
    ) && definition.visit_types.some((v) => v === mode)
  );
}
export function requiresTimeReview(
  definition: TypeDefinition,
  duration: number,
  before: number,
  after: number,
) {
  return (
    definition.duration_minutes === null ||
    duration !== definition.duration_minutes ||
    before !== definition.travel_before_minutes ||
    after !== definition.travel_after_minutes
  );
}
