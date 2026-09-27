import { normalizePhone } from "./delivery-policy.ts";

// Outbound SMS provider selection and the CloudTalk send adapter.
//
// Contract source (verified 2026-09-27):
//   https://developers.cloudtalk.io/api-reference/sms/send-sms
//   https://developers.cloudtalk.io/api-reference/openapi.json  (POST /sms/send.json, server https://my.cloudtalk.io/api)
//   https://developers.cloudtalk.io/guides/authentication        (HTTP Basic, Access Key ID : Secret)
//   https://developers.cloudtalk.io/guides/rate-limiting         (60 requests/minute per company, HTTP 429)
//   https://developers.cloudtalk.io/guides/error-codes           (responseData error envelope; 403 insufficient funds or edge block)
//   https://developers.cloudtalk.io/guides/quickstart            (User-Agent is required by the edge)
//
// CloudTalk's documented success response carries no message identifier, and
// HTTP 200 may still report `success: false` with a provider error string. Every
// interpretation of the response lives in classifyCloudTalkSmsResponse so an
// undocumented detail can be corrected in one place.

export type SmsProvider = "cloudtalk" | "twilio";

export const CLOUDTALK_SMS_ENDPOINT = "https://my.cloudtalk.io/api/sms/send.json";
// CloudTalk documents no maximum body; the outbox stores at most 1,600 characters
// (Twilio's concatenation ceiling), and the dispatcher refuses anything longer.
export const CLOUDTALK_SMS_MAX_LENGTH = 1600;
const USER_AGENT = "LivingRoomVet-Outbox/1.0";

export class SmsProviderConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmsProviderConfigurationError";
  }
}

/**
 * Owner decision 2026-09-27: all SMS runs through CloudTalk. An unset
 * SMS_PROVIDER therefore means CloudTalk. Twilio requires the explicit value
 * "twilio"; anything else (including blank or differently cased values) is a
 * configuration error and must fail closed. There is no fallback between providers.
 */
export function selectSmsProvider(value: string | undefined): SmsProvider {
  if (value === undefined) return "cloudtalk";
  if (value === "cloudtalk" || value === "twilio") return value;
  throw new SmsProviderConfigurationError("SMS_PROVIDER must be cloudtalk or twilio");
}

export interface CloudTalkSmsEnvironment {
  CLOUDTALK_API_KEY_ID?: string;
  CLOUDTALK_API_KEY_SECRET?: string;
  CLOUDTALK_ALLOWED_NUMBERS?: string;
  CLOUDTALK_SMS_SENDER?: string;
}

export interface CloudTalkSmsConfig {
  keyId: string;
  keySecret: string;
  from: string;
}

function allowedNumbers(raw: string | undefined): string[] {
  const entries = (raw ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
  // Every entry must already be exact E.164; a malformed list is not partially trusted.
  if (!entries.length || entries.some((entry) => normalizePhone(entry) !== entry)) {
    throw new SmsProviderConfigurationError("CLOUDTALK_ALLOWED_NUMBERS is not a valid E.164 list");
  }
  return entries;
}

/**
 * The sender is CLOUDTALK_SMS_SENDER when set, otherwise the single practice
 * number in CLOUDTALK_ALLOWED_NUMBERS. It must always be one of the allowed
 * practice numbers, so a mistyped sender can never text from another line.
 */
export function cloudTalkSmsConfig(env: CloudTalkSmsEnvironment): CloudTalkSmsConfig {
  const keyId = env.CLOUDTALK_API_KEY_ID?.trim();
  const keySecret = env.CLOUDTALK_API_KEY_SECRET?.trim();
  if (!keyId || !keySecret || keyId.includes(":")) {
    throw new SmsProviderConfigurationError("CloudTalk API credentials are unavailable");
  }
  const allowed = allowedNumbers(env.CLOUDTALK_ALLOWED_NUMBERS);
  const configured = env.CLOUDTALK_SMS_SENDER?.trim();
  const from = configured ? normalizePhone(configured) : allowed.length === 1 ? allowed[0] : null;
  if (!from || (configured && from !== configured) || !allowed.includes(from)) {
    throw new SmsProviderConfigurationError("CloudTalk SMS sender is not an allowed practice number");
  }
  return { keyId, keySecret, from };
}

/** Frozen, credential-free sender metadata stored on the outbox row before the first request. */
export function cloudTalkSenderMetadata(from: string): Record<string, string> {
  return { from, provider: "cloudtalk" };
}

export function isCloudTalkSender(sender: Record<string, string>): boolean {
  return Object.keys(sender).sort().join() === "from,provider" && sender.provider === "cloudtalk" &&
    normalizePhone(sender.from) === sender.from;
}

/** Deterministic JSON body; also the frozen payload for reviewed payment-link texts. */
export function cloudTalkSmsBody(sender: string, recipient: string, message: string): string {
  return JSON.stringify({ recipient, message, sender });
}

export function assertCloudTalkMessage(recipient: string, message: string) {
  if (normalizePhone(recipient) !== recipient || !message.trim() || message.length > CLOUDTALK_SMS_MAX_LENGTH) {
    throw new SmsProviderConfigurationError("CloudTalk SMS recipient or message is invalid");
  }
}

export function cloudTalkRequestInit(config: CloudTalkSmsConfig, body: string): RequestInit {
  return {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(30000),
    headers: {
      Authorization: `Basic ${btoa(`${config.keyId}:${config.keySecret}`)}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    },
    body,
  };
}

export type CloudTalkSmsOutcome =
  // CloudTalk reported the message as sent to its carrier. Not handset delivery.
  | { kind: "accepted"; reference: string | null }
  // CloudTalk refused the request; nothing was sent. `retryable` marks throttling.
  | { kind: "rejected"; retryable: boolean; code: string }
  // A message may or may not have left CloudTalk. Never resend automatically.
  | { kind: "ambiguous"; code: string };

const knownFailures: Record<string, string> = {
  "sms send failed": "send_failed",
  "not allowed country.": "country_not_allowed",
  "unknown number": "unknown_number",
  "limit exceeded": "limit_exceeded",
  "bad number configuration": "bad_number_configuration",
};

/**
 * Maps a CloudTalk HTTP response to an outcome. Documented: 200 with
 * responseData.success; 400/401/403/406 client errors; 429 throttling; 500.
 * Unverified and handled conservatively: whether `success` is a boolean or the
 * string "true" (the published example shows a string placeholder), and whether
 * any message id is ever present in `data` (captured only if it is).
 */
export async function classifyCloudTalkSmsResponse(response: Response): Promise<CloudTalkSmsOutcome> {
  if (response.status === 429) return { kind: "rejected", retryable: true, code: "cloudtalk_http_429" };
  if (response.status >= 500 || response.status === 408 || response.status === 409) {
    return { kind: "ambiguous", code: `cloudtalk_http_${response.status}` };
  }
  if (response.status !== 200 && response.status !== 201) {
    if (response.status >= 400) return { kind: "rejected", retryable: false, code: `cloudtalk_http_${response.status}` };
    return { kind: "ambiguous", code: `cloudtalk_http_${response.status}` };
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { kind: "ambiguous", code: "cloudtalk_response_unreadable" };
  }
  const envelope = payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>).responseData
    : null;
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    return { kind: "ambiguous", code: "cloudtalk_response_unreadable" };
  }
  const { success, data } = envelope as Record<string, unknown>;
  if (success === true || success === "true") {
    const id = data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>).id
      : null;
    const reference = (typeof id === "string" || typeof id === "number") && /^[A-Za-z0-9_-]{1,100}$/.test(String(id))
      ? String(id)
      : null;
    return { kind: "accepted", reference };
  }
  if (success === false || success === "false") {
    const reason = typeof data === "string" ? knownFailures[data.trim().toLowerCase()] ?? "rejected" : "rejected";
    return { kind: "rejected", retryable: reason === "limit_exceeded", code: `cloudtalk_${reason}` };
  }
  return { kind: "ambiguous", code: "cloudtalk_response_unreadable" };
}

/**
 * CloudTalk returns no message id, but the outbox requires a unique acceptance
 * reference. A returned id is used when present; otherwise the reference is
 * derived from the local row id and prefixed so it can never be mistaken for a
 * CloudTalk identifier.
 */
export function cloudTalkAcceptanceReference(localId: string, reference: string | null): string {
  return reference ? `cloudtalk:${reference}` : `local-accepted:${localId}`;
}
