import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface UrgentAlert {
  id: string;
  alert_type: string;
  message: string;
  recipient_count: number;
  sent_by: string | null;
  created_at: string;
}

export function useAlerts() {
  return useQuery<UrgentAlert[]>({
    queryKey: ["urgent-alerts"],
    staleTime: 30 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("urgent_alerts")
        .select("id, alert_type, message, recipient_count, sent_by, created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as UrgentAlert[];
    },
  });
}

// SMS-reachable audience for an urgent broadcast (clients with a phone on file).
export function useReachableClientCount() {
  return useQuery<number>({
    queryKey: ["reachable-client-count"],
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("clients")
        .select("*", { count: "exact", head: true })
        .not("primary_phone", "is", null);
      if (error) throw error;
      return count ?? 0;
    },
  });
}

export function useSendAlert() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { alert_type: string; message: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { count } = await supabase
        .from("clients")
        .select("*", { count: "exact", head: true })
        .not("primary_phone", "is", null);
      const { error } = await supabase.from("urgent_alerts").insert({
        alert_type: input.alert_type,
        message: input.message,
        recipient_count: count ?? 0,
        sent_by: user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["urgent-alerts"] }),
  });
}
