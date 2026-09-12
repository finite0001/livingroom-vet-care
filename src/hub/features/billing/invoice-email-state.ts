export interface InvoiceEmailArgs {
  p_request_id: string;
  p_invoice_id: string;
  p_client_id: string;
  p_conversation_id: string;
  p_recipient: string;
  p_subject: string;
  p_body: string;
  p_invoice_hash: string;
}
export interface InvoiceEmailPreparation {
  request: {
    id: string;
    invoice_id: string;
    actor_id: string;
    client_id: string;
    conversation_id: string;
    recipient: string;
    subject: string;
    body: string;
    invoice_hash: string;
    state: "preparing" | "ready" | "queued" | "abandoned";
  };
  payload_hash: string | null;
  manifest: Array<{
    filename: string;
    mime_type: string;
    file_size: number;
    sha256: string;
  }> | null;
  report_html: string | null;
  purged_at: string | null;
  receipt: {
    outbox_id: string;
    message_id: string;
    state: string;
    queued: true;
    delivered: boolean;
  } | null;
}
const hash = /^[a-f0-9]{64}$/;
export function parseInvoiceEmail(
  value: unknown,
  invoiceId: string,
  clientId: string,
  actorId: string,
): InvoiceEmailPreparation | null {
  if (value === null) return null;
  const bad = () => {
    throw new Error(
      "Saved invoice email response was incomplete. Recover the same request before continuing.",
    );
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) return bad();
  const p = value as Record<string, unknown>;
  if (!p.request || typeof p.request !== "object" || Array.isArray(p.request))
    return bad();
  const r = p.request as Record<string, unknown>;
  for (const key of [
    "id",
    "invoice_id",
    "actor_id",
    "client_id",
    "conversation_id",
    "recipient",
    "subject",
    "body",
    "invoice_hash",
    "state",
  ])
    if (typeof r[key] !== "string") return bad();
  if (
    r.invoice_id !== invoiceId ||
    r.client_id !== clientId ||
    r.actor_id !== actorId ||
    !hash.test(String(r.invoice_hash)) ||
    !["preparing", "ready", "queued", "abandoned"].includes(String(r.state))
  )
    return bad();
  if (
    p.payload_hash !== null &&
    (typeof p.payload_hash !== "string" || !hash.test(p.payload_hash))
  )
    return bad();
  if (p.report_html !== null && typeof p.report_html !== "string") return bad();
  if (p.purged_at !== null && typeof p.purged_at !== "string") return bad();
  if (p.manifest !== null) {
    if (!Array.isArray(p.manifest) || p.manifest.length !== 1) return bad();
    const item = p.manifest[0];
    if (
      !item ||
      typeof item.filename !== "string" ||
      item.mime_type !== "text/html" ||
      !Number.isSafeInteger(item.file_size) ||
      item.file_size < 1 ||
      typeof item.sha256 !== "string" ||
      !hash.test(item.sha256)
    )
      return bad();
  }
  if (p.receipt !== null) {
    if (!p.receipt || typeof p.receipt !== "object" || Array.isArray(p.receipt))
      return bad();
    const receipt = p.receipt as Record<string, unknown>;
    if (
      typeof receipt.outbox_id !== "string" ||
      typeof receipt.message_id !== "string" ||
      typeof receipt.state !== "string" ||
      receipt.queued !== true ||
      typeof receipt.delivered !== "boolean"
    )
      return bad();
  }
  if (p.payload_hash && !p.manifest) return bad();
  if (r.state === "ready" && (!p.payload_hash || !p.report_html || p.purged_at))
    return bad();
  if ((r.state === "queued") !== Boolean(p.receipt)) return bad();
  return value as InvoiceEmailPreparation;
}
export function invoiceEmailArgs(p: InvoiceEmailPreparation): InvoiceEmailArgs {
  const r = p.request;
  return {
    p_request_id: r.id,
    p_invoice_id: r.invoice_id,
    p_client_id: r.client_id,
    p_conversation_id: r.conversation_id,
    p_recipient: r.recipient,
    p_subject: r.subject,
    p_body: r.body,
    p_invoice_hash: r.invoice_hash,
  };
}
