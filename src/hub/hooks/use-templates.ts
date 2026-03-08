import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface MessageTemplate {
  id: string;
  title: string;
  content: string;
  category: string;
  channel: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export function useTemplates() {
  return useQuery({
    queryKey: ["message-templates"],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<MessageTemplate[]> => {
      const { data, error } = await supabase
        .from("message_templates")
        .select("*")
        .order("category")
        .order("title");
      if (error) throw error;
      return (data ?? []) as MessageTemplate[];
    },
  });
}

export function useCreateTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (template: { title: string; content: string; category: string; channel: string }) => {
      const { data, error } = await supabase.from("message_templates").insert(template).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["message-templates"] }); },
  });
}

export function useDeleteTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("message_templates").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["message-templates"] }); },
  });
}
