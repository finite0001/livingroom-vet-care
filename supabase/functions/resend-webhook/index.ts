import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Webhook } from "npm:svix@2.5.0";
import { receiveResend } from "../_shared/inbound/handlers.ts";
import { WebhookError } from "../_shared/inbound/verification.ts";
serve(async (req) => {
  try {
    const secret = Deno.env.get("RESEND_WEBHOOK_SECRET");
    if (!secret) return new Response("Webhook unavailable", { status: 503 });
    const verifier = new Webhook(secret);
    await receiveResend(
      req,
      createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      ),
      { RESEND_INBOUND_ADDRESSES: Deno.env.get("RESEND_INBOUND_ADDRESSES") },
      (raw, headers) => verifier.verify(raw, headers),
    );
    return new Response(null, { status: 204 });
  } catch (error) {
    return new Response(
      error instanceof WebhookError ? error.message : "Webhook unavailable",
      { status: error instanceof WebhookError ? error.status : 503 },
    );
  }
});
