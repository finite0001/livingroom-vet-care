import type { Database } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";
import { resultHistory, type PendingLabAction } from "./LabResultState";
type Fns = Database["public"]["Functions"];
const mutations = {
  source: "review_lab_source_account",
  mapping: "review_lab_order_source",
  link: "link_lab_report_version",
  ack: "acknowledge_lab_report",
} as const;
type LabMutation = (typeof mutations)[keyof typeof mutations];
function mutate<N extends LabMutation>(name: N, args: Fns[N]["Args"]) {
  return supabase.rpc(name, args);
}
const db = supabase;
export async function readLabResults(pet: string, order: string) {
  const { data, error } = await db.rpc("read_lab_result_history", {
    p_pet_id: pet,
    p_order_id: order,
  });
  if (error) throw error;
  return resultHistory(data, pet, order);
}
export async function submitLabAction(p: PendingLabAction) {
  if (p.kind === "verify") {
    const { data, error } = await supabase.functions.invoke(
      "prepare-lab-report",
      { body: { action: "prepare", ...p.args } },
    );
    if (error) throw error;
    return data as unknown;
  }
  const name = mutations[p.kind];
  // p.args is zod-validated per kind against these signatures (LabResultState).
  const { data, error } = await mutate(name, p.args as Fns[typeof name]["Args"]);
  if (error) throw error;
  return data;
}
export async function recoverLabReceipt(id: string) {
  const { data, error } = await supabase.functions.invoke(
    "prepare-lab-report",
    { body: { action: "recover", p_receipt_id: id } },
  );
  if (error) throw error;
  return data as unknown;
}
