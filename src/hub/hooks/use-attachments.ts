import { useMutation, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface MessageAttachment {
  id: string;
  message_id: string;
  file_name: string;
  file_type: string;
  file_size: number;
  storage_path: string;
  created_at: string;
}

export function useAttachments(messageIds: string[]) {
  return useQuery({
    queryKey: ["attachments", messageIds.slice().sort().join(",")],
    enabled: messageIds.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<MessageAttachment[]> => {
      const { data, error } = await supabase
        .from("message_attachments" as any)
        .select("*")
        .in("message_id", messageIds);
      if (error) throw error;
      return (data ?? []) as unknown as MessageAttachment[];
    },
  });
}

const MAX_FILE_SIZE = 10 * 1024 * 1024;

export function useUploadAttachment() {
  return useMutation({
    mutationFn: async ({ file, messageId }: { file: File; messageId: string }) => {
      if (file.size > MAX_FILE_SIZE) throw new Error("File exceeds 10 MB limit");
      const ext = file.name.split(".").pop() || "bin";
      const storagePath = `${messageId}/${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from("message-attachments").upload(storagePath, file);
      if (uploadError) throw uploadError;
      const { data, error: insertError } = await supabase
        .from("message_attachments" as any)
        .insert({ message_id: messageId, file_name: file.name, file_type: file.type, file_size: file.size, storage_path: storagePath })
        .select()
        .single();
      if (insertError) throw insertError;
      return data;
    },
  });
}

export async function getAttachmentUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage.from("message-attachments").createSignedUrl(storagePath, 3600);
  if (error || !data?.signedUrl) throw new Error("Failed to get attachment URL");
  return data.signedUrl;
}
