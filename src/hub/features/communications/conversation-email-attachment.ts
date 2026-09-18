import type { ConversationEmailReview } from "./conversation-email-review.ts";
export interface ConversationEmailAttachmentClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
/** Caller owns the returned Blob URL lifecycle; no signed URLs or provider fetches. */
export async function readCapturedConversationFile(
  client: ConversationEmailAttachmentClient,
  actorId: string,
  currentActor: () => string | null,
  review: Pick<ConversationEmailReview, "requestId" | "payloadHash" | "files">,
  uploadId: string,
): Promise<Blob> {
  const check = () => { if (!actorId || currentActor() !== actorId) throw new Error("Account changed. Reopen this review after signing in."); };
  check();
  const file = review.files.find(file => file.uploadId === uploadId);
  if (!file) throw new Error("File is not part of this reviewed email.");
  const { data, error } = await client.rpc("read_conversation_email_attachment", {
    p_request_id: review.requestId, p_upload_id: uploadId, p_payload_hash: review.payloadHash,
  });
  check();
  if (error) throw error;
  if (!record(data) || data.request_id !== review.requestId || data.upload_id !== uploadId || data.payload_hash !== review.payloadHash || !record(data.attachment))
    throw new Error("Captured file response does not match this review.");
  const attachment = data.attachment;
  if (attachment.filename !== file.name || attachment.content_type !== file.mimeType ||
    typeof attachment.content !== "string" || attachment.content.length !== Math.ceil(file.size / 3) * 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(attachment.content)) throw new Error("Captured file metadata differs from this review.");
  const bytes = Uint8Array.from(atob(attachment.content), character => character.charCodeAt(0));
  if (bytes.length !== file.size) throw new Error("Captured file size differs from this review.");
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  check();
  const hash = [...digest].map(value => value.toString(16).padStart(2, "0")).join("");
  if (hash !== file.sha256) throw new Error("Captured file content differs from this review.");
  return new Blob([bytes], { type: file.mimeType });
}
