import { normalizeEmail } from "./delivery-policy.ts";
import { base64Bytes, sha256Hex, RELEASE_EMAIL_MAX_BYTES } from "./release-email-payload.ts";
import { verifyConversationAttachmentBytes } from "./verify-conversation-attachment.ts";

export interface ConversationEmailFile {
  upload_id: string;
  file_name: string;
  mime_type: string;
  byte_length: number;
  sha256: string;
  storage_path: string;
}
export interface ConversationEmailCapture {
  actor_id: string;
  payload: {
    conversation_id: string;
    channel: string;
    to: string;
    subject: string;
    body: string;
    attachment_ids: string[];
  };
  manifest: ConversationEmailFile[];
}
export interface ConversationEmailSender { from: string; replyTo: string }

const hasControl = (value: string) => [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);

/** Build only from an authenticated, server-owned capture context; never from browser paths. */
export async function buildConversationEmailPayload(
  context: ConversationEmailCapture,
  sender: ConversationEmailSender,
  download: (path: string) => Promise<Blob>,
): Promise<{ payload_text: string; payload_hash: string }> {
  const { payload, manifest } = context;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const recipient = normalizeEmail(payload.to);
  const from = sender.from.trim();
  const replyTo = normalizeEmail(sender.replyTo);
  const mailbox = from.match(/^[^<>\r\n]+<([^<>]+)>$/)?.[1] ?? from;
  if (!replyTo || !normalizeEmail(mailbox) || !from || from.length > 500 || hasControl(from))
    throw new Error("Practice sender and reply mailbox must be configured.");
  if (!uuid.test(context.actor_id) || !uuid.test(payload.conversation_id) || payload.channel !== "EMAIL" || !recipient ||
    typeof payload.subject !== "string" || !payload.subject.trim() || payload.subject.trim().length > 500 ||
    typeof payload.body !== "string" || !payload.body.trim() || payload.body.trim().length > 100000 ||
    !Array.isArray(manifest) || manifest.length < 1 || manifest.length > 5 ||
    !Array.isArray(payload.attachment_ids) || payload.attachment_ids.length !== manifest.length ||
    new Set(payload.attachment_ids).size !== manifest.length)
    throw new Error("Exact prepared attachment email required.");
  let total = 0;
  // Validate every reference before the first download, including order and actor ownership.
  for (const [index, file] of manifest.entries()) {
    if (!uuid.test(file.upload_id) || file.upload_id !== payload.attachment_ids[index] ||
      file.storage_path !== `${context.actor_id}/${payload.conversation_id}/${file.upload_id}/original` ||
      typeof file.file_name !== "string" || file.file_name !== file.file_name.trim() ||
      !file.file_name || file.file_name.length > 255 || (hasControl(file.file_name) || /[/\\]/.test(file.file_name)) ||
      !["application/pdf", "image/png", "image/jpeg"].includes(file.mime_type) ||
      !Number.isSafeInteger(file.byte_length) || file.byte_length < 1 || file.byte_length > 10485760 ||
      !/^[a-f0-9]{64}$/.test(file.sha256))
      throw new Error("Verified attachment manifest is invalid.");
    total += file.byte_length;
  }
  if (total > 20971520) throw new Error("Attachment email exceeds twenty MiB raw limit.");
  const attachments = [];
  for (const file of manifest) {
    const blob = await download(file.storage_path);
    if (await verifyConversationAttachmentBytes(blob, file) !== file.sha256)
      throw new Error("Attachment bytes differ from the verified upload.");
    attachments.push({ filename: file.file_name, content_type: file.mime_type,
      content: base64Bytes(new Uint8Array(await blob.arrayBuffer())) });
  }
  const payload_text = JSON.stringify({ from, reply_to: replyTo, to: [recipient],
    subject: payload.subject, text: payload.body, attachments });
  const bytes = new TextEncoder().encode(payload_text);
  if (bytes.length > RELEASE_EMAIL_MAX_BYTES) throw new Error("Encoded email exceeds the application limit.");
  return { payload_text, payload_hash: await sha256Hex(bytes) };
}
