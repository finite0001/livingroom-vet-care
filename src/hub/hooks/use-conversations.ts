import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect } from "react";

export type ConversationPriority = "URGENT" | "NORMAL" | "LOW";

export interface ConversationWithClient {
  id: string;
  client_id: string;
  assigned_to_id: string | null;
  status: string;
  is_read: boolean;
  priority: ConversationPriority;
  tags: string[];
  first_message_at: string | null;
  first_response_at: string | null;
  last_message_at: string;
  created_at: string;
  client: {
    id: string;
    first_name: string;
    last_name: string;
    full_name: string;
    primary_phone: string | null;
    primary_email: string | null;
    preferred_channel: string | null;
    ezyvet_id: string | null;
  };
  pets: { id: string; name: string; species: string; breed: string | null }[];
  last_message?: {
    content: string | null;
    type: string;
    created_at: string;
  };
}

export function useConversations() {
  return useQuery({
    queryKey: ["conversations"],
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<ConversationWithClient[]> => {
      const { data: conversations, error } = await supabase
        .from("conversations")
        .select("*")
        .order("last_message_at", { ascending: false });
      if (error) throw error;
      if (!conversations.length) return [];

      const clientIds = [...new Set(conversations.map((c) => c.client_id))];
      const [clientsRes, petsRes] = await Promise.all([
        supabase.from("clients").select("*").in("id", clientIds),
        supabase.from("pets").select("id, client_id, name, species, breed").in("client_id", clientIds),
      ]);
      if (clientsRes.error) throw clientsRes.error;
      if (petsRes.error) throw petsRes.error;

      const convIds = conversations.map((c) => c.id);
      const { data: messages, error: msgError } = await supabase
        .from("messages")
        .select("conversation_id, content, type, created_at")
        .in("conversation_id", convIds)
        .order("created_at", { ascending: false })
        .limit(convIds.length * 2);
      if (msgError) throw msgError;

      const lastMessageMap = new Map<string, typeof messages[0]>();
      for (const msg of messages) {
        if (!lastMessageMap.has(msg.conversation_id)) {
          lastMessageMap.set(msg.conversation_id, msg);
        }
      }

      const clientMap = new Map(clientsRes.data.map((c) => [c.id, c]));
      const petsByClient = new Map<string, typeof petsRes.data>();
      for (const pet of petsRes.data) {
        const existing = petsByClient.get(pet.client_id) || [];
        existing.push(pet);
        petsByClient.set(pet.client_id, existing);
      }

      return conversations
        .filter((conv) => clientMap.has(conv.client_id))
        .map((conv) => ({
          ...conv,
          is_read: conv.is_read ?? true,
          priority: conv.priority ?? "NORMAL",
          tags: conv.tags ?? [],
          first_message_at: conv.first_message_at ?? null,
          first_response_at: conv.first_response_at ?? null,
          client: clientMap.get(conv.client_id)!,
          pets: petsByClient.get(conv.client_id) || [],
          last_message: lastMessageMap.get(conv.id) || undefined,
        })) as ConversationWithClient[];
    },
  });
}

export function useMarkRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (conversationId: string) => {
      const { error } = await supabase
        .from("conversations")
        .update({ is_read: true })
        .eq("id", conversationId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    },
  });
}

export function useToggleRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ conversationId, isRead }: { conversationId: string; isRead: boolean }) => {
      const { error } = await supabase
        .from("conversations")
        .update({ is_read: isRead })
        .eq("id", conversationId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    },
  });
}

export function useArchiveConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ conversationId, status }: { conversationId: string; status: "ACTIVE" | "ARCHIVED" }) => {
      const { error } = await supabase
        .from("conversations")
        .update({ status })
        .eq("id", conversationId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    },
  });
}

export function useDeleteConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (conversationId: string) => {
      const { error: msgError } = await supabase
        .from("messages")
        .delete()
        .eq("conversation_id", conversationId);
      if (msgError) throw msgError;
      const { error } = await supabase
        .from("conversations")
        .delete()
        .eq("id", conversationId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    },
  });
}

export function useSetPriority() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ conversationId, priority }: { conversationId: string; priority: ConversationPriority }) => {
      const { error } = await supabase
        .from("conversations")
        .update({ priority })
        .eq("id", conversationId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    },
  });
}

export function useSetTags() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ conversationId, tags }: { conversationId: string; tags: string[] }) => {
      const { error } = await supabase
        .from("conversations")
        .update({ tags })
        .eq("id", conversationId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    },
  });
}

export function useConversationMessages(conversationId: string | undefined) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!conversationId) return;
    const channel = supabase
      .channel(`messages-${conversationId}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `conversation_id=eq.${conversationId}`,
      }, () => {
        queryClient.invalidateQueries({ queryKey: ["messages", conversationId] });
        queryClient.invalidateQueries({ queryKey: ["conversations"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [conversationId, queryClient]);

  return useQuery({
    queryKey: ["messages", conversationId],
    enabled: !!conversationId,
    staleTime: 15 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", conversationId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data;
    },
  });
}

export function useClientMessages(clientId: string | undefined) {
  return useQuery({
    queryKey: ["client-messages", clientId],
    enabled: !!clientId,
    staleTime: 30 * 1000,
    queryFn: async () => {
      const { data: convs, error: convError } = await supabase
        .from("conversations")
        .select("id")
        .eq("client_id", clientId!);
      if (convError) throw convError;
      if (!convs.length) return [];
      const convIds = convs.map((c) => c.id);
      const { data: messages, error } = await supabase
        .from("messages")
        .select("*")
        .in("conversation_id", convIds)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return messages;
    },
  });
}
