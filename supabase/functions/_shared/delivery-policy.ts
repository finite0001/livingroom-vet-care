export type DeliveryChannel = "EMAIL" | "SMS";
export interface DeliveryPolicyEnvironment {
  APP_ENV?: string;
  OUTBOUND_DELIVERY_MODE?: string;
  OUTBOUND_TEST_EMAILS?: string;
  OUTBOUND_TEST_PHONES?: string;
}
export interface DeliveryPermission {
  recipient: string;
  mode: "test" | "live";
}
export class DeliveryPolicyError extends Error {
  status: number;
  constructor(message: string, status = 503) {
    super(message);
    this.name = "DeliveryPolicyError";
    this.status = status;
  }
}

// Require a single bare mailbox; never accept display names, lists or control characters.
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 254) return null;
  const normalized = value.trim().toLowerCase();
  return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(normalized)
    && !normalized.startsWith(".") && !normalized.includes("..") && !normalized.includes(".@")
    ? normalized : null;
}

// Permit common presentation punctuation, but never infer a country code.
export function normalizePhone(value: unknown): string | null {
  if (typeof value !== "string" || !/^\+[0-9 ().-]+$/.test(value.trim())) return null;
  const normalized = value.trim().replace(/[ ().-]/g, "");
  return /^\+[1-9]\d{7,14}$/.test(normalized) ? normalized : null;
}

export function authorizeDelivery(
  env: DeliveryPolicyEnvironment,
  channel: DeliveryChannel,
  recipient: unknown,
): DeliveryPermission {
  if (!["development", "staging", "production"].includes(env.APP_ENV ?? "")) {
    throw new DeliveryPolicyError("Outbound delivery unavailable: APP_ENV is not configured correctly.");
  }
  if (!env.OUTBOUND_DELIVERY_MODE || env.OUTBOUND_DELIVERY_MODE === "disabled") {
    throw new DeliveryPolicyError("Outbound delivery is disabled.");
  }
  if (env.OUTBOUND_DELIVERY_MODE !== "test" && env.OUTBOUND_DELIVERY_MODE !== "live") {
    throw new DeliveryPolicyError("Outbound delivery unavailable: invalid delivery mode.");
  }
  if (env.OUTBOUND_DELIVERY_MODE === "live" && env.APP_ENV !== "production") {
    throw new DeliveryPolicyError("Live delivery requires the production environment.");
  }
  const normalize = channel === "EMAIL" ? normalizeEmail : normalizePhone;
  const normalized = normalize(recipient);
  if (!normalized) throw new DeliveryPolicyError("Invalid delivery recipient.", 400);
  if (env.OUTBOUND_DELIVERY_MODE === "test") {
    const raw = channel === "EMAIL" ? env.OUTBOUND_TEST_EMAILS : env.OUTBOUND_TEST_PHONES;
    const entries = raw?.split(",").map((entry) => normalize(entry));
    if (!entries?.length || entries.some((entry) => !entry)) {
      throw new DeliveryPolicyError("Test delivery requires a valid channel allowlist.");
    }
    if (!entries.includes(normalized)) {
      throw new DeliveryPolicyError("Recipient is not allowed for test delivery.", 403);
    }
  }
  return { recipient: normalized, mode: env.OUTBOUND_DELIVERY_MODE };
}

export function requireEmailConfiguration(env: {
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
  RESEND_REPLY_TO?: string;
}): { apiKey: string; from: string; replyTo: string } {
  // Requiring a reply mailbox for test sends too exercises the production routing contract.
  const replyTo = normalizeEmail(env.RESEND_REPLY_TO);
  const from = env.RESEND_FROM?.trim();
  const fromMailbox = from?.match(/^[^<>\r\n]+<([^<>]+)>$/)?.[1] ?? from;
  if (!env.RESEND_API_KEY?.trim() || !from || !normalizeEmail(fromMailbox) || !replyTo) {
    throw new DeliveryPolicyError("Email delivery requires configured sender credentials and a valid practice reply mailbox.");
  }
  return { apiKey: env.RESEND_API_KEY, from, replyTo };
}
