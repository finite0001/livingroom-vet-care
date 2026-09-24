import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, svix-id, svix-timestamp, svix-signature",
};

const MAX_SVIX_TIMESTAMP_DRIFT_SECONDS = 5 * 60;

interface ResendEvent {
  type?: unknown;
  data?: {
    email_id?: unknown;
    bounce?: {
      message?: unknown;
      subType?: unknown;
      type?: unknown;
    };
  };
}

interface CallbackResult {
  status: "DELIVERED" | "FAILED" | "UNKNOWN" | null;
  note: string;
  errorText: string | null;
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function safeString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function bytesToBase64(value: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(value)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left[index] ^ right[index];
  return mismatch === 0;
}

async function hmacSha256Base64(secret: string, value: string): Promise<string> {
  const normalizedSecret = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  const key = await crypto.subtle.importKey(
    "raw",
    base64ToBytes(normalizedSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return bytesToBase64(signature);
}

function svixSignatures(header: string): string[] {
  return header
    .split(" ")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      if (entry.startsWith("v1,")) return entry.slice(3);
      if (entry.startsWith("v1=")) return entry.slice(3);
      return "";
    })
    .filter(Boolean);
}

async function verifySvixSignature(req: Request, rawBody: string, secret: string): Promise<boolean> {
  const id = req.headers.get("svix-id")?.trim();
  const timestamp = req.headers.get("svix-timestamp")?.trim();
  const signature = req.headers.get("svix-signature")?.trim();
  if (!id || !timestamp || !signature) return false;

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) return false;
  const driftSeconds = Math.abs(Math.floor(Date.now() / 1000) - timestampSeconds);
  if (driftSeconds > MAX_SVIX_TIMESTAMP_DRIFT_SECONDS) return false;

  const expected = await hmacSha256Base64(secret, `${id}.${timestamp}.${rawBody}`);
  return svixSignatures(signature).some((candidate) => constantTimeEqual(candidate, expected));
}

function mapResendEvent(event: ResendEvent): CallbackResult {
  const type = safeString(event.type, 100);
  if (type === "email.delivered") {
    return {
      status: "DELIVERED",
      note: "Resend delivery webhook confirmed delivery.",
      errorText: null,
    };
  }
  if (["email.bounced", "email.failed", "email.complained", "email.suppressed"].includes(type ?? "")) {
    const bounceMessage = safeString(event.data?.bounce?.message, 300);
    return {
      status: "FAILED",
      note: `Resend webhook reported ${type}.`,
      errorText: bounceMessage ?? `Resend ${type}`,
    };
  }
  if (type === "email.delivery_delayed") {
    return {
      status: "UNKNOWN",
      note: "Resend webhook reported delayed delivery.",
      errorText: "Resend delivery delayed.",
    };
  }
  return {
    status: null,
    note: type ? `Resend webhook ${type} is not a delivery terminal event.` : "Resend webhook event type missing.",
    errorText: null,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const webhookSecret = Deno.env.get("RESEND_WEBHOOK_SECRET")?.trim();
    if (!webhookSecret) return jsonResponse({ success: false, error: "Resend webhook validation is not configured." }, 503);

    const rawBody = await req.text();
    const valid = await verifySvixSignature(req, rawBody, webhookSecret);
    if (!valid) return jsonResponse({ success: false, error: "Invalid Resend signature." }, 403);

    const event = JSON.parse(rawBody) as ResendEvent;
    const providerMessageId = safeString(event.data?.email_id, 256);
    if (!providerMessageId) return jsonResponse({ success: false, error: "Missing Resend email id." }, 400);

    const mapped = mapResendEvent(event);
    if (!mapped.status) return jsonResponse({ success: true, ignored: true, note: mapped.note });

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { error } = await supabase.rpc("record_outbound_delivery_callback", {
      p_provider: "resend",
      p_provider_message_id: providerMessageId,
      p_status: mapped.status,
      p_status_note: mapped.note,
      p_error_text: mapped.errorText,
      p_recorded_at: new Date().toISOString(),
    });

    if (error) {
      return jsonResponse({ success: false, error: "Unable to record Resend callback." }, 500);
    }
    return jsonResponse({ success: true, recorded: true, status: mapped.status });
  } catch {
    return jsonResponse({ success: false, error: "Unable to process Resend callback." }, 500);
  }
});
