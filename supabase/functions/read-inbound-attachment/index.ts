import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.3";
import { createIncomingAttachmentReadHandler } from "../_shared/inbound/read-attachment.ts";
const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const handler = createIncomingAttachmentReadHandler({
  authenticate: async token => {
    const { data, error } = await service.auth.getUser(token);
    if (error || !data.user) return null;
    return data.user.id;
  },
  authorize: async (actorId, captureId, messageId) => {
    const { data, error } = await service.rpc("authorize_inbound_attachment_read", { p_actor_id: actorId, p_capture_id: captureId, p_message_id: messageId });
    if (error) throw error;
    return data;
  },
  download: async path => {
    const { data, error } = await service.storage.from("inbound-attachment-originals").download(path);
    if (error) throw error;
    if (!data) throw new Error("Incoming original unavailable");
    return data;
  },
});
Deno.serve(request => {
  if (request.method !== "OPTIONS" && Deno.env.get("INBOUND_ATTACHMENT_CAPTURE_ENABLED") !== "true") {
    return Response.json({ error: "Incoming file access is not yet available" }, {
      status: 503, headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" },
    });
  }
  return handler(request);
});
