import { authorizeDelivery, DeliveryPolicyError, type DeliveryPolicyEnvironment } from "./delivery-policy.ts";
import {
  assertCloudTalkMessage,
  classifyCloudTalkSmsResponse,
  CLOUDTALK_SMS_ENDPOINT,
  cloudTalkAcceptanceReference,
  cloudTalkRequestInit,
  cloudTalkSmsBody,
  cloudTalkSmsConfig,
  type CloudTalkSmsEnvironment,
  SmsProviderConfigurationError,
  selectSmsProvider,
} from "./cloudtalk-sms.ts";

// SMS leg of the legacy outbound_deliveries worker (dispatch-outbound-deliveries).
// Provider choice, the final consent/opt-out check and the CloudTalk request are
// kept here so they can be tested without the Deno entrypoint.

export interface OutboundSmsDelivery {
  id: string;
  recipient: string;
  attempt_count: number;
  max_attempts: number;
}

export interface OutboundSmsResult {
  status: "ACCEPTED" | "FAILED" | "QUEUED" | "UNKNOWN";
  provider: "resend" | "twilio" | "cloudtalk";
  providerMessageId: string | null;
  statusNote: string;
  errorText: string | null;
  nextAttemptAt: string | null;
}

export interface OutboundSmsEnvironment extends DeliveryPolicyEnvironment, CloudTalkSmsEnvironment {
  SMS_PROVIDER?: string;
}

export interface OutboundSmsDatabase {
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

export interface OutboundSmsDependencies {
  db: OutboundSmsDatabase;
  leaseOwner: string;
  transport?: typeof fetch;
  /** The unchanged Twilio sender, used only when SMS_PROVIDER=twilio. */
  sendTwilio: () => Promise<OutboundSmsResult>;
  now?: () => number;
  retryDelayMs?: number;
}

/** Throws before anything is claimed when SMS_PROVIDER is not an accepted value. */
export function assertOutboundSmsProvider(env: OutboundSmsEnvironment) {
  selectSmsProvider(env.SMS_PROVIDER);
}

function failed(provider: OutboundSmsResult["provider"], note: string): OutboundSmsResult {
  return { status: "FAILED", provider, providerMessageId: null, statusNote: note, errorText: note, nextAttemptAt: null };
}

export async function dispatchOutboundSms(
  delivery: OutboundSmsDelivery,
  body: string,
  env: OutboundSmsEnvironment,
  deps: OutboundSmsDependencies,
): Promise<OutboundSmsResult> {
  let provider: "cloudtalk" | "twilio";
  try {
    provider = selectSmsProvider(env.SMS_PROVIDER);
  } catch {
    return failed("cloudtalk", "SMS provider configuration is invalid; nothing was sent.");
  }
  let recipient: string;
  try {
    recipient = authorizeDelivery(env, "SMS", delivery.recipient).recipient;
  } catch (error) {
    if (error instanceof DeliveryPolicyError) return failed(provider, error.message);
    throw error;
  }
  // Consent and STOP opt-outs (CloudTalk or Twilio) are re-read at send time; a
  // queued row whose recipient has since opted out is never sent.
  const { data, error } = await deps.db.rpc("outbound_delivery_sms_permitted", {
    p_delivery_id: delivery.id,
    p_lease_owner: deps.leaseOwner,
  });
  if (error) throw error;
  if (data !== true) return failed(provider, "Recipient has opted out or has no SMS consent on record; nothing was sent.");

  if (provider === "twilio") return deps.sendTwilio();

  let config;
  try {
    config = cloudTalkSmsConfig(env);
    assertCloudTalkMessage(recipient, body);
  } catch (error) {
    if (error instanceof SmsProviderConfigurationError) return failed("cloudtalk", error.message);
    throw error;
  }
  const now = deps.now ?? Date.now;
  let outcome;
  try {
    outcome = await classifyCloudTalkSmsResponse(
      await (deps.transport ?? fetch)(
        CLOUDTALK_SMS_ENDPOINT,
        cloudTalkRequestInit(config, cloudTalkSmsBody(config.from, recipient, body)),
      ),
    );
  } catch {
    outcome = { kind: "ambiguous" as const, code: "cloudtalk_transport_unknown" };
  }
  if (outcome.kind === "accepted") {
    return {
      status: "ACCEPTED",
      provider: "cloudtalk",
      providerMessageId: cloudTalkAcceptanceReference(delivery.id, outcome.reference),
      statusNote: "CloudTalk accepted the request; handset delivery is unconfirmed.",
      errorText: null,
      nextAttemptAt: null,
    };
  }
  if (outcome.kind === "ambiguous") {
    // CloudTalk has no idempotency key, so an unknown result is not retried automatically.
    return {
      status: "UNKNOWN",
      provider: "cloudtalk",
      providerMessageId: null,
      statusNote: "CloudTalk acceptance is unknown. Check CloudTalk activity before any manual resend.",
      errorText: outcome.code,
      nextAttemptAt: null,
    };
  }
  const canRetry = outcome.retryable && delivery.attempt_count < delivery.max_attempts;
  return {
    status: canRetry ? "QUEUED" : "FAILED",
    provider: "cloudtalk",
    providerMessageId: null,
    statusNote: canRetry
      ? "CloudTalk throttled the request; nothing was sent and it will be retried."
      : outcome.retryable
      ? "CloudTalk throttled the request; maximum attempts reached."
      : "CloudTalk rejected the request; nothing was sent and it will not be retried.",
    errorText: outcome.code,
    nextAttemptAt: canRetry ? new Date(now() + (deps.retryDelayMs ?? 10 * 60 * 1000)).toISOString() : null,
  };
}
