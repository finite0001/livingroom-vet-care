export interface AttachmentUploadIntent {
  id: string;
  actorId: string;
  conversationId: string;
  file: File;
}
export interface AttachmentUploadReceipt {
  id: string;
  actor_id: string;
  conversation_id: string;
  file_name: string;
  mime_type: string;
  byte_length: number;
  storage_path: string;
  status: "uploading" | "ready" | "abandoned";
  sha256: string | null;
}
export interface AttachmentUploadTransport {
  reserve(
    args: {
      p_id: string;
      p_conversation_id: string;
      p_file_name: string;
      p_mime_type: string;
      p_byte_length: number;
    },
  ): Promise<unknown>;
  upload(path: string, file: File): Promise<void>;
  verify(id: string): Promise<unknown>;
}
export class AttachmentUploadUnconfirmedError extends Error {
  constructor() {
    super(
      "Upload could not be confirmed. Keep this upload selected and retry.",
    );
  }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function receipt(
  value: unknown,
  intent: AttachmentUploadIntent,
): AttachmentUploadReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid upload response");
  }
  const r = value as Record<string, unknown>;
  const path =
    `${intent.actorId}/${intent.conversationId}/${intent.id}/original`;
  if (
    r.id !== intent.id || r.actor_id !== intent.actorId ||
    r.conversation_id !== intent.conversationId ||
    r.file_name !== intent.file.name || r.mime_type !== intent.file.type ||
    r.byte_length !== intent.file.size || r.storage_path !== path ||
    !["uploading", "ready", "abandoned"].includes(String(r.status)) ||
    (r.status === "ready"
      ? typeof r.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(r.sha256)
      : r.sha256 !== null)
  ) {
    throw new Error(
      "Upload response does not match this file and conversation",
    );
  }
  return {
    id: intent.id,
    actor_id: intent.actorId,
    conversation_id: intent.conversationId,
    file_name: intent.file.name,
    mime_type: intent.file.type,
    byte_length: intent.file.size,
    storage_path: path,
    status: r.status as AttachmentUploadReceipt["status"],
    sha256: r.sha256 as string | null,
  };
}
/** Caller retains the same intent ID across retries; this function never sends a message. */
export async function uploadConversationAttachment(
  intent: AttachmentUploadIntent,
  transport: AttachmentUploadTransport,
): Promise<AttachmentUploadReceipt> {
  if (
    ![intent.id, intent.actorId, intent.conversationId].every((value) =>
      uuid.test(value)
    ) ||
    !["application/pdf", "image/png", "image/jpeg"].includes(
      intent.file.type,
    ) || intent.file.size < 1 || intent.file.size > 10 * 1024 * 1024 ||
    intent.file.name.length > 255 || !intent.file.name.trim() ||
    intent.file.name !== intent.file.name.trim() ||
    /[/\\]/.test(intent.file.name) ||
    Array.from(intent.file.name).some((char) =>
      char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127
    )
  ) {
    throw new Error(
      "Choose a PDF, PNG or JPEG file up to 10 MB with a valid filename",
    );
  }
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", await intent.file.arrayBuffer()),
  );
  const expectedHash = Array.from(
    digest,
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  const reserved = receipt(
    await transport.reserve({
      p_id: intent.id,
      p_conversation_id: intent.conversationId,
      p_file_name: intent.file.name,
      p_mime_type: intent.file.type,
      p_byte_length: intent.file.size,
    }),
    intent,
  );
  if (reserved.status === "abandoned") {
    throw new Error(
      "This upload was abandoned. Select the file as a new upload.",
    );
  }
  if (reserved.status === "uploading") {
    try {
      await transport.upload(reserved.storage_path, intent.file);
    } catch {
      /* An existing immutable object or lost upload reply can be settled by verification. */
    }
  }
  let verified: AttachmentUploadReceipt;
  try {
    verified = receipt(await transport.verify(intent.id), intent);
  } catch {
    throw new AttachmentUploadUnconfirmedError();
  }
  if (verified.status !== "ready") throw new AttachmentUploadUnconfirmedError();
  if (verified.sha256 !== expectedHash) {
    throw new Error(
      "Stored bytes differ from the selected file. Keep the existing evidence and start a new upload for a different file.",
    );
  }
  return verified;
}
