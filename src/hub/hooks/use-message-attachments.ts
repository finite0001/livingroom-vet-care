import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hub/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { parseMessageAttachments, type MessageAttachmentHistory } from "@/hub/features/communications/message-attachments";
export function useMessageAttachments(messageIds: string[]) {
  const { session } = useAuth();
  const ids = [...new Set(messageIds)].sort();
  return useQuery({
    queryKey: ["message-attachments", session?.user.id, ids],
    enabled: !!session?.user.id && ids.length > 0,
    queryFn: async () => {
      const result: Record<string, MessageAttachmentHistory> = {};
      for (let offset = 0; offset < ids.length; offset += 100) {
        const batch = ids.slice(offset, offset + 100);
        const { data, error } = await supabase.rpc("list_conversation_message_attachments", { p_message_ids: batch });
        if (error) throw error;
        for (const row of parseMessageAttachments(data, batch)) result[row.messageId] = row;
      }
      return result;
    },
  });
}
