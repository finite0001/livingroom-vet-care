import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";
import {
  queue,
  preview,
  retryReceipt,
  retryPage,
  type RetryIntent,
} from "./ProcessingState";
interface Contract {
  Args: Record<string, Json>;
  Returns: Json;
}
interface ProcessingDatabase {
  public: {
    Tables: Database["public"]["Tables"];
    Views: Database["public"]["Views"];
    Enums: Database["public"]["Enums"];
    CompositeTypes: Database["public"]["CompositeTypes"];
    Functions: {
      list_communication_processing_queue: Contract;
      preview_communication_event_retry: Contract;
      requeue_communication_event: Contract;
      recover_communication_event_retry: Contract;
      list_communication_event_retries: Contract;
    };
  };
}
const db = supabase as unknown as SupabaseClient<ProcessingDatabase>;
export interface Cursor {
  at: string;
  id: string;
}
export async function readProcessingQueue(
  state: string | null,
  cursor: Cursor | null,
) {
  const { data, error } = await db.rpc("list_communication_processing_queue", {
    p_state: state,
    p_before_at: cursor?.at ?? null,
    p_before_id: cursor?.id ?? null,
    p_limit: 50,
  });
  if (error) throw error;
  return queue(data);
}
export async function previewRetry(id: string) {
  const { data, error } = await db.rpc("preview_communication_event_retry", {
    p_event_id: id,
  });
  if (error) throw error;
  return preview(data, id);
}
export async function retryHistory(actor: string, cursor: Cursor | null) {
  const { data, error } = await db.rpc("list_communication_event_retries", {
    p_before_at: cursor?.at ?? null,
    p_before_id: cursor?.id ?? null,
    p_limit: 50,
  });
  if (error) throw error;
  return retryPage(data, actor);
}
export async function recoverRetry(
  actor: string,
  id: string,
  intent?: RetryIntent,
) {
  const { data, error } = await db.rpc("recover_communication_event_retry", {
    p_id: id,
  });
  if (error) throw error;
  return retryReceipt(data, actor, intent, id);
}
export async function requeue(actor: string, p: RetryIntent) {
  const { data, error } = await db.rpc("requeue_communication_event", { ...p });
  if (error) throw error;
  const r = retryReceipt(data, actor, p);
  if (!r) throw new Error("Retry receipt missing");
  return r;
}
