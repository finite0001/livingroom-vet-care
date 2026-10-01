import type { Database } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";
import {
  historyPage,
  receiptPage,
  mappingSchema,
  type PendingAction,
  type Mapping,
} from "./ExternalRecordState";
type Fns = Database["public"]["Functions"];
type ExternalMutation =
  | "approve_external_record_import"
  | "acknowledge_external_record";
function mutate<N extends ExternalMutation>(name: N, args: Fns[N]["Args"]) {
  return supabase.rpc(name, args);
}
const db = supabase;
export interface Cursor {
  at: string;
  id: string;
}
const cursorArgs = (pet: string, cursor: Cursor | null) => ({
  p_pet_id: pet,
  p_before_at: cursor?.at ?? null,
  p_before_id: cursor?.id ?? null,
  p_limit: 50,
});
export async function readHistory(pet: string, cursor: Cursor | null = null) {
  const { data, error } = await db.rpc(
    "read_external_record_history",
    cursorArgs(pet, cursor),
  );
  if (error) throw error;
  return historyPage(data, pet);
}
export async function readReceipts(
  pet: string,
  actor: string,
  cursor: Cursor | null = null,
) {
  const { data, error } = await db.rpc(
    "list_external_record_receipts",
    cursorArgs(pet, cursor),
  );
  if (error) throw error;
  return receiptPage(data, pet, actor);
}
export async function readMappings(pet: string): Promise<Mapping[]> {
  const { data, error } = await supabase
    .from("ezyvet_record_links")
    .select(
      "id,pet_id,client_id,resource,source_origin,source_site_uid,external_id,approved_by,created_at,local_version",
    )
    .eq("pet_id", pet)
    .eq("resource", "animal")
    .order("created_at");
  if (error) throw error;
  return data.map((v) => {
    const m = mappingSchema.parse(v) as Mapping;
    if (m.pet_id !== pet) throw new Error("Mapping patient differs");
    return m;
  });
}
export async function verifyAction(
  action: "prepare" | "recover",
  args: PendingAction["args"],
) {
  const { data, error } = await supabase.functions.invoke(
    "prepare-external-record",
    { body: { action, ...args } },
  );
  if (error) throw error;
  return data as unknown;
}
export async function submitAction(p: PendingAction) {
  if (p.kind === "verify") return verifyAction("prepare", p.args);
  const name: ExternalMutation =
    p.kind === "approve"
      ? "approve_external_record_import"
      : "acknowledge_external_record";
  // p.args is zod-validated per kind against these signatures (ExternalRecordState).
  const { data, error } = await mutate(name, p.args as Fns[typeof name]["Args"]);
  if (error) throw error;
  return data;
}
export async function recoverAcknowledgment(id: string) {
  const { data, error } = await db.rpc(
    "recover_external_record_acknowledgment",
    { p_id: id },
  );
  if (error) throw error;
  return data;
}
