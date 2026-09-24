import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.3";
import { createInboundAttachmentCaptureHandler } from "../_shared/inbound/capture-attachment.ts";
import { retrieveResendAttachment } from "../_shared/inbound/resend-attachment.ts";
import { storeIncomingOriginal } from "../_shared/inbound/store-attachment.ts";
const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const handler = createInboundAttachmentCaptureHandler({
  authenticate: async token => {
    const { data, error } = await service.auth.getUser(token);
    if (error || !data.user) return null;
    return data.user.id;
  },
  claim: async input => {
    const { data, error } = await service.rpc("claim_inbound_attachment", {
      p_inbound_id: input.inboundId, p_attachment_id: input.attachmentId, p_version: input.version, p_actor_id: input.actorId,
    });
    if (error) throw error;
    return data;
  },
  retrieve: (emailId, metadata) => retrieveResendAttachment(emailId, metadata, Deno.env.get("RESEND_API_KEY") || ""),
  store: (path, captured) => storeIncomingOriginal(service.storage.from("inbound-attachment-originals"), path, captured),
  finalize: async (lease, captured) => {
    const { data, error } = await service.rpc("finalize_inbound_attachment", {
      p_id: lease.id, p_actor_id: lease.actor_id, p_token: lease.token, p_sha256: captured.sha256,
      p_byte_length: captured.bytes.length, p_mime_type: captured.mimeType,
    });
    if (error) throw error;
    return data;
  },
});
Deno.serve(request => {
  if (request.method !== "OPTIONS" && Deno.env.get("INBOUND_ATTACHMENT_CAPTURE_ENABLED") !== "true") {
    return new Response(JSON.stringify({ error: "Incoming file capture is not yet available" }), {
      status: 503, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" },
    });
  }
  return handler(request);
});
