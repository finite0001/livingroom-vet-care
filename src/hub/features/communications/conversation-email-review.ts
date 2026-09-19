import type { MessageIntent, QueueReceipt } from "./queue-intent.ts";
export interface ConversationEmailReviewFile {
  uploadId: string;
  name: string;
  mimeType: string;
  size: number;
  sha256: string;
}
export interface ConversationEmailReview {
  requestId: string;
  payload: MessageIntent;
  payloadHash: string;
  files: ConversationEmailReviewFile[];
  receipt: QueueReceipt | null;
}
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export function parseConversationEmailReview(value: unknown, expected: { requestId: string; conversationId: string }): ConversationEmailReview {
  const invalid = () => new Error("Saved attachment email is incomplete. Recover the same request before continuing.");
  if (!record(value) || value.request_id !== expected.requestId || !uuid(value.request_id) ||
    value.captured !== true || !hash(value.payload_hash) ||
    !["prepared", "acknowledged"].includes(String(value.status)) || !record(value.payload)) throw invalid();
  const p = value.payload;
  if (p.channel !== "EMAIL" || p.conversation_id !== expected.conversationId || !uuid(p.conversation_id) ||
    typeof p.to !== "string" || !p.to.trim() || typeof p.subject !== "string" || !p.subject.trim() ||
    typeof p.body !== "string" || !p.body.trim() || !Array.isArray(p.attachment_ids) ||
    p.attachment_ids.length < 1 || p.attachment_ids.length > 5 ||
    !p.attachment_ids.every(uuid) || new Set(p.attachment_ids).size !== p.attachment_ids.length ||
    !Array.isArray(value.attachment_manifest) || value.attachment_manifest.length !== p.attachment_ids.length) throw invalid();
  const attachmentIds = p.attachment_ids;
  const files = value.attachment_manifest.map((file, index): ConversationEmailReviewFile => {
    if (!record(file) || file.upload_id !== attachmentIds[index] || !uuid(file.upload_id) ||
      typeof file.file_name !== "string" || !file.file_name.trim() || file.file_name.length > 255 ||
      typeof file.mime_type !== "string" || !["application/pdf", "image/png", "image/jpeg"].includes(file.mime_type) ||
      typeof file.byte_length !== "number" || !Number.isSafeInteger(file.byte_length) || file.byte_length < 1 || file.byte_length > 10485760 ||
      !hash(file.sha256)) throw invalid();
    return { uploadId: file.upload_id, name: file.file_name, mimeType: file.mime_type, size: file.byte_length, sha256: file.sha256 };
  });
  if (files.reduce((total, file) => total + file.size, 0) > 20971520) throw invalid();
  let receipt: QueueReceipt | null = null;
  if (value.receipt !== null) {
    const r = value.receipt;
    if (!record(r) || r.success !== true || r.queued !== true || !uuid(r.outbox_id) || !uuid(r.message_id) ||
      typeof r.state !== "string" || !["pending", "claimed", "accepted", "delivered", "failed", "uncertain"].includes(r.state)) throw invalid();
    receipt = { success: true, queued: true, outbox_id: r.outbox_id, message_id: r.message_id, state: r.state };
  }
  if (value.status === "acknowledged" && !receipt) throw invalid();
  return { requestId: value.request_id, payloadHash: value.payload_hash, files, receipt,
    payload: { conversation_id: p.conversation_id, channel: "EMAIL", to: p.to, subject: p.subject, body: p.body, attachment_ids: p.attachment_ids } };
}
