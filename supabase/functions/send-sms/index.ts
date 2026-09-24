import { authorizeDelivery, DeliveryPolicyError, normalizePhone } from "../_shared/delivery-policy.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const STAFF_ROLES = new Set(["ADMIN", "DVM", "TECH", "STAFF"]);

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}


serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader || "" } },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const [profileRes, rolesRes] = await Promise.all([
      supabase.from("profiles").select("id, is_active").eq("id", user.id).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", user.id),
    ]);
    if (profileRes.error) throw profileRes.error;
    if (rolesRes.error) throw rolesRes.error;

    const roles = new Set((rolesRes.data ?? []).map((row: { role: string }) => row.role));
    const isActiveStaff = profileRes.data?.is_active === true && [...roles].some((role) => STAFF_ROLES.has(role as string));
    if (!isActiveStaff) {
      return jsonResponse({ error: "Forbidden" }, 403);
    }

    const { to, body, conversation_id } = await req.json();
    if (!to || !body || !conversation_id) {
      return jsonResponse({ error: "Missing required fields: to, body, conversation_id" }, 400);
    }
    if (typeof body !== "string" || body.trim().length === 0 || body.length > 1600) {
      return jsonResponse({ error: "Message body must be between 1 and 1600 characters" }, 400);
    }

    const { data: conversation, error: convError } = await supabase
      .from("conversations")
      .select("id, client_id")
      .eq("id", conversation_id)
      .maybeSingle();
    if (convError) throw convError;
    if (!conversation) {
      return jsonResponse({ error: "Conversation not found" }, 404);
    }

    const { data: client, error: clientError } = await supabase
      .from("clients")
      .select("primary_phone")
      .eq("id", conversation.client_id)
      .maybeSingle();
    if (clientError) throw clientError;
    if (!normalizePhone(to) || !client?.primary_phone || normalizePhone(client.primary_phone) !== normalizePhone(to)) {
      return jsonResponse({ error: "Recipient does not match the conversation client" }, 403);
    }

    const { data: consentRows, error: consentError } = await supabase
      .from("sms_consent")
      .select("phone_number, opted_in")
      .eq("client_id", conversation.client_id);
    if (consentError) throw consentError;
    const consentForNumber = (consentRows ?? []).filter(
      (r) => normalizePhone(r.phone_number ?? "") === normalizePhone(to)
    );
    if (!consentForNumber.length || consentForNumber.some((row) => row.opted_in !== true)) {
      return jsonResponse({ error: "No SMS consent on record for this number" }, 403);
    }



    const delivery = authorizeDelivery({
      APP_ENV: Deno.env.get("APP_ENV"),
      OUTBOUND_DELIVERY_MODE: Deno.env.get("OUTBOUND_DELIVERY_MODE"),
      OUTBOUND_TEST_EMAILS: Deno.env.get("OUTBOUND_TEST_EMAILS"),
      OUTBOUND_TEST_PHONES: Deno.env.get("OUTBOUND_TEST_PHONES"),
    }, "SMS", to);
    const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
    const fromNumber = normalizePhone(Deno.env.get("TWILIO_FROM_NUMBER"));
    if (!accountSid || !/^AC[a-fA-F0-9]{32}$/.test(accountSid) || !authToken || !fromNumber) {
      throw new DeliveryPolicyError("SMS delivery requires valid Twilio configuration.");
    }

    const { data: queuedRows, error: queueError } = await supabase.rpc("enqueue_staff_outbound_message", {
      p_actor_id: user.id,
      p_conversation_id: conversation_id,
      p_channel: "SMS",
      p_recipient: delivery.recipient,
      p_subject: null,
      p_body: body.trim(),
      p_requested_at: new Date().toISOString(),
    });
    if (queueError) throw queueError;
    const queued = Array.isArray(queuedRows) ? queuedRows[0] : queuedRows;
    return jsonResponse({
      success: true,
      queued: true,
      accepted: false,
      acceptance_unknown: false,
      retry_safe: false,
      delivered: false,
      note: "SMS queued for outbound delivery; provider delivery is not yet confirmed.",
      message_id: queued?.message_id ?? null,
      outbound_delivery_id: queued?.outbound_delivery_id ?? null,
    });

  } catch (e) {
    if (e instanceof DeliveryPolicyError) return jsonResponse({ success: false, queued: false, accepted: false, delivered: false, error: e.message }, e.status);
    // Database exceptions can contain personal data; do not return or log raw errors.
    return jsonResponse({
      success: false,
      queued: false,
      accepted: false,
      acceptance_unknown: false,
      retry_safe: true,
      delivered: false,
      error: "Unable to queue this delivery request. No provider request was made; your draft has been kept.",
    }, 500);
  }
});
