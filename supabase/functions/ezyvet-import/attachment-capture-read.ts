import { parsePage, type AttachmentParent, type StagedEntity } from "./adapter.ts";
import { attachmentMime, type AttachmentBytes } from "./attachment-bytes.ts";
import { ImportError } from "./import-error.ts";

export interface AttachmentCaptureReader {
  attachmentMetadata: (id: string, parent: AttachmentParent) => Promise<StagedEntity>;
  downloadAttachment: (id: string, parent: AttachmentParent, mime: string | null) => Promise<AttachmentBytes>;
}
export interface AttachmentCaptureRead {
  file: AttachmentBytes;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, canonical(v)]));
  return value;
}

/** Caller must obtain expected metadata from an owned database lease, then revalidate it at capture. */
export async function readAttachmentForCapture(reader: AttachmentCaptureReader, id: string, parent: AttachmentParent, expected: Record<string, unknown>): Promise<AttachmentCaptureRead> {
  // Validate the saved source using the same parser as metadata intake. Raw URLs remain data only.
  const parsed = parsePage({ items: [{ attachment: expected }], meta: { items_page: 1, items_page_total: 1 } }, "attachment", 1).items[0];
  if (!parent || !["Animal", "Consult"].includes(parent.parent_type) || typeof parent.parent_external_id !== "string" ||
    parsed.external_id !== id || expected.record_type !== parent.parent_type || String(expected.record_id) !== parent.parent_external_id) {
    throw new ImportError("SOURCE_ATTACHMENT_METADATA_CHANGED");
  }
  const expectedJson = JSON.stringify(canonical(parsed.payload));
  if (new TextEncoder().encode(expectedJson).byteLength > 2 * 1024 * 1024) throw new ImportError("UPSTREAM_RESPONSE_TOO_LARGE");
  const mime = parsed.payload.mime_type === undefined || parsed.payload.mime_type === null ? null : String(parsed.payload.mime_type);
  attachmentMime(mime);
  const unchanged = (observed: StagedEntity) => {
    if (observed.external_id !== id || JSON.stringify(canonical(observed.payload)) !== expectedJson) throw new ImportError("SOURCE_ATTACHMENT_METADATA_CHANGED");
  };
  const before = await reader.attachmentMetadata(id, parent);
  unchanged(before);
  const file = await reader.downloadAttachment(id, parent, mime);
  const after = await reader.attachmentMetadata(id, parent);
  unchanged(after);
  // This is a consistency observation, not a provider snapshot guarantee or an approval receipt.
  return { file, before: before.payload, after: after.payload };
}
