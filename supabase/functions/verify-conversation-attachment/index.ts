import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.3";
import { createVerifyConversationAttachmentHandler } from "../_shared/verify-conversation-attachment.ts";
const url = Deno.env.get("SUPABASE_URL")!;
const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
Deno.serve(createVerifyConversationAttachmentHandler({
  authenticate: async (token) => {
    const { data, error } = await service.auth.getUser(token);
    if (error || !data.user) return null;
    const user = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return {
      actorId: data.user.id,
      readUpload: async (id) => {
        const { data, error } = await user.from(
          "conversation_attachment_uploads",
        ).select("id,actor_id,storage_path,mime_type,byte_length,status").eq(
          "id",
          id,
        ).maybeSingle();
        if (error) throw error;
        return data;
      },
      download: async (path) => {
        const { data, error } = await user.storage.from(
          "conversation-attachment-uploads",
        ).download(path);
        if (error) throw error;
        if (!data) throw new Error("File unavailable");
        return data;
      },
    };
  },
  verify: async (args) => {
    const { data, error } = await service.rpc(
      "verify_conversation_attachment",
      args,
    );
    if (error) throw error;
    return data;
  },
}));
