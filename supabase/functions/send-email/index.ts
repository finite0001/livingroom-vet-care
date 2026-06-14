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
  try {
    const authHeader = req.headers.get("Authorization");
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader || "" } } });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return jsonResponse({ error: "Unauthorized" }, 401);

    const [profileRes, rolesRes] = await Promise.all([
      supabase.from("profiles").select("id, is_active, role").eq("id", user.id).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", user.id),
    ]);
    if (profileRes.error) throw profileRes.error;
    const roles = new Set([profileRes.data?.role, ...(rolesRes.data ?? []).map((r: { role: string }) => r.role)].filter(Boolean));
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
    if (!client?.primary_email || client.primary_email.toLowerCase() !== String(to).toLowerCase()) {
      return jsonResponse({ error: "Recipient does not match the conversation client" }, 403);
    }

    const { data: inserted, error: msgError } = await supabase.from("messages").insert({
      conversation_id, content: body.trim(), type: "EMAIL", sender_type: "STAFF", sender_id: user.id, is_internal: false,
    }).select("id").single();
    if (msgError) throw msgError;

    await supabase.from("conversations").update({ last_message_at: new Date().toISOString(), is_read: true }).eq("id", conversation_id);

    const resendKey = Deno.env.get("RESEND_API_KEY");
    const fromAddress = Deno.env.get("RESEND_FROM");
    let delivered = false;
    let statusNote = "Message recorded. Email delivery pending Resend configuration.";
    let errorText: string | null = null;
    if (resendKey && fromAddress) {
      try {
        const resp = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from: fromAddress, to: [String(to)], subject: String(subject), text: body.trim() }),
        });
        if (resp.ok) { delivered = true; statusNote = "Email sent via Resend."; }
        else { errorText = `Resend ${resp.status}: ${await resp.text()}`; statusNote = "Resend send failed."; }
      } catch (e) { errorText = e instanceof Error ? e.message : "Resend request failed"; statusNote = "Resend send failed."; }
    }

    await supabase.from("outbound_message_attempts").insert({
      user_id: user.id, conversation_id, client_id: conversation.client_id, message_id: inserted?.id ?? null,
      channel: "EMAIL", recipient: String(to), delivered, provider: resendKey ? "resend" : null, status_note: statusNote, error_text: errorText,
    });

    return jsonResponse({ success: true, delivered, note: statusNote, message_id: inserted?.id ?? null });
  } catch (e) {
    console.error("send-email error:", e);
    return jsonResponse({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
