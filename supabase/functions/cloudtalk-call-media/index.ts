import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: Record<string, unknown>, status: number) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
});

serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const bearer = request.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
  if (!bearer) return json({ error: "Staff authentication required" }, 401);
  const apiKey = Deno.env.get("CLOUDTALK_API_KEY_ID");
  const apiSecret = Deno.env.get("CLOUDTALK_API_KEY_SECRET");
  if (!apiKey || !apiSecret) return json({ error: "CloudTalk API unavailable" }, 503);
  try {
    const input = await request.json();
    if (!input || typeof input.call_uuid !== "string" || !input.call_uuid || input.call_uuid.length > 200 ||
        !["recording", "transcript"].includes(input.kind)) return json({ error: "Invalid call request" }, 400);
    const offset = input.offset ?? 0;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10000) return json({ error: "Invalid transcript page" }, 400);
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const auth = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${bearer}` } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data: userResult, error: userError } = await auth.auth.getUser(bearer);
    if (userError || !userResult.user) return json({ error: "Staff authentication required" }, 401);
    const { data: roles, error: rolesError } = await auth.from("user_roles").select("role").eq("user_id", userResult.user.id);
    if (rolesError) throw rolesError;
    if (!roles?.some((entry) => entry.role === "ADMIN")) return json({ error: "Recording and transcript access requires an administrator" }, 403);
    const { data: call, error: callError } = await auth.from("cloudtalk_calls")
      .select("call_id, ended_at, recording_ready, transcript_ready")
      .eq("call_uuid", input.call_uuid).maybeSingle();
    if (callError) throw callError;
    if (!call?.ended_at || !/^[1-9][0-9]{0,17}$/.test(call.call_id ?? "")) return json({ error: "Call unavailable" }, 404);
    if (input.kind === "recording" && !call.recording_ready) return json({ error: "Recording unavailable" }, 404);
    if (input.kind === "transcript" && !call.transcript_ready) return json({ error: "Transcript unavailable" }, 404);

    const endpoint = input.kind === "recording"
      ? `https://my.cloudtalk.io/api/calls/recording/${call.call_id}.json`
      : `https://api.cloudtalk.io/v1/ai/calls/${call.call_id}/transcription?limit=100&offset=${offset}`;
    const response = await fetch(endpoint, {
      headers: { Authorization: `Basic ${btoa(`${apiKey}:${apiSecret}`)}`, Accept: input.kind === "recording" ? "audio/x-wav" : "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) return json({ error: response.status === 404 || response.status === 410 ? "CloudTalk media unavailable" : "CloudTalk media request failed" }, response.status === 404 || response.status === 410 ? 404 : 502);
    const providerType = response.headers.get("content-type") ?? "";
    if (input.kind === "recording" && !/^(audio\/|application\/octet-stream)/i.test(providerType)) return json({ error: "CloudTalk recording response was invalid" }, 502);
    if (input.kind === "transcript" && !providerType.toLowerCase().includes("application/json")) return json({ error: "CloudTalk transcript response was invalid" }, 502);
    if (input.kind === "recording") {
      return new Response(response.body, { headers: { ...cors, "Content-Type": "audio/wav", "Cache-Control": "no-store", "Content-Disposition": `inline; filename="cloudtalk-${call.call_id}.wav"` } });
    }
    return new Response(response.body, { headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch {
    return json({ error: "CloudTalk media unavailable" }, 503);
  }
});
