import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import twilio from "npm:twilio@6.1.1";
import { receiveTwilio } from "../_shared/inbound/handlers.ts";
import { WebhookError } from "../_shared/inbound/verification.ts";
serve(async (req) => {
  try {
    const token = Deno.env.get("TWILIO_AUTH_TOKEN");
    if (!token) return new Response("Webhook unavailable", { status: 503 });
    await receiveTwilio(
      req,
      createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      ),
      {
        TWILIO_ACCOUNT_SID: Deno.env.get("TWILIO_ACCOUNT_SID"),
        TWILIO_FROM_NUMBER: Deno.env.get("TWILIO_FROM_NUMBER"),
        TWILIO_WEBHOOK_URL: Deno.env.get("TWILIO_WEBHOOK_URL"),
      },
      (signature, url, params) =>
        twilio.validateRequest(token, signature, url, params),
    );
    return new Response('<?xml version="1.0" encoding="UTF-8"?><Response/>', {
      headers: { "Content-Type": "text/xml" },
    });
  } catch (error) {
    return new Response(
      error instanceof WebhookError ? error.message : "Webhook unavailable",
      { status: error instanceof WebhookError ? error.status : 503 },
    );
  }
});
