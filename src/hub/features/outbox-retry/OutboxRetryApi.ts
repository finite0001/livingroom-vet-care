import { supabase } from "@/integrations/supabase/client";
import {
  action,
  actions,
  preview,
  outboxId,
  type RetryIntent,
} from "./OutboxRetryState";
interface Client {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}
const db = supabase as unknown as Client;
async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw error;
  return data;
}
export interface Cursor {
  at: string;
  id: string;
}
export async function readPreview(id: string, actor: string) {
  return preview(
    await rpc("preview_outbox_retry", { p_outbox_id: outboxId(id) }),
    id,
    actor,
  );
}
export async function recover(id: string, actor: string, intent?: RetryIntent) {
  return action(
    await rpc("recover_outbox_retry", { p_id: outboxId(id) }),
    actor,
    id,
    intent,
  );
}
export async function requeue(intent: RetryIntent, actor: string) {
  const r = action(
    await rpc("requeue_outbox_retry", { ...intent }),
    actor,
    intent.p_id,
    intent,
  );
  if (!r) throw new Error("Missing action receipt");
  return r;
}
export async function history(actor: string, cursor: Cursor | null) {
  return actions(
    await rpc("list_outbox_retry_actions", {
      p_before_at: cursor?.at ?? null,
      p_before_id: cursor?.id ?? null,
      p_limit: 50,
    }),
    actor,
  );
}
