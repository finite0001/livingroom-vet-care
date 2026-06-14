import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface CallLog {
  id: string;
  call_sid: string;
  call_type: string; // 'inbound' | 'outbound' | 'browser'
  from_number: string;
  to_number: string;
  status: string;
  duration_seconds: number | null;
  initiated_by: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface Voicemail {
  id: string;
  call_sid: string;
  from_number: string;
  to_number: string | null;
  recording_url: string | null;
  recording_path: string | null;
  recording_duration: number | null;
  transcription: string | null;
  transcription_status: string | null;
  status: string;
  is_read: boolean;
  ai_summary: string | null;
  summary_generated_at: string | null;
  created_at: string;
}

export function useCallLogs(limit = 100) {
  return useQuery<CallLog[]>({
    queryKey: ["call-logs", limit],
    staleTime: 15 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("call_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as CallLog[];
    },
  });
}

export function useVoicemails() {
  return useQuery<Voicemail[]>({
    queryKey: ["voicemails"],
    staleTime: 30 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("voicemail_messages")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as Voicemail[];
    },
  });
}

export function useUnreadVoicemailCount() {
  return useQuery<number>({
    queryKey: ["unread-voicemail-count"],
    staleTime: 30 * 1000,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("voicemail_messages")
        .select("*", { count: "exact", head: true })
        .eq("is_read", false);
      if (error) throw error;
      return count ?? 0;
    },
  });
}

export function useMarkVoicemailRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("voicemail_messages")
        .update({ is_read: true })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["voicemails"] });
      queryClient.invalidateQueries({ queryKey: ["unread-voicemail-count"] });
    },
  });
}
