import {
  renderInvoiceDocument,
  invoiceDocumentSchema,
  type InvoiceDocument,
  type InvoicePractice,
} from "./invoice-document.ts";
import {
  base64Bytes,
  sha256Hex,
  RELEASE_EMAIL_MAX_BYTES,
} from "./release-email-payload.ts";
import { normalizeEmail } from "./delivery-policy.ts";
export interface InvoiceEmailIntent {
  id: string;
  invoice_id: string;
  client_id: string;
  actor_id: string;
  recipient: string;
  subject: string;
  body: string;
  invoice_hash: string;
  invoice_snapshot: InvoiceDocument;
}
export interface InvoiceEmailBundle {
  document: InvoiceDocument;
  source_hash: string;
  client_id: string;
  recipient: string;
}
export async function buildInvoiceEmailPayload(
  intent: InvoiceEmailIntent,
  bundle: InvoiceEmailBundle,
  sender: { from: string; replyTo: string },
  practice: InvoicePractice,
): Promise<{ payload_text: string; payload_hash: string }> {
  const document = invoiceDocumentSchema.parse(bundle.document);
  if (
    document.status !== "issued" ||
    document.id !== intent.invoice_id ||
    document.client.id !== intent.client_id ||
    bundle.client_id !== intent.client_id ||
    bundle.recipient !== intent.recipient ||
    bundle.source_hash !== intent.invoice_hash ||
    JSON.stringify(bundle.document) !== JSON.stringify(intent.invoice_snapshot)
  )
    throw new Error("Invoice no longer matches the reviewed email intent.");
  const from = sender.from.trim();
  const replyTo = normalizeEmail(sender.replyTo);
  const mailbox = from.match(/^[^<>\r\n]+<([^<>]+)>$/)?.[1] ?? from;
  if (
    !normalizeEmail(mailbox) ||
    /[\r\n]/.test(from) ||
    !replyTo ||
    normalizeEmail(intent.recipient) !== intent.recipient ||
    !intent.subject.trim() ||
    !intent.body.trim()
  )
    throw new Error("Invoice email sender or recipient is unavailable.");
  const html = renderInvoiceDocument(document, practice);
  const payload_text = JSON.stringify({
    from,
    reply_to: replyTo,
    to: [intent.recipient],
    subject: intent.subject,
    text: intent.body,
    attachments: [
      {
        filename: `invoice-${document.id}.html`,
        content_type: "text/html",
        content: base64Bytes(new TextEncoder().encode(html)),
      },
    ],
  });
  const bytes = new TextEncoder().encode(payload_text);
  if (bytes.byteLength > RELEASE_EMAIL_MAX_BYTES)
    throw new Error("Complete encoded invoice email exceeds 32 MiB.");
  return { payload_text, payload_hash: await sha256Hex(bytes) };
}
