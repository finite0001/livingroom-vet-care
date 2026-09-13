import {
  materializePaymentAccess,
  type PaymentAccessConfig,
  paymentGrantFromContext,
} from "./payment-access-capability.ts";
import {
  RELEASE_EMAIL_MAX_BYTES,
  type ReleaseEmailPayload,
  sha256Hex,
  verifyFrozenEmailPayload,
} from "./release-email-payload.ts";

export interface PaymentDeliveryRequest {
  grant_id: string;
  actor_id: string;
  invoice_id: string;
  client_id: string;
  source_hash: string;
  amount_cents: string;
  channel: "EMAIL" | "SMS";
  recipient: string;
  subject: string;
  body_template: string;
  invoice_email_request_id: string | null;
  invoice_payload_hash: string | null;
}
export interface PaymentDeliveryContext {
  request: PaymentDeliveryRequest;
  grant: unknown;
  capability: {
    grant_id: string;
    context_version: number;
    origin: string;
    key_version: string;
    capability_context: string;
    context_hash: string;
    collection_token_hash: string;
    status_token_hash: string;
  };
  invoice_payload_text: string | null;
}
function unavailable(): never {
  throw new Error("Reviewed payment delivery unavailable");
}
const digest = (value: string) => sha256Hex(new TextEncoder().encode(value));
/** Returns transient transport bytes. Persist only the two digests, never payload_text or message. */
export async function materializePaymentDelivery(
  context: PaymentDeliveryContext,
  config: PaymentAccessConfig,
  sender: Record<string, string>,
) {
  const r = context.request;
  const grant = paymentGrantFromContext({
    grant: context.grant,
    capture: context.capability,
  });
  if (
    !config.collectionEnabled || !config.statusEnabled ||
    r.grant_id !== grant.id || r.actor_id !== grant.actor_id ||
    r.invoice_id !== grant.invoice_id ||
    r.client_id !== grant.client_id || r.source_hash !== grant.source_hash ||
    r.amount_cents !== grant.amount_cents ||
    !["EMAIL", "SMS"].includes(r.channel) ||
    typeof r.body_template !== "string" ||
    r.body_template.length > 100000 ||
    r.body_template.split("{{payment_link}}").length !== 2 ||
    typeof r.subject !== "string" || r.subject.includes("{{payment_link}}") ||
    /(v1|p1|s1)\.[A-Za-z0-9_-]{43}/.test(r.body_template + r.subject)
  ) unavailable();
  const access = await materializePaymentAccess(grant, config);
  if (
    access.collection_token_hash !== context.capability.collection_token_hash ||
    access.status_token_hash !== context.capability.status_token_hash
  ) unavailable();
  const message = r.body_template.replace(
    "{{payment_link}}",
    access.collection_url,
  );
  let payload_text: string;
  if (r.channel === "SMS") {
    if (
      r.subject !== "" || message.length > 1600 ||
      r.invoice_email_request_id !== null ||
      r.invoice_payload_hash !== null ||
      context.invoice_payload_text !== null ||
      !/^\+[1-9][0-9]{7,14}$/.test(r.recipient) ||
      !/^\+[1-9][0-9]{7,14}$/.test(sender.from) ||
      !/^AC[0-9a-f]{32}$/i.test(sender.account_sid) ||
      Object.keys(sender).sort().join() !== "account_sid,from"
    ) unavailable();
    payload_text = new URLSearchParams({
      From: sender.from,
      To: r.recipient,
      Body: message,
    }).toString();
  } else {
    if (
      Object.keys(sender).sort().join() !== "from,reply_to" || !sender.from ||
      !sender.reply_to ||
      !r.recipient || !r.subject.trim() || r.subject.length > 500
    ) unavailable();
    let attachments: ReleaseEmailPayload["attachments"] | undefined;
    if (r.invoice_email_request_id !== null) {
      if (!context.invoice_payload_text || !r.invoice_payload_hash) {
        unavailable();
      }
      const original = await verifyFrozenEmailPayload({
        payload_text: context.invoice_payload_text,
        payload_hash: r.invoice_payload_hash,
      }, {
        recipient: r.recipient,
        subject: r.subject,
        body: r.body_template,
        from: sender.from,
        replyTo: sender.reply_to,
      });
      const payload = JSON.parse(original) as ReleaseEmailPayload;
      attachments = payload.attachments;
      // The invoice renderer emits exactly one HTML attachment. Reject unrelated packages.
      if (
        attachments.length !== 1 ||
        attachments[0].content_type !== "text/html" ||
        attachments[0].filename !== `invoice-${r.invoice_id}.html` ||
        typeof attachments[0].content !== "string"
      ) unavailable();
      let decoded: string;
      try {
        decoded = atob(attachments[0].content);
      } catch {
        unavailable();
      }
      if (/(v1|p1|s1)\.[A-Za-z0-9_-]{43}/.test(decoded)) unavailable();
    } else if (
      context.invoice_payload_text !== null || r.invoice_payload_hash !== null
    ) unavailable();
    payload_text = JSON.stringify({
      from: sender.from,
      reply_to: sender.reply_to,
      to: [r.recipient],
      subject: r.subject,
      text: message,
      ...(attachments ? { attachments } : {}),
    });
    if (
      new TextEncoder().encode(payload_text).length > RELEASE_EMAIL_MAX_BYTES
    ) unavailable();
  }
  return {
    message,
    payload_text,
    message_hash: await digest(message),
    payload_hash: await digest(payload_text),
  };
}
