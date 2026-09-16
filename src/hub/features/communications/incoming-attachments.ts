export interface IncomingAttachment {
  inboundId: string;
  version: number;
  messageId: string;
  attachmentId: string | null;
  name: string;
  mimeType: string | null;
  size: number | null;
  status: "pending" | "capturing" | "ready" | "unsupported";
  captureId: string | null;
  sha256: string | null;
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export function parseIncomingAttachments(value: unknown, messageIds: string[]): IncomingAttachment[] {
  if (!Array.isArray(value)) throw new Error("Incoming attachment list is unavailable.");
  const seen = new Set<string>();
  return value.map(row => {
    if (!record(row) || !uuid(row.inbound_id) || !uuid(row.message_id) || !messageIds.includes(row.message_id) ||
      typeof row.inbound_version !== "number" || !Number.isSafeInteger(row.inbound_version) || row.inbound_version < 1 ||
      !["pending", "capturing", "ready", "unsupported"].includes(String(row.status))) throw new Error("Incoming attachment identity is unconfirmed.");
    if (row.status !== "unsupported" && (!uuid(row.attachment_id) || typeof row.byte_length !== "number" || !Number.isSafeInteger(row.byte_length) ||
      row.byte_length < 1 || row.byte_length > 10485760 || !["application/pdf", "image/png", "image/jpeg"].includes(String(row.mime_type))))
      throw new Error("Incoming attachment metadata is incomplete.");
    if (row.status === "ready" ? !uuid(row.capture_id) || !hash(row.sha256) : row.capture_id !== null || row.sha256 !== null)
      throw new Error("Incoming attachment verification is unconfirmed.");
    const attachmentId = typeof row.attachment_id === "string" ? row.attachment_id : null;
    if (attachmentId) {
      const key = `${row.inbound_id}:${attachmentId}`;
      if (seen.has(key)) throw new Error("Incoming attachment identity is duplicated.");
      seen.add(key);
    }
    return { inboundId: row.inbound_id, version: row.inbound_version, messageId: row.message_id, attachmentId,
      name: typeof row.filename === "string" && row.filename.trim() ? row.filename : "Unnamed attachment",
      mimeType: typeof row.mime_type === "string" ? row.mime_type : null,
      size: typeof row.byte_length === "number" && Number.isSafeInteger(row.byte_length) && row.byte_length >= 0 ? row.byte_length : null,
      status: row.status as IncomingAttachment["status"], captureId: row.capture_id as string | null, sha256: row.sha256 as string | null };
  });
}
/** Verify a binary response before any browser object URL is created. */
export async function verifyIncomingDownload(blob: Blob, file: IncomingAttachment, actorId: string, currentActor: () => string | null): Promise<Blob> {
  if (!actorId || currentActor() !== actorId || file.status !== "ready" || !file.sha256 || blob.size !== file.size || blob.type !== file.mimeType)
    throw new Error("Incoming file download is unconfirmed.");
  const bytes = await blob.arrayBuffer();
  const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(value => value.toString(16).padStart(2, "0")).join("");
  if (currentActor() !== actorId || digest !== file.sha256) throw new Error("Incoming file download is unconfirmed.");
  return blob;
}
