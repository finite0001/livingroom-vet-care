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

function normalizePhone(phone: string) {
  return phone.replace(/\D/g, "");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

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
      supabase.from("profiles").select("id, is_active, role").eq("id", user.id).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", user.id),
    ]);
    if (profileRes.error) throw profileRes.error;

    const profileRole = typeof profileRes.data?.role === "string" ? profileRes.data.role : null;
    const roles = new Set([profileRole, ...(rolesRes.data ?? []).map((row: { role: string }) => row.role)].filter(Boolean));
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
    if (!client?.primary_phone || normalizePhone(client.primary_phone) !== normalizePhone(String(to))) {
      return jsonResponse({ error: "Recipient does not match the conversation client" }, 403);
    }

    const { data: consentRows, error: consentError } = await supabase
      .from("sms_consent")
      .select("phone_number, opted_in")
      .eq("client_id", conversation.client_id);
    if (consentError) throw consentError;
    const consentForNumber = (consentRows ?? []).find(
      (r) => normalizePhone(r.phone_number ?? "") === normalizePhone(String(to))
    );
    if (consentForNumber?.opted_in !== true) {
      return jsonResponse({ error: "No SMS consent on record for this number" }, 403);
    }



    const { data: inserted, error: msgError } = await supabase.from("messages").insert({
      conversation_id,
      content: body.trim(),
      type: "SMS",
      sender_type: "STAFF",
      sender_id: user.id,
      is_internal: false,
    }).select("id").single();
    if (msgError) throw msgError;

    await supabase.from("conversations").update({
      last_message_at: new Date().toISOString(),
      is_read: true,
    }).eq("id", conversation_id);

    const twilioConfigured = !!Deno.env.get("TWILIO_API_KEY");
    const delivered = false; // Twilio delivery not yet wired
    const statusNote = twilioConfigured
      ? "Twilio configured but delivery path not yet implemented."
      : "Message recorded. SMS delivery pending Twilio configuration.";

    await supabase.from("outbound_message_attempts").insert({
      user_id: user.id,
      conversation_id,
      client_id: conversation.client_id,
      message_id: inserted?.id ?? null,
      channel: "SMS",
      recipient: String(to),
      delivered,
      provider: twilioConfigured ? "twilio" : null,
      status_note: statusNote,
      error_text: null,
    });

    console.log(`[send-sms] Recorded message ${inserted?.id} for conversation ${conversation_id} (delivered=${delivered}).`);

    return jsonResponse({
      success: true,
      delivered,
      note: statusNote,
      message_id: inserted?.id ?? null,
    });

  } catch (e) {
    console.error("send-sms error:", e);
    return jsonResponse({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
