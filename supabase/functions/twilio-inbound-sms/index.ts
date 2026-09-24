import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-twilio-signature",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function twimlResponse() {
  return new Response("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response />", {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "text/xml" },
  });
}

function safeString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left[index] ^ right[index];
  return mismatch === 0;
}

async function hmacSha1Base64(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  let binary = "";
  for (const byte of new Uint8Array(signature)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function verifyTwilioSignature(req: Request, rawBody: string, callbackUrl: string, authToken: string): Promise<boolean> {
  const signature = req.headers.get("x-twilio-signature")?.trim();
  if (!signature) return false;

  const params = [...new URLSearchParams(rawBody).entries()].sort(([left], [right]) => left.localeCompare(right));
  const signedValue = params.reduce((value, [key, paramValue]) => `${value}${key}${paramValue}`, callbackUrl);
  const expected = await hmacSha1Base64(authToken, signedValue);
  return constantTimeEqual(expected, signature);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const authToken = Deno.env.get("TWILIO_AUTH_TOKEN")?.trim();
    const callbackUrl = Deno.env.get("TWILIO_INBOUND_WEBHOOK_URL")?.trim() || req.url;
    if (!authToken) return jsonResponse({ success: false, error: "Twilio inbound webhook validation is not configured." }, 503);

    const rawBody = await req.text();
    const valid = await verifyTwilioSignature(req, rawBody, callbackUrl, authToken);
    if (!valid) return jsonResponse({ success: false, error: "Invalid Twilio signature." }, 403);

    const params = new URLSearchParams(rawBody);
    const from = safeString(params.get("From"), 64);
    const to = safeString(params.get("To"), 64);
    const body = safeString(params.get("Body"), 1600);
    const providerMessageId = safeString(params.get("MessageSid"), 256) ?? safeString(params.get("SmsMessageSid"), 256) ?? safeString(params.get("SmsSid"), 256);

    if (!from || !to || !body || !providerMessageId) {
      return jsonResponse({ success: false, error: "Missing required Twilio inbound message fields." }, 400);
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { error } = await supabase.rpc("record_inbound_sms", {
      p_from: from,
      p_to: to,
      p_body: body,
      p_provider_message_id: providerMessageId,
      p_opt_out_type: safeString(params.get("OptOutType"), 20),
      p_received_at: new Date().toISOString(),
    });

    if (error) {
      return jsonResponse({ success: false, error: "Unable to record inbound SMS." }, 500);
    }

    return twimlResponse();
  } catch {
    return jsonResponse({ success: false, error: "Unable to process inbound SMS." }, 500);
  }
});
