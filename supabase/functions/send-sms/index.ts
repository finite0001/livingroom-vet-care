import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Verify JWT
    const anonKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader || "" } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { to, body, conversation_id } = await req.json();
    if (!to || !body || !conversation_id) {
      return new Response(JSON.stringify({ error: "Missing required fields: to, body, conversation_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Insert the message record
    const { error: msgError } = await supabase.from("messages").insert({
      conversation_id,
      content: body,
      type: "SMS",
      sender_type: "STAFF",
      sender_id: user.id,
      is_internal: false,
    });
    if (msgError) throw msgError;

    // Update conversation timestamps
    await supabase.from("conversations").update({
      last_message_at: new Date().toISOString(),
      is_read: true,
    }).eq("id", conversation_id);

    // TODO: Integrate Twilio for actual SMS delivery when TWILIO_* secrets are configured
    console.log(`[send-sms] Message recorded for ${to} in conversation ${conversation_id}. Twilio delivery pending configuration.`);

    return new Response(JSON.stringify({ success: true, delivered: false, note: "Message recorded. SMS delivery pending Twilio configuration." }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("send-sms error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
