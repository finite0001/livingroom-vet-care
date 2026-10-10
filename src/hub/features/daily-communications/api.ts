import { supabase } from "@/integrations/supabase/client";
import {
  cursorSchema,
  filtersSchema,
  pageSchema,
  detailSchema,
  rowSchema,
  type CommunicationFilters,
  type CommunicationCursor,
  type CommunicationRow,
} from "./model";
interface DailyCommunicationRpc {
  rpc(
    name: "list_daily_communications" | "read_daily_communication",
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}
// Additive RPCs use runtime validation; generated types remain owned by Lovable.
const db = supabase as unknown as DailyCommunicationRpc;
export async function listDailyCommunications(
  filters: CommunicationFilters,
  cursor: CommunicationCursor | null = null,
) {
  const f = filtersSchema.parse(filters);
  if (cursor) cursorSchema.parse(cursor);
  const { data, error } = await db.rpc("list_daily_communications", {
    p_from: f.from,
    p_to: f.to,
    p_channel: f.channel || null,
    p_status: f.status || null,
    p_search: f.search,
    p_before: cursor,
    p_limit: 50,
  });
  if (error) throw error;
  return pageSchema.parse(data);
}
export async function readDailyCommunication(row: CommunicationRow) {
  const r = rowSchema.parse(row);
  const { data, error } = await db.rpc("read_daily_communication", {
    p_source: r.source,
    p_id: r.id,
  });
  if (error) throw error;
  const result = detailSchema.nullable().parse(data);
  if (
    result &&
    (result.record.id !== r.id || result.record.source !== r.source)
  )
    throw new Error("Communication detail identity changed");
  return result;
}
