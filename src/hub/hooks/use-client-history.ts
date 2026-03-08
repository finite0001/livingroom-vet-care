import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect } from "react";

export interface ConversationBoundary {
  conversationId: string;
  createdAt: string;
  status: string;
}

export interface HistoryMessage {
  id: string;
  conversation_id: string;
  type: string;
  sender_type: string;
  sender_id: string | null;
  content: string | null;
  audio_url: string | null;
  transcription: string | null;
  is_internal: boolean;
  ivr_path: string | null;
  created_at: string;
}

export function useClientConversationHistory(clientId: string | undefined, currentConversationId: string | undefined) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!currentConversationId) return;
    const channel = supabase
      .channel(`client-history-${currentConversationId}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `conversation_id=eq.${currentConversationId}`,
      }, () => {
        queryClient.invalidateQueries({ queryKey: ["client-history", clientId] });
        queryClient.invalidateQueries({ queryKey: ["conversations"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [currentConversationId, clientId, queryClient]);

  return useQuery({
    queryKey: ["client-history", clientId],
    enabled: !!clientId,
    queryFn: async (): Promise<{ messages: HistoryMessage[]; boundaries: ConversationBoundary[] }> => {
      const { data: convs, error: convError } = await supabase
        .from("conversations")
        .select("id, created_at, status")
        .eq("client_id", clientId!)
        .order("created_at", { ascending: true });
      if (convError) throw convError;
      if (!convs.length) return { messages: [], boundaries: [] };

      const convIds = convs.map((c) => c.id);
      const { data: messages, error: msgError } = await supabase
        .from("messages")
        .select("*")
        .in("conversation_id", convIds)
        .order("created_at", { ascending: true });
      if (msgError) throw msgError;

      const boundaries: ConversationBoundary[] = convs.map((c) => ({
        conversationId: c.id,
        createdAt: c.created_at,
        status: c.status,
      }));

      return { messages: messages as HistoryMessage[], boundaries };
    },
  });
}
