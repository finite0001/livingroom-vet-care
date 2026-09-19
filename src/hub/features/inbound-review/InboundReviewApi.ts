import { supabase } from "@/integrations/supabase/client";
import {
  inboundSchema,
  recovery,
  type AssignmentIntent,
  type Inbound,
} from "./InboundReviewState";
// Project plain text at the server boundary, including the mutation response. Never fetch raw HTML or attachment payloads.
export const inboundFields =
  "id,channel,sender,recipient,subject,body,occurred_at,received_at,client_id,conversation_id,message_id,review_reason,version" as const;
export interface Cursor {
  at: string;
  id: string;
}
export async function listUnassigned(cursor: Cursor | null) {
  let q = supabase
    .from("communication_inbound")
    .select(inboundFields)
    .is("message_id", null)
    .order("received_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(51);
  if (cursor)
    q = q.or(
      `received_at.lt.${cursor.at},and(received_at.eq.${cursor.at},id.lt.${cursor.id})`,
    );
  const { data, error } = await q;
  if (error) throw error;
  const rows = data.map((v) => inboundSchema.parse(v) as Inbound);
  if (rows.some((r) => r.message_id)) throw new Error("Queue changed; refresh");
  return { rows: rows.slice(0, 50), more: rows.length > 50 };
}
export async function readAssignment(id: string) {
  const [r, a] = await Promise.all([
    supabase
      .from("communication_inbound")
      .select(inboundFields)
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("communication_inbound_assignments")
      .select(
        "id,inbound_id,client_id,conversation_id,assigned_by,reason,created_at",
      )
      .eq("inbound_id", id)
      .order("created_at"),
  ]);
  if (r.error) throw r.error;
  if (a.error) throw a.error;
  return recovery({ inbound: r.data, assignments: a.data }, id);
}
export async function assignInbound(p: AssignmentIntent) {
  const { data, error } = await supabase
    .rpc("assign_inbound_communication", p)
    .select(inboundFields);
  if (error) throw error;
  return inboundSchema.parse(data) as Inbound;
}
export async function households(search: string) {
  const { data, error } = await supabase.rpc("search_clients", {
    p_search: search,
    p_limit: 30,
  });
  if (error) throw error;
  return data.map((c) => ({
    id: c.id,
    full_name: c.full_name,
    primary_email: c.primary_email,
    primary_phone: c.primary_phone,
  }));
}
export async function householdConversations(id: string) {
  const { data, error } = await supabase
    .from("conversations")
    .select("id,client_id,status,last_message_at")
    .eq("client_id", id)
    .order("last_message_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  if (data.some((c) => c.client_id !== id))
    throw new Error("Household conversation differs");
  return data;
}
