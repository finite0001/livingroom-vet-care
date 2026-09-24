import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hub/contexts/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { parseIncomingAttachments, type IncomingAttachment } from "@/hub/features/communications/incoming-attachments";
export function useIncomingAttachments(messageIds: string[]) {
  const { session } = useAuth();
  const ids = [...new Set(messageIds)].sort();
  return useQuery({
    queryKey: ["incoming-attachments", session?.user.id, ids],
    enabled: !!session?.user.id && ids.length > 0,
    queryFn: async () => {
      const result: Record<string, IncomingAttachment[]> = {};
      for (let offset = 0; offset < ids.length; offset += 100) {
        const batch = ids.slice(offset, offset + 100);
        const { data, error } = await supabase.rpc("list_inbound_message_attachments", { p_message_ids: batch });
        if (error) throw error;
        for (const file of parseIncomingAttachments(data, batch)) (result[file.messageId] ??= []).push(file);
      }
      return result;
    },
  });
}
