import { authorizeDelivery, DeliveryPolicyError, normalizePhone, requireEmailConfiguration } from "../_shared/delivery-policy.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-outbound-dispatch-token",
};

const DEFAULT_BATCH_SIZE = 25;
const MAX_BATCH_SIZE = 100;
const RETRY_DELAY_MS = 10 * 60 * 1000;

interface OutboundDelivery {
  id: string;
  channel: "EMAIL" | "SMS";
  recipient: string;
  payload: Record<string, unknown>;
  attempt_count: number;
  max_attempts: number;
}

interface DispatchBody {
  batch_size?: unknown;
  lease_owner?: unknown;
}

interface PreparedMessage {
  subject?: string;
  body: string;
}

interface ProviderResult {
  status: "ACCEPTED" | "FAILED" | "QUEUED" | "UNKNOWN";
  provider: "resend" | "twilio";
  providerMessageId: string | null;
  statusNote: string;
  errorText: string | null;
  nextAttemptAt: string | null;
}

interface DispatchCounters {
  claimed: number;
  processed: number;
  accepted: number;
  retrying: number;
  failed: number;
  unknown: number;
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

function parseBatchSize(value: unknown): number {
  if (value === undefined) return DEFAULT_BATCH_SIZE;
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > MAX_BATCH_SIZE) {
    throw new DeliveryPolicyError("Batch size must be between 1 and 100.", 400);
  }
  return Number(value);
}

function parseLeaseOwner(value: unknown): string {
  const requested = safeString(value, 128);
  return requested ?? `dispatch-outbound-deliveries-${Date.now()}`;
}

async function readBody(req: Request): Promise<DispatchBody> {
  const raw = await req.text();
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new DeliveryPolicyError("Request body must be a JSON object.", 400);
    }
    return parsed as DispatchBody;
  } catch (error) {
    if (error instanceof DeliveryPolicyError) throw error;
    throw new DeliveryPolicyError("Request body must be valid JSON.", 400);
  }
}

function assertDispatcherToken(req: Request) {
  const expected = Deno.env.get("OUTBOUND_DISPATCHER_TOKEN")?.trim();
  if (!expected) {
    throw new DeliveryPolicyError("Outbound dispatcher token is not configured.");
  }

  const supplied = req.headers.get("x-outbound-dispatch-token")?.trim();
  if (!supplied) {
    throw new DeliveryPolicyError("Missing outbound dispatcher token.", 401);
  }
  if (supplied !== expected) {
    throw new DeliveryPolicyError("Invalid outbound dispatcher token.", 403);
  }
}

function assertClaimableDeliveryMode() {
  const appEnv = Deno.env.get("APP_ENV");
  const mode = Deno.env.get("OUTBOUND_DELIVERY_MODE");
  if (!["development", "staging", "production"].includes(appEnv ?? "")) {
    throw new DeliveryPolicyError("Outbound delivery unavailable: APP_ENV is not configured correctly.");
  }
  if (!mode || mode === "disabled") {
    throw new DeliveryPolicyError("Outbound delivery is disabled.");
  }
  if (mode !== "test" && mode !== "live") {
    throw new DeliveryPolicyError("Outbound delivery unavailable: invalid delivery mode.");
  }
  if (mode === "live" && appEnv !== "production") {
    throw new DeliveryPolicyError("Live delivery requires the production environment.");
  }
}

function appointmentReminderMessage(delivery: OutboundDelivery): PreparedMessage {
  const petName = safeString(delivery.payload.pet_name, 80) ?? "your pet";
  const appointmentType = safeString(delivery.payload.appointment_type, 80) ?? "visit";
  const scheduledAt = safeString(delivery.payload.appointment_scheduled_at, 80);
  const scheduledText = scheduledAt ? ` scheduled for ${scheduledAt}` : "";
  const body = `Reminder: ${petName} has a ${appointmentType} appointment${scheduledText}. Please call The Living Room Vet if you need to reschedule.`;

  return {
    subject: `Appointment reminder for ${petName}`,
    body,
  };
}

function prepareMessage(delivery: OutboundDelivery): PreparedMessage {
  const fallback = delivery.payload.kind === "appointment_reminder"
    ? appointmentReminderMessage(delivery)
    : {
      subject: "Message from The Living Room Vet",
      body: "Please contact The Living Room Vet for details about this reminder.",
    };

  const body = safeString(delivery.payload.body, delivery.channel === "SMS" ? 1600 : 100000)
    ?? safeString(delivery.payload.text, delivery.channel === "SMS" ? 1600 : 100000)
    ?? fallback.body;
  const subject = delivery.channel === "EMAIL"
    ? safeString(delivery.payload.subject, 500) ?? fallback.subject ?? "Message from The Living Room Vet"
    : undefined;

  return { subject, body };
}

async function parseProviderJson(resp: Response): Promise<Record<string, unknown>> {
  try {
    const parsed = await resp.json();
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function retryOrFail(delivery: OutboundDelivery, provider: "resend" | "twilio", status: number): ProviderResult {
  const retryable = status >= 500 || [408, 409, 425, 429].includes(status);
  const canRetry = retryable && delivery.attempt_count < delivery.max_attempts;
  return {
    status: canRetry ? "QUEUED" : "FAILED",
    provider,
    providerMessageId: null,
    statusNote: canRetry
      ? `${provider === "resend" ? "Resend" : "Twilio"} returned HTTP ${status}; delivery will be retried.`
      : retryable
        ? `${provider === "resend" ? "Resend" : "Twilio"} returned HTTP ${status}; maximum attempts reached.`
        : `${provider === "resend" ? "Resend" : "Twilio"} returned HTTP ${status}; delivery will not be retried.`,
    errorText: `${provider === "resend" ? "Resend" : "Twilio"} HTTP ${status}`,
    nextAttemptAt: canRetry ? new Date(Date.now() + RETRY_DELAY_MS).toISOString() : null,
  };
}

async function sendEmail(delivery: OutboundDelivery, message: PreparedMessage): Promise<ProviderResult> {
  const permission = authorizeDelivery({
    APP_ENV: Deno.env.get("APP_ENV"),
    OUTBOUND_DELIVERY_MODE: Deno.env.get("OUTBOUND_DELIVERY_MODE"),
    OUTBOUND_TEST_EMAILS: Deno.env.get("OUTBOUND_TEST_EMAILS"),
    OUTBOUND_TEST_PHONES: Deno.env.get("OUTBOUND_TEST_PHONES"),
  }, "EMAIL", delivery.recipient);
  const emailConfig = requireEmailConfiguration({
    RESEND_API_KEY: Deno.env.get("RESEND_API_KEY"),
    RESEND_FROM: Deno.env.get("RESEND_FROM"),
    RESEND_REPLY_TO: Deno.env.get("RESEND_REPLY_TO"),
  });

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${emailConfig.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: emailConfig.from,
        reply_to: emailConfig.replyTo,
        to: [permission.recipient],
        subject: message.subject ?? "Message from The Living Room Vet",
        text: message.body,
      }),
    });

    if (!resp.ok) return retryOrFail(delivery, "resend", resp.status);

    const parsed = await parseProviderJson(resp);
    return {
      status: "ACCEPTED",
      provider: "resend",
      providerMessageId: safeString(parsed.id, 256),
      statusNote: "Resend accepted the request; delivery is unconfirmed (callbacks are not configured).",
      errorText: null,
      nextAttemptAt: null,
    };
  } catch {
    return {
      status: "UNKNOWN",
      provider: "resend",
      providerMessageId: null,
      statusNote: "Provider acceptance is unknown after a connection failure. Check provider activity before retrying.",
      errorText: "Provider request failed; acceptance is unknown.",
      nextAttemptAt: null,
    };
  }
}

async function sendSms(delivery: OutboundDelivery, message: PreparedMessage): Promise<ProviderResult> {
  const permission = authorizeDelivery({
    APP_ENV: Deno.env.get("APP_ENV"),
    OUTBOUND_DELIVERY_MODE: Deno.env.get("OUTBOUND_DELIVERY_MODE"),
    OUTBOUND_TEST_EMAILS: Deno.env.get("OUTBOUND_TEST_EMAILS"),
    OUTBOUND_TEST_PHONES: Deno.env.get("OUTBOUND_TEST_PHONES"),
  }, "SMS", delivery.recipient);
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const fromNumber = normalizePhone(Deno.env.get("TWILIO_FROM_NUMBER"));
  if (!accountSid || !/^AC[a-fA-F0-9]{32}$/.test(accountSid) || !authToken || !fromNumber) {
    throw new DeliveryPolicyError("SMS delivery requires valid Twilio configuration.");
  }

  try {
    const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: permission.recipient, From: fromNumber, Body: message.body }).toString(),
    });

    if (!resp.ok) return retryOrFail(delivery, "twilio", resp.status);

    const parsed = await parseProviderJson(resp);
    return {
      status: "ACCEPTED",
      provider: "twilio",
      providerMessageId: safeString(parsed.sid, 256),
      statusNote: "Twilio accepted the request; delivery is unconfirmed (callbacks are not configured).",
      errorText: null,
      nextAttemptAt: null,
    };
  } catch {
    return {
      status: "UNKNOWN",
      provider: "twilio",
      providerMessageId: null,
      statusNote: "Provider acceptance is unknown after a connection failure. Check provider activity before retrying.",
      errorText: "Provider request failed; acceptance is unknown.",
      nextAttemptAt: null,
    };
  }
}

async function dispatchDelivery(delivery: OutboundDelivery): Promise<ProviderResult> {
  if (delivery.channel !== "EMAIL" && delivery.channel !== "SMS") {
    return {
      status: "FAILED",
      provider: "resend",
      providerMessageId: null,
      statusNote: "Unsupported outbound delivery channel.",
      errorText: "Unsupported outbound delivery channel.",
      nextAttemptAt: null,
    };
  }

  const message = prepareMessage(delivery);
  if (delivery.channel === "EMAIL") return sendEmail(delivery, message);
  return sendSms(delivery, message);
}

function deliveryPolicyFailure(provider: "resend" | "twilio", error: DeliveryPolicyError): ProviderResult {
  return {
    status: "FAILED",
    provider,
    providerMessageId: null,
    statusNote: error.message,
    errorText: error.message,
    nextAttemptAt: null,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const counters: DispatchCounters = { claimed: 0, processed: 0, accepted: 0, retrying: 0, failed: 0, unknown: 0 };

  try {
    assertDispatcherToken(req);
    assertClaimableDeliveryMode();

    const body = await readBody(req);
    const batchSize = parseBatchSize(body.batch_size);
    const leaseOwner = parseLeaseOwner(body.lease_owner);
    const claimedAt = new Date().toISOString();
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: deliveries, error: claimError } = await supabase.rpc("claim_due_outbound_deliveries", {
      p_lease_owner: leaseOwner,
      p_batch_size: batchSize,
      p_lease_duration: "5 minutes",
      p_claimed_at: claimedAt,
    });
    if (claimError) throw claimError;

    const claimed = (deliveries ?? []) as OutboundDelivery[];
    counters.claimed = claimed.length;

    for (const delivery of claimed) {
      const provider = delivery.channel === "SMS" ? "twilio" : "resend";
      let result: ProviderResult;

      try {
        result = await dispatchDelivery(delivery);
      } catch (error) {
        if (error instanceof DeliveryPolicyError) {
          result = deliveryPolicyFailure(provider, error);
        } else {
          result = {
            status: "UNKNOWN",
            provider,
            providerMessageId: null,
            statusNote: "Provider acceptance is unknown after an internal dispatch failure. Check provider activity before retrying.",
            errorText: "Internal dispatch failure; acceptance is unknown.",
            nextAttemptAt: null,
          };
        }
      }

      const { error: recordError } = await supabase.rpc("record_outbound_delivery_result", {
        p_delivery_id: delivery.id,
        p_lease_owner: leaseOwner,
        p_status: result.status,
        p_provider: result.provider,
        p_provider_message_id: result.providerMessageId,
        p_status_note: result.statusNote,
        p_error_text: result.errorText,
        p_next_attempt_at: result.nextAttemptAt,
        p_recorded_at: new Date().toISOString(),
      });

      if (recordError) {
        return jsonResponse({
          success: false,
          settlement_failed: true,
          error: "Could not save an outbound delivery result. Check provider activity before retrying or releasing the lease.",
          ...counters,
        }, 500);
      }

      counters.processed += 1;
      if (result.status === "ACCEPTED") counters.accepted += 1;
      if (result.status === "QUEUED") counters.retrying += 1;
      if (result.status === "FAILED") counters.failed += 1;
      if (result.status === "UNKNOWN") counters.unknown += 1;
    }

    return jsonResponse({ success: true, ...counters });
  } catch (error) {
    if (error instanceof DeliveryPolicyError) {
      return jsonResponse({ success: false, error: error.message, ...counters }, error.status);
    }
    return jsonResponse({
      success: false,
      error: "Unable to dispatch outbound deliveries.",
      ...counters,
    }, 500);
  }
});
