import type { AttachmentFileRecovery } from "./attachment-file-state.ts";
export async function verifyAttachmentOriginal(blob: Blob, original: Pick<NonNullable<AttachmentFileRecovery["original"]>, "file_size" | "mime_type" | "content_sha256">): Promise<Blob> {
  if (!Number.isSafeInteger(original.file_size) || original.file_size < 1 || original.file_size > 20 * 1024 * 1024 || blob.size !== original.file_size || blob.type !== original.mime_type || !["application/pdf", "image/jpeg", "image/png"].includes(original.mime_type)) throw new Error("Original file size or type differs from the saved capture.");
  const bytes = await blob.arrayBuffer();
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), n => n.toString(16).padStart(2, "0")).join("");
  if (digest !== original.content_sha256) throw new Error("Original file bytes differ from the saved capture.");
  return new Blob([bytes], { type: original.mime_type });
}
export function attachmentOriginalFilename(externalId: string, mime: string) {
  if (!/^(0|[1-9][0-9]{0,15})$/.test(externalId)) throw new Error("Invalid attachment identity.");
  const suffix = mime === "application/pdf" ? "pdf" : mime === "image/jpeg" ? "jpg" : mime === "image/png" ? "png" : null;
  if (!suffix) throw new Error("Unsupported captured file type.");
  return `ezyvet-attachment-${externalId}.${suffix}`;
}
