import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import {
  bindingSchema,
  bookingReceiptSchema,
  bookingValuesSchema,
  catalogEntrySchema,
  catalogPageSchema,
  kindSchema,
  resourceDefinitionSchema,
  typeDefinitionSchema,
  type BookingValues,
  type CatalogEntry,
  type ResourceDefinition,
  type TypeDefinition,
} from "./catalog-model";
interface CatalogRpc {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}
const db = supabase as unknown as CatalogRpc;
async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw error;
  return data;
}
export async function catalogPage(
  kind: "type" | "resource",
  after: string | null = null,
) {
  return catalogPageSchema.parse(
    await rpc("list_appointment_catalog", {
      p_kind: kindSchema.parse(kind),
      p_after: z.string().uuid().nullable().parse(after),
      p_limit: 50,
    }),
  );
}
// Never present a partial list as the complete published catalog.
export async function catalogList(kind: "type" | "resource") {
  const entries: CatalogEntry[] = [],
    cursors = new Set<string>();
  let after: string | null = null;
  for (let page = 0; page < 100; page++) {
    const result = await catalogPage(kind, after);
    entries.push(...result.items);
    if (!result.next) return entries;
    if (cursors.has(result.next))
      throw new Error("Catalog pagination did not advance");
    cursors.add(result.next);
    after = result.next;
  }
  throw new Error(
    "Catalog is too large to load safely; review its configuration",
  );
}
export interface CatalogAction {
  kind: "type" | "resource";
  id: string;
  expectedVersion: number | null;
  action: "draft" | "publish" | "retire";
  values: {
    definition: TypeDefinition | ResourceDefinition;
    review_note: string;
    attest_review: boolean;
  };
}
export interface BookingAction {
  id: string | null;
  expectedVersion: number | null;
  values: BookingValues;
}
export function catalogArgs(
  actorId: string,
  actionId: string,
  action: CatalogAction,
) {
  const values = z
    .object({
      definition:
        action.kind === "type"
          ? typeDefinitionSchema
          : resourceDefinitionSchema,
      review_note: z.string().trim().min(1).max(2000),
      attest_review: z.boolean(),
    })
    .strict()
    .parse(action.values);
  return {
    p_actor_id: z.string().uuid().parse(actorId),
    p_action_id: z.string().uuid().parse(actionId),
    p_id: z.string().uuid().parse(action.id),
    p_expected_version: z
      .number()
      .int()
      .positive()
      .nullable()
      .parse(action.expectedVersion),
    p_kind: kindSchema.parse(action.kind),
    p_action: z.enum(["draft", "publish", "retire"]).parse(action.action),
    p_values: values,
  };
}
export function bookingArgs(
  actorId: string,
  actionId: string,
  action: BookingAction,
) {
  return {
    p_actor_id: z.string().uuid().parse(actorId),
    p_action_id: z.string().uuid().parse(actionId),
    p_id: z.string().uuid().nullable().parse(action.id),
    p_expected_version: z
      .number()
      .int()
      .positive()
      .nullable()
      .parse(action.expectedVersion),
    p_values: bookingValuesSchema.parse(action.values),
  };
}
export async function catalogAction(
  actorId: string,
  actionId: string,
  action: CatalogAction,
  recover: boolean,
) {
  const data = await rpc(
    recover ? "recover_appointment_catalog_action" : "save_appointment_catalog",
    catalogArgs(actorId, actionId, action),
  );
  const receipt = (
    recover ? catalogEntrySchema.nullable() : catalogEntrySchema
  ).parse(data);
  if (receipt && (receipt.id !== action.id || receipt.kind !== action.kind))
    throw new Error("Saved catalog identity changed");
  return receipt;
}
export async function bookingAction(
  actorId: string,
  actionId: string,
  action: BookingAction,
  recover: boolean,
) {
  const data = await rpc(
    recover ? "recover_catalog_appointment" : "save_catalog_appointment",
    bookingArgs(actorId, actionId, action),
  );
  const receipt = (
    recover ? bookingReceiptSchema.nullable() : bookingReceiptSchema
  ).parse(data);
  if (
    receipt &&
    ((action.id && receipt.appointment.id !== action.id) ||
      receipt.binding.type.id !== action.values.type_version_id ||
      (receipt.binding.resource?.id ?? null) !==
        action.values.resource_version_id ||
      receipt.appointment.pet_id !== action.values.pet_id)
  )
    throw new Error("Saved booking identity changed");
  return receipt;
}
export async function appointmentBinding(id: string) {
  return bindingSchema
    .nullable()
    .parse(
      await rpc("read_appointment_catalog_binding", {
        p_id: z.string().uuid().parse(id),
      }),
    );
}
