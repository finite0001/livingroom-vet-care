import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";
import { resultHistory, type PendingLabAction } from "./LabResultState";
interface FunctionContract {
  Args: Record<string, Json>;
  Returns: Json;
}
interface ResultDatabase {
  public: {
    Tables: Database["public"]["Tables"];
    Views: Database["public"]["Views"];
    Enums: Database["public"]["Enums"];
    CompositeTypes: Database["public"]["CompositeTypes"];
    Functions: {
      read_lab_result_history: FunctionContract;
      review_lab_source_account: FunctionContract;
      review_lab_order_source: FunctionContract;
      link_lab_report_version: FunctionContract;
      acknowledge_lab_report: FunctionContract;
    };
  };
}
const db = supabase as unknown as SupabaseClient<ResultDatabase>;
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
  const functions = {
    source: "review_lab_source_account",
    mapping: "review_lab_order_source",
    link: "link_lab_report_version",
    ack: "acknowledge_lab_report",
  } as const;
  const { data, error } = await db.rpc(functions[p.kind], p.args);
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
