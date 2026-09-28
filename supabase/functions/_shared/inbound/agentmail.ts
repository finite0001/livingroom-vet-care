// AgentMail inbound adapter. AgentMail is the app's RECEIVING provider for
// client email (owner decision 2026-09-27); Resend remains outbound only.
//
// Verified against AgentMail documentation (retrieved 2026-09-27):
// - Webhooks are delivered by Svix with svix-id / svix-timestamp /
//   svix-signature headers; secrets start with whsec_.
//   https://docs.agentmail.to/webhook-verification
// - Payload: {type:"event", event_type, event_id, message:{inbox_id, thread_id,
//   message_id, from, to, subject, text, html, created_at, ...}, thread:{...}}.
//   message.received.spam/.blocked/.unauthenticated are delivered only when
//   explicitly subscribed. https://docs.agentmail.to/events
// - GET https://api.agentmail.to/v0/inboxes/{inbox_id}/messages/{message_id}
//   (Bearer auth) returns attachments[{attachment_id,size,filename?,
//   content_type?,content_disposition?,content_id?}], in_reply_to, references.
//   https://docs.agentmail.to/api-reference/inboxes/messages/get
// - GET .../messages/{message_id}/attachments/{attachment_id} returns
//   {attachment_id,size,download_url,expires_at,...} per the API reference; the
//   Attachments guide instead describes the response as the raw file. Both
//   shapes are handled below and treated as unverified until the live
//   round trip. https://docs.agentmail.to/api-reference/inboxes/messages/get-attachment
// - 429 responses carry Retry-After; the durable worker already backs off.
//   https://docs.agentmail.to/knowledge-base/rate-limits
//
// Everything provider-specific stays in this file so an unverified detail can be
// corrected in one place. Nothing here logs payloads, addresses or secrets.
import { normalizeEmail } from "../delivery-policy.ts";
import { verifyConversationAttachmentBytes } from "../verify-conversation-attachment.ts";
import type { InboundAttachmentMetadata } from "./attachment-metadata.ts";
import { inboundEmailBody } from "./attachment-metadata.ts";
import type { CapturedInboundAttachment } from "./resend-attachment.ts";
import {
  emailAddress,
  type EventDatabase,
  persistProviderEvent,
  type ProviderEvent,
} from "./handlers.ts";
import {
  boundedBody,
  type ResendVerifier,
  verifiedSvix,
  WebhookError,
} from "./verification.ts";

export const AGENTMAIL_API_ORIGIN = "https://api.agentmail.to";
// message.received carries text and HTML inline, so allow more than the 64 KiB
// status-callback cap. Larger deliveries fail closed (413) and stay in AgentMail.
export const AGENTMAIL_WEBHOOK_LIMIT = 4 * 1024 * 1024;
const ATTACHMENT_MAXIMUM = 10 * 1024 * 1024;
const SUPPORTED_ATTACHMENT_TYPES = ["application/pdf", "image/png", "image/jpeg"];
// Documented non-receipt events: acknowledged without persistence so a broad
// subscription does not create a retry storm. Filtered receipt variants are
// intentionally NOT ingested (spam/blocked/unauthenticated senders could forge
// a household address); they stay in the AgentMail console for manual review.
const IGNORED_EVENT_TYPES = new Set([
  "message.sent",
  "message.delivered",
  "message.bounced",
  "message.complained",
  "message.rejected",
  "message.opened",
  "domain.verified",
  "message.received.spam",
  "message.received.blocked",
  "message.received.unauthenticated",
]);

export interface AgentMailEnvironment {
  AGENTMAIL_INBOX_ID?: string;
  AGENTMAIL_INBOX_ADDRESS?: string;
}
export class AgentMailContentError extends Error {}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
function boundedText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.trim().length > 0 &&
    value.length <= maximum && !Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    });
}
const inboxIdPattern = /^[^\s/?#\\]{1,320}$/;
function providerMessageId(value: unknown): string | null {
  return boundedText(value, 998) && value.length >= 3 && !/\s/.test(value)
    ? value
    : null;
}
export function configuredInbox(env: AgentMailEnvironment) {
  const inboxId = env.AGENTMAIL_INBOX_ID?.trim() ?? "";
  const address = normalizeEmail(env.AGENTMAIL_INBOX_ADDRESS);
  return inboxIdPattern.test(inboxId) && address ? { inboxId, address } : null;
}

// Deterministic RFC 9562 version-8 UUID from SHA-256, so provider identifiers of
// any shape map onto the existing uuid-typed idempotency and capture columns.
export async function deterministicUuid(scope: string, ...parts: string[]) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify([scope, ...parts])),
    ),
  ).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export const agentMailResourceId = (inboxId: string, messageId: string) =>
  deterministicUuid("agentmail-message", inboxId, messageId);
export const agentMailAttachmentId = (messageId: string, attachmentId: string) =>
  deterministicUuid("agentmail-attachment", messageId, attachmentId);

export function agentMailMessageUrl(inboxId: string, messageId: string) {
  return `${AGENTMAIL_API_ORIGIN}/v0/inboxes/${encodeURIComponent(inboxId)}/messages/${encodeURIComponent(messageId)}`;
}

/** Signed webhook -> durable receipt. Message content is fetched later by process-inbound. */
export async function receiveAgentMail(
  req: Request,
  db: EventDatabase,
  env: AgentMailEnvironment,
  verify: ResendVerifier,
) {
  if (req.method !== "POST") throw new WebhookError(405, "Method not allowed");
  const inbox = configuredInbox(env);
  if (!inbox) throw new WebhookError(503, "Receiving inbox unavailable");
  const raw = await boundedBody(req, AGENTMAIL_WEBHOOK_LIMIT);
  const { id, event } = verifiedSvix(raw, req.headers, verify);
  const type = event.event_type;
  if (typeof type !== "string") throw new WebhookError(400, "Unsupported webhook event");
  if (IGNORED_EVENT_TYPES.has(type)) return { ignored: true, event_type: type };
  if (type !== "message.received") throw new WebhookError(400, "Unsupported webhook event");
  const message = event.message;
  if (!record(message)) throw new WebhookError(400, "Invalid message resource");
  if (message.inbox_id !== inbox.inboxId) {
    throw new WebhookError(400, "Receiving inbox is unknown");
  }
  const messageId = providerMessageId(message.message_id);
  const sender = emailAddress(message.from);
  const createdAt = typeof message.created_at === "string" ? message.created_at : null;
  if (!messageId || !sender || !createdAt || !Number.isFinite(Date.parse(createdAt))) {
    throw new WebhookError(400, "Invalid message resource");
  }
  return persistProviderEvent(
    db,
    "agentmail",
    id,
    await agentMailResourceId(inbox.inboxId, messageId),
    "inbound",
    {
      from: sender,
      to: inbox.address,
      inbox_id: inbox.inboxId,
      message_id: messageId,
      thread_id: boundedText(message.thread_id, 200) ? message.thread_id : null,
      event_id: boundedText(event.event_id, 200) ? event.event_id : null,
      created_at: createdAt,
    },
  );
}

/** Validates the durable receipt against configuration before any provider GET. */
export async function agentMailFetchTarget(
  event: Pick<ProviderEvent, "resource_id" | "metadata">,
  configuredInboxId: string | undefined,
) {
  const inboxId = event.metadata.inbox_id;
  const messageId = providerMessageId(event.metadata.message_id);
  if (
    typeof inboxId !== "string" || !inboxIdPattern.test(inboxId) || !messageId ||
    inboxId !== configuredInboxId?.trim() ||
    await agentMailResourceId(inboxId, messageId) !== event.resource_id
  ) throw new AgentMailContentError("Provider resource does not match signed metadata");
  return { inboxId, messageId, url: agentMailMessageUrl(inboxId, messageId) };
}

const bracketed = (value: string) => value.startsWith("<") ? value : `<${value}>`;
function mediaType(value: unknown): string {
  if (value === undefined || value === null) return "application/octet-stream";
  if (!boundedText(value, 255)) throw new AgentMailContentError("Inbound attachments require review");
  return value.split(";")[0].trim().toLowerCase();
}
interface AgentMailAttachmentEntry {
  metadata: InboundAttachmentMetadata;
  providerId: string;
}
async function agentMailAttachments(
  value: unknown,
  messageId: string,
): Promise<AgentMailAttachmentEntry[]> {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 100) {
    throw new AgentMailContentError("Inbound attachments require review");
  }
  const seen = new Set<string>();
  const entries: AgentMailAttachmentEntry[] = [];
  for (const item of value) {
    if (
      !record(item) || !boundedText(item.attachment_id, 200) || seen.has(item.attachment_id) ||
      (item.filename !== undefined && item.filename !== null && !boundedText(item.filename, 255)) ||
      !Number.isSafeInteger(item.size) || (item.size as number) < 0
    ) throw new AgentMailContentError("Inbound attachments require review");
    seen.add(item.attachment_id);
    // Provider ids, URLs, content ids and inline HTML are never persisted.
    entries.push({
      providerId: item.attachment_id,
      metadata: {
        id: await agentMailAttachmentId(messageId, item.attachment_id),
        filename: typeof item.filename === "string" ? item.filename : null,
        content_type: mediaType(item.content_type),
        size: item.size as number,
      },
    });
  }
  return entries;
}

export interface NormalizedInboundEmail {
  sender: string;
  recipient: string;
  subject: string;
  body: string;
  html: string | null;
  occurred: string;
  rfc: string;
  replies: string[];
  attachments: InboundAttachmentMetadata[];
}
/** Provider GET response -> canonical inbound fields, bound to the signed receipt. */
export async function normalizeAgentMailMessage(
  data: unknown,
  metadata: Record<string, unknown>,
): Promise<NormalizedInboundEmail> {
  if (
    !record(data) || data.inbox_id !== metadata.inbox_id ||
    data.message_id !== metadata.message_id ||
    emailAddress(data.from) !== metadata.from || typeof metadata.to !== "string"
  ) throw new AgentMailContentError("Provider resource does not match signed metadata");
  const messageId = data.message_id as string;
  const attachments = (await agentMailAttachments(data.attachments, messageId))
    .map((entry) => entry.metadata);
  const references = Array.isArray(data.references) ? data.references : [];
  const replies = [data.in_reply_to, ...references]
    .filter((value): value is string => typeof value === "string")
    .flatMap((value) => value.split(/\s+/))
    .map((value) => value.trim())
    .filter((value) => /^<?[^<>\s]{1,996}>?$/.test(value))
    .map(bracketed)
    .slice(-50);
  const occurred = typeof data.created_at === "string" ? data.created_at : "";
  return {
    sender: metadata.from as string,
    recipient: metadata.to,
    subject: typeof data.subject === "string" ? data.subject : "",
    body: inboundEmailBody(data.text, data.html, attachments.length),
    html: typeof data.html === "string" ? data.html : null,
    occurred,
    rfc: bracketed(messageId),
    replies,
    attachments,
  };
}

const unavailable = () => new Error("Incoming attachment is unavailable for verified capture.");
async function boundedBytes(response: Response, size: number): Promise<Uint8Array> {
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) !== size)) {
    await response.body?.cancel();
    throw unavailable();
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
      if (total > size || total > ATTACHMENT_MAXIMUM) {
        await reader.cancel();
        throw unavailable();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total !== size) throw unavailable();
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
function safeDownloadUrl(value: unknown): URL {
  if (typeof value !== "string" || value.length > 8192) throw unavailable();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw unavailable();
  }
  // The CDN host is not documented; require plain HTTPS on a public DNS name.
  if (
    url.protocol !== "https:" || url.username || url.password || url.port || url.hash ||
    !url.hostname.includes(".") || /^[\d.]+$/.test(url.hostname) || url.hostname.startsWith("[") ||
    url.hostname === "localhost" || url.hostname.endsWith(".localhost")
  ) throw unavailable();
  return url;
}

export interface AgentMailCaptureTarget {
  emailId: string;
  providerMessageId: unknown;
  providerInboxId: unknown;
}
/**
 * Input must come from an authorized capture lease (saved receipt identity),
 * never browser-supplied ids or URLs. The provider attachment id is re-derived
 * from a fresh message GET, so no provider id is ever stored or accepted.
 */
export async function retrieveAgentMailAttachment(
  target: AgentMailCaptureTarget,
  expected: InboundAttachmentMetadata,
  env: { AGENTMAIL_API_KEY?: string; AGENTMAIL_INBOX_ID?: string },
  transport: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<CapturedInboundAttachment> {
  const apiKey = env.AGENTMAIL_API_KEY ?? "";
  const inboxId = typeof target.providerInboxId === "string" ? target.providerInboxId : "";
  const messageId = providerMessageId(target.providerMessageId);
  if (
    !apiKey || !messageId || !inboxIdPattern.test(inboxId) || inboxId !== env.AGENTMAIL_INBOX_ID?.trim() ||
    await agentMailResourceId(inboxId, messageId) !== target.emailId ||
    !Number.isSafeInteger(expected.size) || expected.size < 1 || expected.size > ATTACHMENT_MAXIMUM ||
    !SUPPORTED_ATTACHMENT_TYPES.includes(expected.content_type)
  ) throw unavailable();
  const authorization = { Authorization: `Bearer ${apiKey}` };
  const messageResponse = await transport(agentMailMessageUrl(inboxId, messageId), {
    headers: authorization, redirect: "error", signal: AbortSignal.timeout(30000),
  });
  if (!messageResponse.ok) {
    await messageResponse.body?.cancel();
    throw unavailable();
  }
  let entries: AgentMailAttachmentEntry[];
  try {
    const message: unknown = JSON.parse(await boundedBody(messageResponse, 1000000));
    if (!record(message) || message.message_id !== messageId || message.inbox_id !== inboxId) throw unavailable();
    entries = await agentMailAttachments(message.attachments, messageId);
  } catch {
    throw unavailable();
  }
  const matches = entries.filter((entry) => entry.metadata.id === expected.id);
  if (
    matches.length !== 1 || matches[0].metadata.filename !== expected.filename ||
    matches[0].metadata.size !== expected.size || matches[0].metadata.content_type !== expected.content_type
  ) throw unavailable();
  const attachmentResponse = await transport(
    `${agentMailMessageUrl(inboxId, messageId)}/attachments/${encodeURIComponent(matches[0].providerId)}`,
    { headers: authorization, redirect: "error", signal: AbortSignal.timeout(30000) },
  );
  if (!attachmentResponse.ok) {
    await attachmentResponse.body?.cancel();
    throw unavailable();
  }
  let bytesResponse = attachmentResponse;
  const kind = attachmentResponse.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (kind === "application/json" && expected.content_type !== "application/json") {
    let descriptor: unknown;
    try {
      descriptor = JSON.parse(await boundedBody(attachmentResponse, 65536));
    } catch {
      throw unavailable();
    }
    if (
      !record(descriptor) || descriptor.attachment_id !== matches[0].providerId ||
      descriptor.size !== expected.size || typeof descriptor.expires_at !== "string" ||
      !Number.isFinite(Date.parse(descriptor.expires_at)) || Date.parse(descriptor.expires_at) <= now()
    ) throw unavailable();
    const url = safeDownloadUrl(descriptor.download_url);
    // Signed CDN URLs are ephemeral capabilities. Never forward the provider API key.
    bytesResponse = await transport(url.href, {
      redirect: "error", signal: AbortSignal.timeout(30000), credentials: "omit",
    });
    if (!bytesResponse.ok) {
      await bytesResponse.body?.cancel();
      throw unavailable();
    }
  }
  const mime = bytesResponse.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (mime && mime !== expected.content_type && mime !== "application/octet-stream") {
    await bytesResponse.body?.cancel();
    throw unavailable();
  }
  const bytes = await boundedBytes(bytesResponse, expected.size);
  const sha256 = await verifyConversationAttachmentBytes(
    new Blob([bytes as BlobPart], { type: expected.content_type }),
    { mime_type: expected.content_type, byte_length: expected.size },
  );
  return { bytes, mimeType: expected.content_type, filename: expected.filename, sha256 };
}
