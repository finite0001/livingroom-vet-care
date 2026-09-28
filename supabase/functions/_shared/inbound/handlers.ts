import { redactDocumentCapabilities } from "./document-capability-redaction.ts";
import { normalizeEmail, normalizePhone } from "../delivery-policy.ts";
import {
  boundedBody,
  digestMetadata,
  verifiedSvix,
  verifiedTwilio,
  WebhookError,
  type ResendVerifier,
  type TwilioVerifier,
} from "./verification.ts";
export interface EventDatabase {
  rpc(
    name: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}
export interface WebhookEnvironment {
  /** Legacy Resend receiving addresses; only read by the retained historical intake. */
  RESEND_INBOUND_ADDRESSES?: string;
  /** App receiving mailbox (AgentMail). Must never equal the Auth sender. */
  AGENTMAIL_INBOX_ADDRESS?: string;
  RESEND_FROM?: string;
  RESEND_AUTH_FROM_ADDRESS?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_FROM_NUMBER?: string;
  TWILIO_WEBHOOK_URL?: string;
}
export interface ProviderEvent {
  id: string;
  provider: "resend" | "twilio" | "agentmail";
  event_type: string;
  resource_id: string;
  lease_token: string;
  metadata: Record<string, unknown>;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sid = /^SM[0-9a-f]{32}$/i;
export function emailAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return normalizeEmail(value.match(/^[^<>\r\n]*<([^<>]+)>$/)?.[1] ?? value);
}
export async function persistProviderEvent(
  db: EventDatabase,
  provider: string,
  eventId: string,
  resourceId: string,
  type: string,
  metadata: Record<string, unknown>,
  originalMetadata: Record<string, unknown> = metadata,
) {
  const { data, error } = await db.rpc("receive_communication_event", {
    p_provider: provider,
    p_event_id: eventId,
    p_resource_id: resourceId,
    p_event_type: type,
    p_payload_hash: await digestMetadata(originalMetadata),
    p_metadata: metadata,
  });
  if (error)
    throw new WebhookError(
      503,
      "Provider event could not be durably recorded; retry required",
      error && typeof error === "object" && "code" in error &&
        typeof error.code === "string"
        ? error.code
        : undefined,
    );
  return data;
}
const persist = persistProviderEvent;
const resendStatusTypes: Record<string, string> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.failed": "failed",
};
type ParsedResend =
  | { purpose: "authentication"; status: string }
  | {
    purpose: "client";
    id: string;
    type: string;
    event: Record<string, unknown>;
    data: Record<string, unknown>;
    authSender: string | null;
  };
async function parseResend(
  req: Request,
  env: WebhookEnvironment,
  verify: ResendVerifier,
): Promise<ParsedResend> {
  if (req.method !== "POST") throw new WebhookError(405, "Method not allowed");
  const raw = await boundedBody(req);
  const { id, event } = verifiedSvix(raw, req.headers, verify);
  const data = event.data as Record<string, unknown> | undefined;
  if (!data || typeof data.email_id !== "string" || !uuid.test(data.email_id))
    throw new WebhookError(400, "Invalid email resource");
  const type = event.type === "email.received"
    ? "inbound"
    : resendStatusTypes[String(event.type)];
  if (!type) throw new WebhookError(400, "Unsupported webhook event");
  // Only signed outbound events from a reserved Auth sender may bypass the
  // client ledger. Missing/unknown client receipts must continue to retry.
  const authSetting = env.RESEND_AUTH_FROM_ADDRESS;
  let authSender: string | null = null;
  if (authSetting !== undefined) {
    authSender = normalizeEmail(authSetting);
    const clientSender = emailAddress(env.RESEND_FROM);
    const inbound = [
      ...(env.RESEND_INBOUND_ADDRESSES?.split(",") ?? []),
      ...(env.AGENTMAIL_INBOX_ADDRESS === undefined ? [] : [env.AGENTMAIL_INBOX_ADDRESS]),
    ].map(normalizeEmail);
    if (!authSender || !clientSender || authSender === clientSender ||
        inbound.some((address) => !address || address === authSender)) {
      throw new WebhookError(503, "Authentication sender separation unavailable");
    }
  }
  if (type !== "inbound" && authSender && emailAddress(data.from) === authSender) {
    // Auth delivery history remains in the provider's private dashboard.
    // Never persist recipients, subjects, bodies or recovery links to the hub.
    return { purpose: "authentication", status: type };
  }
  return { purpose: "client", id, type, event, data, authSender };
}
/**
 * Historical Resend receiving intake. No deployed endpoint reaches it since the
 * 2026-09-27 AgentMail decision (resend-webhook is an inert 410 stub); it is
 * kept for the retained local acceptance runners and existing durable rows.
 */
export async function receiveResend(
  req: Request,
  db: EventDatabase,
  env: WebhookEnvironment,
  verify: ResendVerifier,
) {
  const parsed = await parseResend(req, env, verify);
  if (parsed.purpose === "authentication") return parsed;
  const { id, type, event, data, authSender } = parsed;
  if (type === "inbound") {
    if (authSender && emailAddress(data.from) === authSender)
      throw new WebhookError(400, "Authentication mail is not a client reply");
    const allowed =
      env.RESEND_INBOUND_ADDRESSES?.split(",").map(normalizeEmail);
    const recipients = Array.isArray(data.to) ? data.to.map(emailAddress) : [];
    if (!allowed?.length || allowed.some((address) => !address))
      throw new WebhookError(503, "Receiving addresses unavailable");
    const owned = recipients.filter(
      (address) => address && allowed.includes(address),
    );
    if (owned.length !== 1)
      throw new WebhookError(400, "Receiving address is unknown or ambiguous");
    const sender = emailAddress(data.from);
    if (!sender) throw new WebhookError(400, "Invalid sender mailbox");
    return persist(db, "resend", id, data.email_id as string, type, {
      from: sender,
      to: owned[0],
      created_at: event.created_at,
    });
  }
  return persist(db, "resend", id, data.email_id as string, type, {
    created_at: event.created_at,
    type,
  });
}
/** Legacy outbound_deliveries receipt (retired reminder path), keyed by provider id. */
export interface LegacyDeliveryCallback {
  (input: {
    providerMessageId: string;
    status: "DELIVERED" | "FAILED";
    note: string;
    errorText: string | null;
  }): PromiseLike<boolean>;
}
/**
 * Resend delivery/status webhook (resend-delivery-webhook). Resend is outbound
 * only: email.received is refused, because client replies arrive via AgentMail.
 * Receipts for the canonical communication_outbox persist durably first; a
 * receipt the outbox does not know (SQLSTATE 23503) may settle a legacy
 * outbound_deliveries row instead, otherwise it fails for provider retry.
 */
export async function receiveResendDelivery(
  req: Request,
  db: EventDatabase,
  env: WebhookEnvironment,
  verify: ResendVerifier,
  legacy?: LegacyDeliveryCallback,
) {
  const parsed = await parseResend(req, env, verify);
  if (parsed.purpose === "authentication") return parsed;
  const { id, type, event, data } = parsed;
  if (type === "inbound")
    throw new WebhookError(410, "Resend receiving is retired; replies arrive through AgentMail");
  try {
    return await persist(db, "resend", id, data.email_id as string, type, {
      created_at: event.created_at,
      type,
    });
  } catch (error) {
    if (
      !legacy || !(error instanceof WebhookError) || error.code !== "23503" ||
      !["delivered", "bounced", "complained", "failed"].includes(type)
    ) throw error;
    const bounce = data.bounce as Record<string, unknown> | undefined;
    const message = typeof bounce?.message === "string" && bounce.message.trim() &&
        bounce.message.length <= 300
      ? bounce.message.trim()
      : null;
    let settled = false;
    try {
      settled = await legacy({
        providerMessageId: data.email_id as string,
        status: type === "delivered" ? "DELIVERED" : "FAILED",
        note: `Resend webhook reported email.${type}.`,
        errorText: type === "delivered" ? null : message ?? `Resend email.${type}`,
      });
    } catch {
      settled = false;
    }
    if (!settled) throw error;
    return { recorded: true, legacy: true, status: type };
  }
}
export async function receiveTwilio(
  req: Request,
  db: EventDatabase,
  env: WebhookEnvironment,
  verify: TwilioVerifier,
) {
  if (req.method !== "POST") throw new WebhookError(405, "Method not allowed");
  const raw = await boundedBody(req);
  const values = verifiedTwilio(req, raw, env.TWILIO_WEBHOOK_URL ?? "", verify);
  if (
    !env.TWILIO_ACCOUNT_SID ||
    values.AccountSid !== env.TWILIO_ACCOUNT_SID ||
    !sid.test(values.MessageSid ?? "")
  )
    throw new WebhookError(400, "Unknown message account or resource");
  const status = values.MessageStatus ?? values.SmsStatus;
  const isInbound = status === "received" || values.OptOutType !== undefined;
  if (isInbound) {
    const sender = normalizePhone(values.From);
    const recipient = normalizePhone(values.To);
    if (
      !sender ||
      !recipient ||
      recipient !== normalizePhone(env.TWILIO_FROM_NUMBER) ||
      typeof values.Body !== "string" ||
      values.Body.length > 1600
    )
      throw new WebhookError(400, "Invalid inbound SMS");
    const keyword = values.Body.trim().toUpperCase();
    const action =
      values.OptOutType === "STOP" ||
      [
        "STOP",
        "STOPALL",
        "UNSUBSCRIBE",
        "CANCEL",
        "END",
        "QUIT",
        "REVOKE",
        "OPTOUT",
      ].includes(keyword)
        ? "STOP"
        : values.OptOutType === "START" || ["START", "UNSTOP"].includes(keyword)
          ? "START"
          : null;
    return persist(
      db,
      "twilio",
      `${values.MessageSid}/inbound`,
      values.MessageSid,
      "inbound",
      {
        from: sender,
        to: recipient,
        body: redactDocumentCapabilities(values.Body),
        body_hash: await digestMetadata({ body: values.Body }),
        opt_action: action,
      },
      { from: sender, to: recipient, body: values.Body, opt_action: action },
    );
  }
  if (
    ![
      "queued",
      "sending",
      "sent",
      "delivered",
      "failed",
      "undelivered",
    ].includes(status ?? "")
  )
    throw new WebhookError(400, "Unsupported SMS status");
  return persist(
    db,
    "twilio",
    `${values.MessageSid}/${status}`,
    values.MessageSid,
    status,
    { status, error_code: values.ErrorCode ?? null },
  );
}
