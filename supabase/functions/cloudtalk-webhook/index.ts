import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyCloudTalkWebhook } from "../_shared/cloudtalk-webhook.ts";

serve(async (request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const secret = Deno.env.get("CLOUDTALK_WEBHOOK_SECRET") ?? "";
  const companyId = Deno.env.get("CLOUDTALK_COMPANY_ID") ?? "";
  const allowedNumbers = (Deno.env.get("CLOUDTALK_ALLOWED_NUMBERS") ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  if (!secret || !allowedNumbers.length) return new Response("Webhook unavailable", { status: 503 });
  try {
    const raw = await request.text();
    const event = await verifyCloudTalkWebhook(raw, request.headers, secret, companyId, allowedNumbers);
    if (!event) return new Response("Ignored", { status: 200 });
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { error } = await db.rpc("ingest_cloudtalk_event", {
      p_event_id: event.event_id,
      p_event_type: event.type,
      p_occurred_at: event.occurred_at,
      p_data: event.data,
    });
    if (error) throw error;
    return new Response("OK", { status: 200 });
  } catch (error) {
    // Invalid signatures and malformed events must not become trusted evidence.
    const invalid = error instanceof SyntaxError || (error instanceof Error && error.message.startsWith("Invalid CloudTalk"));
    return new Response(invalid ? "Invalid webhook" : "Webhook unavailable", { status: invalid ? 401 : 503 });
  }
});
