import { redactDocumentCapabilities, redactDocumentMetadata } from "./document-capability-redaction.ts";
import {
  emailAddress,
  type EventDatabase,
  type ProviderEvent,
} from "./handlers.ts";
import { normalizePhone } from "../delivery-policy.ts";
import { boundedBody, digestMetadata, WebhookError } from "./verification.ts";
export interface ReceivingEnvironment {
  RESEND_API_KEY?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_ACCOUNT_SID?: string;
}
class ReviewError extends Error {}
async function call(
  db: EventDatabase,
  name: string,
  args?: Record<string, unknown>,
) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw error;
  return data;
}
export async function processOneInbound(
  db: EventDatabase,
  env: ReceivingEnvironment,
  transport: typeof fetch = fetch,
) {
  const event = (await call(
    db,
    "claim_communication_event",
  )) as ProviderEvent | null;
  if (!event?.id) return { processed: false };
  try {
    if (event.event_type !== "inbound") {
      await call(db, "complete_communication_status", {
        p_event_id: event.id,
        p_lease_token: event.lease_token,
      });
      return { processed: true };
    }
    let endpoint: string;
    let authorization: string;
    if (event.provider === "resend") {
      if (!env.RESEND_API_KEY) throw new Error("Receiving credentials missing");
      if (!/^[0-9a-f-]{36}$/i.test(event.resource_id))
        throw new ReviewError("Invalid resource");
      endpoint = `https://api.resend.com/emails/receiving/${event.resource_id}`;
      authorization = `Bearer ${env.RESEND_API_KEY}`;
    } else {
      if (
        !/^AC[0-9a-f]{32}$/i.test(env.TWILIO_ACCOUNT_SID ?? "") ||
        !env.TWILIO_AUTH_TOKEN
      )
        throw new Error("Receiving credentials missing");
      if (!/^SM[0-9a-f]{32}$/i.test(event.resource_id))
        throw new ReviewError("Invalid resource");
      endpoint = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages/${event.resource_id}.json`;
      authorization = `Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}`;
    }
    const response = await transport(endpoint, {
      headers: { Authorization: authorization },
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error("Receiving API unavailable");
    const data = JSON.parse(await boundedBody(response, 1000000));
    let sender: string | null;
    let recipient: string | null;
    let body: string;
    let html: string | null = null;
    let subject = "";
    let occurred: string;
    let rfc: string | null = null;
    let replies: string[] = [];
    let attachments: unknown[] = [];
    if (event.provider === "resend") {
      sender = emailAddress(data.from);
      const recipients = Array.isArray(data.to)
        ? data.to.map(emailAddress)
        : [];
      recipient = recipients.includes(event.metadata.to)
        ? String(event.metadata.to)
        : null;
      if (
        data.id !== event.resource_id ||
        sender !== event.metadata.from ||
        !recipient
      )
        throw new ReviewError(
          "Provider resource does not match signed metadata",
        );
      body =
        typeof data.text === "string" && data.text.trim()
          ? data.text
          : "[Email has no plain-text body. HTML original retained for safe review.]";
      html = typeof data.html === "string" ? data.html : null;
      subject = typeof data.subject === "string" ? data.subject : "";
      occurred = data.created_at;
      rfc = typeof data.message_id === "string" ? data.message_id : null;
      const headers =
        data.headers && typeof data.headers === "object" ? data.headers : {};
      const header = (name: string) =>
        Object.entries(headers).find(
          ([key]) => key.toLowerCase() === name,
        )?.[1];
      replies = (
        `${header("in-reply-to") ?? ""} ${header("references") ?? ""}`.match(
          /<[^<>\r\n]{1,998}>/g,
        ) ?? []
      ).slice(-50);
      attachments = Array.isArray(data.attachments)
        ? data.attachments.map((item: Record<string, unknown>) => ({
            id: item.id,
            filename: item.filename,
            content_type: item.content_type,
            size: item.size,
          }))
        : [];
    } else {
      sender = normalizePhone(data.from);
      recipient = normalizePhone(data.to);
      if (
        data.sid !== event.resource_id ||
        data.account_sid !== env.TWILIO_ACCOUNT_SID ||
        data.direction !== "inbound" ||
        sender !== event.metadata.from ||
        recipient !== event.metadata.to ||
        typeof data.body !== "string" ||
        (typeof event.metadata.body_hash === "string"
          ? await digestMetadata({ body: data.body }) !== event.metadata.body_hash ||
            redactDocumentCapabilities(data.body) !== event.metadata.body
          : data.body !== event.metadata.body)
      )
        throw new ReviewError("Provider SMS does not match signed metadata");
      body = data.body;
      occurred = data.date_created;
      if (Number(data.num_media) > 0)
        attachments = [
          { count: Number(data.num_media), review_required: true },
        ];
    }
    if (
      !sender ||
      !recipient ||
      !Number.isFinite(Date.parse(occurred)) ||
      body.length > 100000 ||
      (html?.length ?? 0) > 500000 ||
      subject.length > 500 ||
      attachments.length > 100
    )
      throw new ReviewError("Inbound content requires manual review");
    await call(db, "complete_inbound_communication", {
      p_event_id: event.id,
      p_lease_token: event.lease_token,
      p_sender: sender,
      p_recipient: recipient,
      p_subject: redactDocumentCapabilities(subject),
      p_body: redactDocumentCapabilities(body),
      p_html: html === null ? null : redactDocumentCapabilities(html),
      p_rfc_message_id: rfc === null ? null : redactDocumentCapabilities(rfc),
      p_reply_ids: replies.map(redactDocumentCapabilities),
      p_attachments: redactDocumentMetadata(attachments),
      p_occurred_at: new Date(occurred).toISOString(),
      p_opt_action: event.metadata.opt_action ?? null,
    });
    return { processed: true };
  } catch (error) {
    const review =
      error instanceof ReviewError ||
      (error instanceof WebhookError && error.status === 413);
    const released: unknown = await call(db, "release_communication_event_outcome", {
      p_id: event.id,
      p_lease_token: event.lease_token,
      p_error: review
        ? "provider_content_requires_review"
        : "provider_fetch_or_persistence_retry",
      p_review: review,
    });
    // SQL may exhaust the retry budget even for a transient failure. Never
    // report pending work from our requested disposition or a lost RPC reply.
    if (
      !released || typeof released !== "object" || Array.isArray(released) ||
      !("id" in released) || released.id !== event.id ||
      !("state" in released) ||
      (released.state !== "pending" && released.state !== "review")
    ) throw new Error("Provider event disposition is unconfirmed");
    return {
      processed: false,
      retry_pending: released.state === "pending",
      review_required: released.state === "review",
    };
  }
}
