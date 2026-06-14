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

function redactMessage(content: string | null) {
  if (!content) return "(no text)";
  return content
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[phone]");
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

    const { conversation_id } = await req.json();
    if (!conversation_id) {
      return jsonResponse({ suggestions: [] });
    }
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (typeof conversation_id !== "string" || !UUID_RE.test(conversation_id)) {
      return jsonResponse({ error: "Invalid conversation_id", suggestions: [] }, 400);
    }

    const { data: conversation, error: convError } = await supabase
      .from("conversations")
      .select("id")
      .eq("id", conversation_id)
      .maybeSingle();
    if (convError) throw convError;
    if (!conversation) {
      return jsonResponse({ error: "Conversation not found", suggestions: [] }, 404);
    }

    const { data: messages } = await supabase
      .from("messages")
      .select("content, sender_type, type, created_at")
      .eq("conversation_id", conversation_id)
      .eq("is_internal", false)
      .order("created_at", { ascending: false })
      .limit(10);

    if (!messages || messages.length === 0) {
      return jsonResponse({ suggestions: ["Hi! How can I help you today?", "Thank you for reaching out!", "We'd be happy to help with that."] });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return jsonResponse({ suggestions: ["Thank you for your message!", "Let me look into that for you.", "Is there anything else I can help with?"] });
    }

    const transcript = messages.reverse().map((m) =>
      `${m.sender_type === "CLIENT" ? "Client" : "Staff"}: ${redactMessage(m.content).slice(0, 800)}`
    ).join("\n");

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content: `You are a helpful assistant for a veterinary clinic called The Living Room Vet. Generate exactly 3 short SMS reply suggestions (under 160 chars each) that a staff member could send to the client. Be warm, professional, and concise. Return ONLY a JSON array of 3 strings, no other text.`,
          },
          {
            role: "user",
            content: `Here is the recent conversation:\n${transcript}\n\nGenerate 3 reply suggestions.`,
          },
        ],
        temperature: 0.7,
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error("AI gateway error:", aiResponse.status, errText);
      return jsonResponse({ suggestions: ["Thank you for your message!", "Let me check on that for you.", "We'll get back to you shortly."] });
    }

    const aiData = await aiResponse.json();
    const raw = aiData.choices?.[0]?.message?.content || "[]";

    let suggestions: string[];
    try {
      const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      suggestions = JSON.parse(cleaned);
      if (!Array.isArray(suggestions)) suggestions = [];
      suggestions = suggestions.filter((s: any) => typeof s === "string").slice(0, 3);
    } catch {
      suggestions = ["Thank you for your message!", "Let me check on that for you.", "We'll get back to you shortly."];
    }

    return jsonResponse({ suggestions });
  } catch (e) {
    console.error("suggest-replies error:", e);
    return jsonResponse({ suggestions: [] }, 500);
  }
});
