import { ImportError } from "./import-error.ts";

export const maxAttachmentBytes = 20 * 1024 * 1024;
export interface AttachmentBytes {
  bytes: Uint8Array<ArrayBuffer>;
  mimeType: "application/pdf" | "image/jpeg" | "image/png";
  size: number;
  sha256: string;
}

/** Generic/missing MIME is resolved by the signature; unsupported declarations fail closed. */
export function attachmentMime(value: string | null): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new ImportError("ATTACHMENT_UNSUPPORTED_TYPE");
  const mime = value.split(";", 1)[0].trim().toLowerCase();
  if (mime === "application/octet-stream") return null;
  if (!["application/pdf", "image/jpeg", "image/png"].includes(mime)) {
    throw new ImportError("ATTACHMENT_UNSUPPORTED_TYPE");
  }
  return mime;
}

/** Preserve original bytes. This checks signatures, not complete file syntax or malware. */
export async function readAttachmentBytes(response: Response, metadataMime: string | null, signal: AbortSignal): Promise<AttachmentBytes> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    if (signal.aborted) throw new ImportError("UPSTREAM_UNAVAILABLE");
    if (response.status !== 200 || response.redirected || response.headers.has("content-range") ||
      ![null, "identity"].includes(response.headers.get("content-encoding"))) {
      throw new ImportError("ATTACHMENT_INVALID_CONTENT");
    }
    const expectedMime = attachmentMime(metadataMime);
    const transportMime = attachmentMime(response.headers.get("content-type"));
    const lengthHeader = response.headers.get("content-length");
    if (lengthHeader !== null && !/^(0|[1-9][0-9]*)$/.test(lengthHeader)) {
      throw new ImportError("ATTACHMENT_INVALID_CONTENT");
    }
    const declared = lengthHeader === null ? null : Number(lengthHeader);
    if (declared !== null && (!Number.isSafeInteger(declared) || declared > maxAttachmentBytes)) {
      throw new ImportError("ATTACHMENT_TOO_LARGE");
    }
    if (declared === 0 || !response.body) throw new ImportError("ATTACHMENT_INVALID_CONTENT");
    reader = response.body.getReader();
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(new ImportError("UPSTREAM_UNAVAILABLE"));
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const chunk = await Promise.race([reader.read(), aborted]);
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxAttachmentBytes) throw new ImportError("ATTACHMENT_TOO_LARGE");
      if (declared !== null && size > declared) throw new ImportError("ATTACHMENT_INVALID_CONTENT");
      chunks.push(chunk.value);
    }
    if (!size || (declared !== null && size !== declared)) throw new ImportError("ATTACHMENT_INVALID_CONTENT");
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const starts = (signature: number[]) => signature.every((value, i) => bytes[i] === value);
    const mimeType = starts([0x25, 0x50, 0x44, 0x46, 0x2d]) ? "application/pdf"
      : starts([0xff, 0xd8, 0xff]) ? "image/jpeg"
      : starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) ? "image/png" : null;
    if (!mimeType || (expectedMime !== null && expectedMime !== mimeType) || (transportMime !== null && transportMime !== mimeType)) {
      throw new ImportError("ATTACHMENT_INVALID_CONTENT");
    }
    const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
    if (signal.aborted) throw new ImportError("UPSTREAM_UNAVAILABLE");
    return { bytes, mimeType, size, sha256 };
  } catch (error) {
    // Do not wait for a broken upstream cancellation promise to settle.
    if (reader) void reader.cancel().catch(() => {});
    else if (response.body) void response.body.cancel().catch(() => {});
    throw error instanceof ImportError ? error : new ImportError("UPSTREAM_UNAVAILABLE");
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
    reader?.releaseLock();
  }
}
