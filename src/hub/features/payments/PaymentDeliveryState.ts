export interface DeliveryIntent {
  p_request_id: string;
  p_grant_id: string;
  p_conversation_id: string;
  p_channel: "EMAIL" | "SMS";
  p_recipient: string;
  p_subject: string;
  p_body_template: string;
  p_invoice_email_request_id: string | null;
  p_invoice_payload_hash: string | null;
}
export interface PaymentDelivery {
  request: {
    id: string;
    grant_id: string;
    actor_id: string;
    invoice_id: string;
    client_id: string;
    source_hash: string;
    amount_cents: string;
    conversation_id: string;
    channel: "EMAIL" | "SMS";
    recipient: string;
    subject: string;
    body_template: string;
    invoice_email_request_id: string | null;
    invoice_payload_hash: string | null;
    created_at: string;
  };
  capture: null | {
    message_hash: string;
    payload_hash: string;
    sender_config: Record<string, string>;
  };
  receipt: null | {
    outbox_id: string;
    message_id: string;
    state: string;
    queued: true;
    delivered: boolean;
  };
}
export interface DeliveryPreview {
  message: string;
  recipient: string;
  subject: string;
  sender: string;
  replyTo?: string;
  attachment: null | { filename: string; html: string; size: number };
  messageHash: string;
  payloadHash: string;
  requestId: string;
}
const uuid =
    /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i,
  hash = /^[a-f0-9]{64}$/,
  capability = /(?:v1|p1|s1)\.[A-Za-z0-9_-]{43}/;
function invalid(): never {
  throw new Error("Payment delivery could not be verified.");
}
function object(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function str(v: unknown, re: RegExp) {
  if (typeof v !== "string" || !re.test(v)) return invalid();
  return v;
}
function text(v: unknown, max: number) {
  if (typeof v !== "string" || v.length > max || capability.test(v))
    return invalid();
  return v;
}
export function deliveryIntent(v: unknown): DeliveryIntent {
  if (
    !object(v) ||
    Object.keys(v).sort().join(",") !==
      [
        "p_request_id",
        "p_grant_id",
        "p_conversation_id",
        "p_channel",
        "p_recipient",
        "p_subject",
        "p_body_template",
        "p_invoice_email_request_id",
        "p_invoice_payload_hash",
      ]
        .sort()
        .join(",")
  )
    return invalid();
  const channel = str(v.p_channel, /^(EMAIL|SMS)$/) as "EMAIL" | "SMS";
  const subject = text(v.p_subject, 500),
    body = text(v.p_body_template, channel === "SMS" ? 1600 : 100000);
  if (
    body.split("{{payment_link}}").length !== 2 ||
    subject.includes("{{payment_link}}") ||
    (channel === "SMS" ? subject !== "" : !subject.trim())
  )
    return invalid();
  const recipient = str(
    v.p_recipient,
    channel === "SMS"
      ? /^\+[1-9][0-9]{7,14}$/
      : /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/,
  );
  if (
    (v.p_invoice_email_request_id === null) !==
      (v.p_invoice_payload_hash === null) ||
    (channel === "SMS" && v.p_invoice_email_request_id !== null)
  )
    return invalid();
  return {
    p_request_id: str(v.p_request_id, uuid),
    p_grant_id: str(v.p_grant_id, uuid),
    p_conversation_id: str(v.p_conversation_id, uuid),
    p_channel: channel,
    p_recipient: recipient,
    p_subject: subject,
    p_body_template: body,
    p_invoice_email_request_id:
      v.p_invoice_email_request_id === null
        ? null
        : str(v.p_invoice_email_request_id, uuid),
    p_invoice_payload_hash:
      v.p_invoice_payload_hash === null
        ? null
        : str(v.p_invoice_payload_hash, hash),
  };
}
export function deliveryArgs(delivery: PaymentDelivery): DeliveryIntent {
  const r = delivery.request;
  return {
    p_request_id: r.id,
    p_grant_id: r.grant_id,
    p_conversation_id: r.conversation_id,
    p_channel: r.channel,
    p_recipient: r.recipient,
    p_subject: r.subject,
    p_body_template: r.body_template,
    p_invoice_email_request_id: r.invoice_email_request_id,
    p_invoice_payload_hash: r.invoice_payload_hash,
  };
}
export function sameDeliveryIntent(
  delivery: PaymentDelivery,
  intent: DeliveryIntent,
) {
  return (
    JSON.stringify(deliveryArgs(delivery)) ===
    JSON.stringify(deliveryIntent(intent))
  );
}
export function parsePaymentDelivery(
  v: unknown,
  actor: string,
  invoice: string,
  client: string,
  id?: string,
): PaymentDelivery | null {
  if (v === null) return null;
  if (!object(v) || !object(v.request)) return invalid();
  const r = v.request;
  const args = deliveryIntent({
    p_request_id: r.id,
    p_grant_id: r.grant_id,
    p_conversation_id: r.conversation_id,
    p_channel: r.channel,
    p_recipient: r.recipient,
    p_subject: r.subject,
    p_body_template: r.body_template,
    p_invoice_email_request_id: r.invoice_email_request_id,
    p_invoice_payload_hash: r.invoice_payload_hash,
  });
  if (
    r.actor_id !== actor ||
    r.invoice_id !== invoice ||
    r.client_id !== client ||
    (id && r.id !== id) ||
    typeof r.created_at !== "string" ||
    !Number.isFinite(Date.parse(r.created_at))
  )
    return invalid();
  const result: PaymentDelivery = {
    request: {
      id: args.p_request_id,
      grant_id: args.p_grant_id,
      actor_id: actor,
      invoice_id: invoice,
      client_id: client,
      source_hash: str(r.source_hash, hash),
      amount_cents: str(r.amount_cents, /^[1-9][0-9]{0,7}$/),
      conversation_id: args.p_conversation_id,
      channel: args.p_channel,
      recipient: args.p_recipient,
      subject: args.p_subject,
      body_template: args.p_body_template,
      invoice_email_request_id: args.p_invoice_email_request_id,
      invoice_payload_hash: args.p_invoice_payload_hash,
      created_at: r.created_at,
    },
    capture: null,
    receipt: null,
  };
  if (v.capture !== null) {
    const c = v.capture;
    if (!object(c) || c.request_id !== r.id || !object(c.sender_config))
      return invalid();
    const sender: Record<string, string> = {};
    const keys =
      args.p_channel === "EMAIL"
        ? ["from", "reply_to"]
        : ["from", "account_sid"];
    if (Object.keys(c.sender_config).sort().join(",") !== keys.sort().join(","))
      return invalid();
    for (const key of keys) sender[key] = text(c.sender_config[key], 500);
    result.capture = {
      message_hash: str(c.message_hash, hash),
      payload_hash: str(c.payload_hash, hash),
      sender_config: sender,
    };
  }
  if (v.receipt !== null) {
    const receipt = v.receipt;
    if (
      !object(receipt) ||
      receipt.queued !== true ||
      typeof receipt.delivered !== "boolean"
    )
      return invalid();
    const state = str(
      receipt.state,
      /^(pending|claimed|accepted|delivered|failed|uncertain)$/,
    );
    if (receipt.delivered !== (state === "delivered")) return invalid();
    result.receipt = {
      outbox_id: str(receipt.outbox_id, uuid),
      message_id: str(receipt.message_id, uuid),
      state,
      queued: true,
      delivered: receipt.delivered,
    };
  }
  return result;
}
async function digest(value: string) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  ]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
export async function verifyDeliveryPreview(
  value: unknown,
  delivery: PaymentDelivery,
): Promise<DeliveryPreview> {
  if (
    !object(value) ||
    !delivery.capture ||
    delivery.receipt ||
    typeof value.message !== "string" ||
    value.message.length > 100500 ||
    value.recipient !== delivery.request.recipient ||
    value.subject !== delivery.request.subject ||
    !object(value.sender)
  )
    return invalid();
  const r = delivery.request,
    c = delivery.capture,
    s = c.sender_config;
  if (
    Object.keys(value.sender).sort().join(",") !==
      Object.keys(s).sort().join(",") ||
    Object.entries(s).some(([key, v]) => value.sender[key] !== v)
  )
    return invalid();
  const matches = value.message.match(
    /https:\/\/[^\s<>"']+\/pay\/[a-f0-9-]{36}#p1\.[A-Za-z0-9_-]{43}/g,
  );
  if (matches?.length !== 1) return invalid();
  const url = new URL(matches[0]);
  if (
    url.pathname !== `/pay/${r.grant_id}` ||
    url.search ||
    url.username ||
    url.password ||
    r.body_template.replace("{{payment_link}}", url.href) !== value.message
  )
    return invalid();
  let attachment: DeliveryPreview["attachment"] = null;
  if (r.invoice_email_request_id) {
    const a = value.attachment;
    if (
      !object(a) ||
      Object.keys(a).sort().join(",") !== "content,content_type,filename" ||
      a.filename !== `invoice-${r.invoice_id}.html` ||
      a.content_type !== "text/html" ||
      typeof a.content !== "string" ||
      a.content.length > 400000
    )
      return invalid();
    const bytes = Uint8Array.from(atob(a.content), (x) => x.charCodeAt(0));
    const html = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (capability.test(html)) return invalid();
    attachment = { filename: a.filename, html, size: bytes.length };
  } else if (value.attachment !== null) return invalid();
  const payload =
    r.channel === "SMS"
      ? new URLSearchParams({
          From: s.from,
          To: r.recipient,
          Body: value.message,
        }).toString()
      : JSON.stringify({
          from: s.from,
          reply_to: s.reply_to,
          to: [r.recipient],
          subject: r.subject,
          text: value.message,
          ...(attachment ? { attachments: [value.attachment] } : {}),
        });
  const messageHash = await digest(value.message),
    payloadHash = await digest(payload);
  if (messageHash !== c.message_hash || payloadHash !== c.payload_hash)
    return invalid();
  return {
    requestId: r.id,
    message: value.message,
    recipient: r.recipient,
    subject: r.subject,
    sender: s.from,
    ...(s.reply_to ? { replyTo: s.reply_to } : {}),
    attachment,
    messageHash,
    payloadHash,
  };
}
