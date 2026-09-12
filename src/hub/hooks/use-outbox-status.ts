import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hub/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
export function useOutboxStatus(messageIds: string[]) {
  const { session } = useAuth();
  const ids = [...new Set(messageIds)].sort();
  return useQuery({
    queryKey: ["communication-outbox", session?.user.id, ids],
    enabled: !!session?.user.id && ids.length > 0,
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const rows: Record<string, {state: string; last_error: string | null}> = {};
      for (let offset = 0; offset < ids.length; offset += 100) {
        const { data, error } = await supabase.from("communication_outbox").select("message_id,state,last_error").in("message_id", ids.slice(offset, offset + 100));
        if (error) throw error;
        for (const row of data) rows[row.message_id] = row;
      }
      return rows;
    },
  });
}
export function outboxStateLabel(state: string): string {
  const labels: Record<string, string> = {
    pending: "Queued", claimed: "Preparing delivery", accepted: "Accepted by provider · delivery unconfirmed",
    delivered: "Delivered", failed: "Failed", uncertain: "Delivery outcome uncertain · review required",
  };
  return labels[state] ?? "Delivery status unavailable";
}
