import type { CapturedInboundAttachment } from "./resend-attachment.ts";
import { verifyConversationAttachmentBytes } from "../verify-conversation-attachment.ts";
export interface IncomingOriginalStorage {
  upload(path: string, bytes: Uint8Array, options: { contentType: string; upsert: false }): PromiseLike<{ error: unknown }>;
  download(path: string): PromiseLike<{ data: Blob | null; error: unknown }>;
}
/** Read back the immutable object even after a lost upload response or duplicate-path error. */
export async function storeIncomingOriginal(storage: IncomingOriginalStorage, path: string, captured: CapturedInboundAttachment): Promise<void> {
  if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/original$/i.test(path)) throw new Error("Invalid incoming original path");
  try {
    const { error } = await storage.upload(path, captured.bytes, { contentType: captured.mimeType, upsert: false });
    if (error) throw error;
  }
  catch { /* Read-back determines whether this exact attempt's object was persisted. */ }
  const { data, error } = await storage.download(path);
  if (error) throw error;
  if (!data) throw new Error("Incoming original storage is unconfirmed");
  const digest = await verifyConversationAttachmentBytes(data, { mime_type: captured.mimeType, byte_length: captured.bytes.length });
  if (digest !== captured.sha256) throw new Error("Stored incoming original bytes differ");
}
