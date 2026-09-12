import { useEffect, useState } from "react";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hub/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { QueueIntentStore, QueueRejectedError, type MessageIntent, type QueueReceipt } from "@/hub/features/communications/queue-intent";

const intents = new QueueIntentStore();
let activeActor: string | null = null;
function receipt(value: unknown): QueueReceipt | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Partial<QueueReceipt>;
  return r.success === true && r.queued === true && typeof r.outbox_id === "string" && typeof r.message_id === "string" && typeof r.state === "string" ? r as QueueReceipt : null;
}
export function useMessageQueue(scope: string) {
  const { session } = useAuth();
  const actor = session?.user.id ?? null;
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (activeActor !== actor) { intents.clear(); activeActor = actor; }
  }, [actor]);
  const key = `${actor}:${scope}`;
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => {
      if (intents.has(key)) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [key]);
  const send = async (payload: MessageIntent) => {
    if (!actor || activeActor !== actor) throw new Error("Sign in again before queueing a message.");
    setPending(true);
    try {
      const result = await intents.send(key, payload, {
        submit: async (body) => {
          const { data, error } = await supabase.functions.invoke("enqueue-message", { body });
          if (error) {
            if (error instanceof FunctionsHttpError) {
              const result = await error.context.clone().json().catch(() => null);
              if (result?.queue_rejected === true) throw new QueueRejectedError(result.error || "Message was not queued. Your draft has been kept.");
            }
            throw new Error("Queue confirmation was lost. Your draft has been kept; retry unchanged to check the same request. Review message history before sending again after a reload.");
          }
          const result = receipt(data);
          if (!result) throw new Error("Queue confirmation was incomplete. Retry the unchanged draft.");
          return result;
        },
        lookup: async (requestId) => {
          const { data, error } = await supabase.from("communication_outbox").select("id,message_id,state").eq("request_id", requestId).eq("created_by", actor).maybeSingle();
          if (error) throw error;
          return data ? { success: true, queued: true, outbox_id: data.id, message_id: data.message_id, state: data.state } : null;
        },
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["messages"] }),
        queryClient.invalidateQueries({ queryKey: ["conversations"] }),
        queryClient.invalidateQueries({ queryKey: ["communication-outbox"] }),
      ]);
      return result;
    } finally { setPending(false); }
  };
  return { send, pending };
}
