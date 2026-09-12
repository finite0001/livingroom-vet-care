import { authorizeDelivery, DeliveryPolicyError, normalizeEmail, requireEmailConfiguration } from "../_shared/delivery-policy.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const STAFF_ROLES = new Set(["ADMIN", "DVM", "TECH", "STAFF"]);
function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
  let accepted = false;
  let acceptanceUnknown = false;
  try {
    const authHeader = req.headers.get("Authorization");
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader || "" } } });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return jsonResponse({ error: "Unauthorized" }, 401);

    const [profileRes, rolesRes] = await Promise.all([
      supabase.from("profiles").select("id, is_active").eq("id", user.id).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", user.id),
    ]);
    if (profileRes.error) throw profileRes.error;
    if (rolesRes.error) throw rolesRes.error;
    const roles = new Set((rolesRes.data ?? []).map((r: { role: string }) => r.role));
    const isActiveStaff = profileRes.data?.is_active === true && [...roles].some((r) => STAFF_ROLES.has(r as string));
    if (!isActiveStaff) return jsonResponse({ error: "Forbidden" }, 403);

    const { to, subject, body, conversation_id } = await req.json();
    if (!to || !subject || !body || !conversation_id) return jsonResponse({ error: "Missing required fields" }, 400);
    if (typeof body !== "string" || body.trim().length === 0 || body.length > 100000) return jsonResponse({ error: "Invalid body" }, 400);
    if (typeof subject !== "string" || subject.trim().length === 0 || subject.length > 500) return jsonResponse({ error: "Invalid subject" }, 400);

    const { data: conversation, error: convError } = await supabase.from("conversations").select("id, client_id").eq("id", conversation_id).maybeSingle();
    if (convError) throw convError;
    if (!conversation) return jsonResponse({ error: "Conversation not found" }, 404);

    const { data: client, error: clientError } = await supabase.from("clients").select("primary_email").eq("id", conversation.client_id).maybeSingle();
    if (clientError) throw clientError;
    if (!normalizeEmail(to) || !client?.primary_email || normalizeEmail(client.primary_email) !== normalizeEmail(to)) {
      return jsonResponse({ error: "Recipient does not match the conversation client" }, 403);
    }

    const delivery = authorizeDelivery({
      APP_ENV: Deno.env.get("APP_ENV"),
      OUTBOUND_DELIVERY_MODE: Deno.env.get("OUTBOUND_DELIVERY_MODE"),
      OUTBOUND_TEST_EMAILS: Deno.env.get("OUTBOUND_TEST_EMAILS"),
      OUTBOUND_TEST_PHONES: Deno.env.get("OUTBOUND_TEST_PHONES"),
    }, "EMAIL", to);
    const emailConfig = requireEmailConfiguration({
      RESEND_API_KEY: Deno.env.get("RESEND_API_KEY"),
      RESEND_FROM: Deno.env.get("RESEND_FROM"),
      RESEND_REPLY_TO: Deno.env.get("RESEND_REPLY_TO"),
    });

    const { data: inserted, error: msgError } = await supabase.from("messages").insert({
      conversation_id, content: body.trim(), type: "EMAIL", sender_type: "STAFF", sender_id: user.id, is_internal: false,
    }).select("id").single();
    if (msgError) throw msgError;

    const { error: updateError } = await supabase.from("conversations").update({ last_message_at: new Date().toISOString(), is_read: true }).eq("id", conversation_id);
    if (updateError) throw updateError;

    const delivered = false;
    let statusNote = "";
    let errorText: string | null = null;
    try {
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${emailConfig.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: emailConfig.from, reply_to: emailConfig.replyTo, to: [delivery.recipient], subject: String(subject), text: body.trim() }),
      });
      accepted = resp.ok;
      statusNote = accepted
        ? "Resend accepted the request; delivery is unconfirmed (callbacks are not configured)."
        : "Resend rejected the request; message was not accepted.";
      if (!accepted) errorText = `Resend HTTP ${resp.status}`;
    } catch {
      acceptanceUnknown = true;
      errorText = "Provider request failed; acceptance is unknown.";
      statusNote = "Provider acceptance is unknown after a connection failure. Check provider activity before retrying.";
    }

    const { error: logError } = await supabase.from("outbound_message_attempts").insert({
      user_id: user.id, conversation_id, client_id: conversation.client_id, message_id: inserted?.id ?? null,
      channel: "EMAIL", recipient: delivery.recipient, delivered, provider: "resend", status_note: statusNote, error_text: errorText,
    });

    if (logError) {
      return jsonResponse({ success: false, accepted, acceptance_unknown: acceptanceUnknown, delivered, retry_safe: false,
        error: "Could not save the delivery audit record. Check provider activity before retrying.", note: statusNote }, 500);
    }

    return jsonResponse({ success: accepted, accepted, acceptance_unknown: acceptanceUnknown, retry_safe: false, delivered, note: statusNote, message_id: inserted?.id ?? null });
  } catch (e) {
    if (e instanceof DeliveryPolicyError) return jsonResponse({ success: false, accepted: false, delivered: false, error: e.message }, e.status);
    // Database/provider exceptions can contain personal data; do not return or log raw errors.
    return jsonResponse({ success: false, accepted, acceptance_unknown: acceptanceUnknown, retry_safe: false, delivered: false, error: "Unable to process this delivery request. Check provider activity before retrying if a send was attempted." }, 500);
  }
});
