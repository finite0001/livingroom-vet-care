import { boundedBody } from "./verification.ts";
import { verifyConversationAttachmentBytes } from "../verify-conversation-attachment.ts";
import type { InboundAttachmentMetadata } from "./attachment-metadata.ts";
export interface CapturedInboundAttachment {
  bytes: Uint8Array;
  mimeType: string;
  filename: string | null;
  sha256: string;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const maximum = 10 * 1024 * 1024;
const unavailable = () => new Error("Incoming attachment is unavailable for verified capture.");
async function boundedBytes(response: Response, size: number): Promise<Uint8Array> {
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) !== size)) {
    await response.body?.cancel(); throw unavailable();
  }
  if (!response.body) throw unavailable();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > size || total > maximum) { await reader.cancel(); throw unavailable(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (total !== size) throw unavailable();
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
/** Input must come from an authorized saved inbound record, never browser-supplied URLs. */
export async function retrieveResendAttachment(
  emailId: string,
  expected: InboundAttachmentMetadata,
  apiKey: string,
  transport: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<CapturedInboundAttachment> {
  if (!apiKey || !uuid.test(emailId) || !uuid.test(expected.id) ||
    !Number.isSafeInteger(expected.size) || expected.size < 1 || expected.size > maximum ||
    !["application/pdf", "image/png", "image/jpeg"].includes(expected.content_type)) throw unavailable();
  const endpoint = `https://api.resend.com/emails/receiving/${emailId}/attachments/${expected.id}`;
  const metadataResponse = await transport(endpoint, { headers: { Authorization: `Bearer ${apiKey}` },
    redirect: "error", signal: AbortSignal.timeout(30000) });
  if (!metadataResponse.ok) throw unavailable();
  const metadata: unknown = JSON.parse(await boundedBody(metadataResponse, 65536));
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw unavailable();
  const value = metadata as Record<string, unknown>;
  if (value.object !== "attachment" || value.id !== expected.id || value.filename !== expected.filename ||
    value.size !== expected.size || value.content_type !== expected.content_type || typeof value.download_url !== "string" ||
    value.download_url.length > 8192 || typeof value.expires_at !== "string" ||
    !Number.isFinite(Date.parse(value.expires_at)) || Date.parse(value.expires_at) <= now()) throw unavailable();
  const url = new URL(value.download_url);
  if (url.protocol !== "https:" || url.hostname !== "inbound-cdn.resend.com" || url.port || url.username || url.password || url.hash ||
    url.pathname !== `/${emailId}/attachments/${expected.id}`) throw unavailable();
  // Signed CDN URLs are ephemeral capabilities. Never forward the provider API key.
  const response = await transport(url.href, { redirect: "error", signal: AbortSignal.timeout(30000), credentials: "omit" });
  if (!response.ok) throw unavailable();
  const mime = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (mime && mime !== expected.content_type && mime !== "application/octet-stream") {
    await response.body?.cancel(); throw unavailable();
  }
  const bytes = await boundedBytes(response, expected.size);
  const sha256 = await verifyConversationAttachmentBytes(new Blob([bytes as BlobPart], { type: expected.content_type }), {
    mime_type: expected.content_type, byte_length: expected.size,
  });
  return { bytes, mimeType: expected.content_type, filename: expected.filename, sha256 };
}
