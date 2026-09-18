import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.3";
import { createCaptureConversationEmailHandler } from "../_shared/capture-conversation-email.ts";
const url = Deno.env.get("SUPABASE_URL")!;
const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
Deno.serve(createCaptureConversationEmailHandler({
  authenticate: async (token) => {
    const { data, error } = await service.auth.getUser(token);
    if (error || !data.user) return null;
    const user = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return {
      actorId: data.user.id,
      download: async (path) => {
        const { data, error } = await user.storage.from("conversation-attachment-uploads").download(path);
        if (error) throw error;
        if (!data) throw new Error("File unavailable");
        return data;
      },
      readReview: async (requestId) => {
        const { data, error } = await user.rpc("read_conversation_email_review", { p_request_id: requestId });
        if (error) throw error;
        return data;
      },
    };
  },
  context: async (requestId, actorId) => {
    const { data, error } = await service.rpc("conversation_email_capture_context", {
      p_request_id: requestId, p_actor_id: actorId,
    });
    if (error) throw error;
    return data;
  },
  capture: async (requestId, actorId, payloadText) => {
    const { error } = await service.rpc("capture_conversation_email", {
      p_request_id: requestId, p_actor_id: actorId, p_payload_text: payloadText,
    });
    if (error) throw error;
  },
  sender: () => ({ from: Deno.env.get("RESEND_FROM") || "", replyTo: Deno.env.get("RESEND_REPLY_TO") || "" }),
}));
