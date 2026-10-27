import { z } from "zod";
import { administrationName, administrationReference, administrationUuid } from "./primitives.ts";
export const siteLocationDefinitionSchema = z.object({ key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), label: administrationName,
  kind: z.enum(["clinic", "mobile_kit"]), initial_custodian_id: administrationUuid.nullable() }).strict()
  .refine(value => (value.kind === "clinic") === (value.initial_custodian_id === null));
export const siteRegistrationDefinitionSchema = z.object({ site: z.object({ label: administrationName, registration_reference: administrationReference }).strict(),
  locations: z.array(siteLocationDefinitionSchema).min(1).max(256).refine(values => values.every((value, index) => index === 0 || values[index - 1].key < value.key)) }).strict();
export interface SiteRegistrationDefinition extends z.infer<typeof siteRegistrationDefinitionSchema> {}
