import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import {
  filtersSchema,
  cursorSchema,
  pageSchema,
  productsSchema,
  type WhogotFilters,
  type WhogotCursor,
} from "./model";
interface WhogotRpc {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}
// Additive RPC responses are validated at runtime; generated types stay owned by Lovable.
const db = supabase as unknown as WhogotRpc;
export async function whogotRpc(
  name:
    | "search_whogot"
    | "search_whogot_products"
    | "read_whogot_source"
    | "list_service_clinicians"
    | "list_patient_services"
    | "record_patient_service"
    | "correct_patient_service",
  args: Record<string, unknown>,
) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw error;
  return data;
}
export async function searchWhogot(
  filters: WhogotFilters,
  cursor: WhogotCursor | null = null,
  asOf: string | null = null,
  limit = 50,
) {
  const f = filtersSchema.parse(filters);
  if (cursor) cursorSchema.parse(cursor);
  if (asOf) z.string().datetime({ offset: true }).parse(asOf);
  const page = pageSchema.parse(
    await whogotRpc("search_whogot", {
      p_product_id: f.productId || null,
      p_event_type: f.eventType || null,
      p_from: f.from || null,
      p_to: f.to || null,
      p_lot: f.lot,
      p_species: f.species,
      p_clinician: f.clinician,
      p_include_corrected: f.includeCorrected,
      p_include_historical: f.includeHistorical,
      p_before: cursor,
      p_as_of: asOf,
      p_limit: z.number().int().min(1).max(200).parse(limit),
    }),
  );
  if (asOf && Date.parse(page.as_of) !== Date.parse(asOf))
    throw new Error("Search snapshot changed. Run the search again.");
  return page;
}
export async function searchWhogotProducts(search: string) {
  return productsSchema.parse(
    await whogotRpc("search_whogot_products", {
      p_search: z.string().max(200).parse(search),
      p_limit: 101,
    }),
  );
}
export async function exportWhogot(
  filters: WhogotFilters,
  asOf: string,
  keepGoing: () => boolean,
) {
  const rows = [];
  let cursor: WhogotCursor | null = null;
  const seen = new Set<string>();
  do {
    if (!keepGoing()) throw new Error("Export cancelled.");
    const page = await searchWhogot(filters, cursor, asOf, 200);
    if (!keepGoing()) throw new Error("Export cancelled.");
    for (const row of page.rows) {
      const key = `${row.event_type}:${row.id}`;
      if (seen.has(key))
        throw new Error("Duplicate search event. Run the search again.");
      seen.add(key);
      rows.push(row);
    }
    if (rows.length > 10000 || (rows.length === 10000 && page.next))
      throw new Error(
        "Export exceeds 10,000 events. Narrow the dates or product and retry.",
      );
    if (page.next && JSON.stringify(page.next) === JSON.stringify(cursor))
      throw new Error("Search did not advance. Run the search again.");
    cursor = page.next;
  } while (cursor);
  return rows;
}
