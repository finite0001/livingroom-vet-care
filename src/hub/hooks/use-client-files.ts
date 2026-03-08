import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ClientFile {
  id: string;
  client_id: string;
  conversation_id: string | null;
  message_id: string | null;
  file_name: string;
  file_path: string;
  file_size: number;
  mime_type: string | null;
  category: string;
  uploaded_by: string | null;
  created_at: string;
}

export function useClientFiles(clientId: string | undefined) {
  return useQuery({
    queryKey: ["client-files", clientId],
    enabled: !!clientId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_files")
        .select("*")
        .eq("client_id", clientId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as ClientFile[];
    },
  });
}

export function useMessageFiles(messageIds: string[]) {
  return useQuery({
    queryKey: ["message-files", messageIds.slice().sort().join(",")],
    enabled: messageIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_files")
        .select("*")
        .in("message_id", messageIds);
      if (error) throw error;
      return data as ClientFile[];
    },
  });
}

export function useUpdateFileCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ fileId, category }: { fileId: string; category: string }) => {
      const { error } = await supabase.from("client_files").update({ category: category as any }).eq("id", fileId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["client-files"] });
      qc.invalidateQueries({ queryKey: ["message-files"] });
    },
  });
}

export function useDeleteClientFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ fileId, filePath }: { fileId: string; filePath: string }) => {
      await supabase.storage.from("client-files").remove([filePath]);
      const { error } = await supabase.from("client_files").delete().eq("id", fileId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["client-files"] });
      qc.invalidateQueries({ queryKey: ["message-files"] });
    },
  });
}

export async function getSignedUrl(filePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from("client-files")
    .createSignedUrl(filePath, 3600);
  if (error) throw error;
  return data.signedUrl;
}
