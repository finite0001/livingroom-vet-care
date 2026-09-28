import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Webhook } from "npm:svix@2.5.0";
import { receiveAgentMail } from "../_shared/inbound/agentmail.ts";
import { WebhookError } from "../_shared/inbound/verification.ts";
// AgentMail -> app inbound email. verify_jwt=false: AgentMail (via Svix) sends no
// Supabase token, so the Svix signature over the raw body, its five-minute
// timestamp tolerance and durable (provider,event_id) idempotency are the gate.
// Nothing touches the database before the proof verifies. Payloads, addresses
// and secrets are never logged.
serve(async (req) => {
  try {
    const secret = Deno.env.get("AGENTMAIL_WEBHOOK_SECRET");
    if (!secret) return new Response("Webhook unavailable", { status: 503 });
    const verifier = new Webhook(secret);
    const result = await receiveAgentMail(
      req,
      createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      ),
      {
        AGENTMAIL_INBOX_ID: Deno.env.get("AGENTMAIL_INBOX_ID"),
        AGENTMAIL_INBOX_ADDRESS: Deno.env.get("AGENTMAIL_INBOX_ADDRESS"),
      },
      (raw, headers) => verifier.verify(raw, headers),
    );
    // Acknowledge ignored event types with 2xx so Svix does not retry them.
    return new Response(null, { status: result && typeof result === "object" && "ignored" in result ? 202 : 204 });
  } catch (error) {
    return new Response(
      error instanceof WebhookError ? error.message : "Webhook unavailable",
      { status: error instanceof WebhookError ? error.status : 503 },
    );
  }
});
