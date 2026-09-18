import { readCapturedConversationFile, type ConversationEmailAttachmentClient } from "./conversation-email-attachment.ts";
import type { ConversationEmailReviewFile } from "./conversation-email-review.ts";
export interface MessageAttachmentHistory {
  messageId: string;
  requestId: string;
  payloadHash: string;
  files: ConversationEmailReviewFile[];
}
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export function parseMessageAttachments(value: unknown, requestedIds: string[]): MessageAttachmentHistory[] {
  if (!Array.isArray(value) || value.length > requestedIds.length) throw new Error("Attachment history is unavailable.");
  const seen = new Set<string>();
  return value.map(row => {
    if (!record(row) || !uuid(row.message_id) || !requestedIds.includes(row.message_id) || seen.has(row.message_id) ||
      !uuid(row.request_id) || !hash(row.payload_hash) || !Array.isArray(row.files) || row.files.length < 1 || row.files.length > 5)
      throw new Error("Attachment history does not match these messages.");
    seen.add(row.message_id);
    const uploads = new Set<string>();
    const files = row.files.map((file): ConversationEmailReviewFile => {
      if (!record(file) || !uuid(file.upload_id) || uploads.has(file.upload_id) || typeof file.file_name !== "string" || !file.file_name.trim() ||
        file.file_name.length > 255 || typeof file.mime_type !== "string" || !["application/pdf", "image/png", "image/jpeg"].includes(file.mime_type) ||
        typeof file.byte_length !== "number" || !Number.isSafeInteger(file.byte_length) || file.byte_length < 1 || file.byte_length > 10485760 || !hash(file.sha256))
        throw new Error("Attachment history contains incomplete file evidence.");
      uploads.add(file.upload_id);
      return { uploadId: file.upload_id, name: file.file_name, mimeType: file.mime_type, size: file.byte_length, sha256: file.sha256 };
    });
    if (files.reduce((total, file) => total + file.size, 0) > 20971520) throw new Error("Attachment history exceeds limits.");
    return { messageId: row.message_id, requestId: row.request_id, payloadHash: row.payload_hash, files };
  });
}
export function readMessageAttachment(client: ConversationEmailAttachmentClient, actorId: string, currentActor: () => string | null, history: MessageAttachmentHistory, uploadId: string) {
  return readCapturedConversationFile({ rpc: async (_name, args) => {
    const result = await client.rpc("read_conversation_message_attachment", {
      p_message_id: history.messageId, p_upload_id: args.p_upload_id, p_payload_hash: args.p_payload_hash,
    });
    if (result.error) throw result.error;
    if (!record(result.data) || result.data.message_id !== history.messageId) throw new Error("Attachment belongs to another message.");
    return result;
  } }, actorId, currentActor, history, uploadId);
}
