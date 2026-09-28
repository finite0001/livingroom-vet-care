import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Webhook } from "npm:svix@2.5.0";
import { receiveResendDelivery } from "../_shared/inbound/handlers.ts";
import { WebhookError } from "../_shared/inbound/verification.ts";

// The single Resend webhook endpoint (Resend is outbound only since 2026-09-27).
// Delivery/bounce/complaint/failure receipts settle the canonical outbox (and,
// only when the outbox does not know the id, a legacy outbound_deliveries row).
// email.received is refused: client replies arrive through AgentMail.
// RESEND_DELIVERY_WEBHOOK_SECRET is this endpoint's own Svix signing secret; it
// is deliberately not shared with any other slug. verify_jwt=false: Svix proof
// over the raw body is verified before any database operation.
serve(async (req) => {
  try {
    const secret = Deno.env.get("RESEND_DELIVERY_WEBHOOK_SECRET");
    if (!secret) return new Response("Webhook unavailable", { status: 503 });
    const verifier = new Webhook(secret);
    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    await receiveResendDelivery(
      req,
      db,
      {
        RESEND_FROM: Deno.env.get("RESEND_FROM"),
        RESEND_AUTH_FROM_ADDRESS: Deno.env.get("RESEND_AUTH_FROM_ADDRESS"),
        AGENTMAIL_INBOX_ADDRESS: Deno.env.get("AGENTMAIL_INBOX_ADDRESS"),
      },
      (raw, headers) => verifier.verify(raw, headers),
      async ({ providerMessageId, status, note, errorText }) => {
        const { error } = await db.rpc("record_outbound_delivery_callback", {
          p_provider: "resend",
          p_provider_message_id: providerMessageId,
          p_status: status,
          p_status_note: note,
          p_error_text: errorText,
          p_recorded_at: new Date().toISOString(),
        });
        return !error;
      },
    );
    return new Response(null, { status: 204 });
  } catch (error) {
    return new Response(
      error instanceof WebhookError ? error.message : "Webhook unavailable",
      { status: error instanceof WebhookError ? error.status : 503 },
    );
  }
});
