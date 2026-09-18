/** Provider metadata only: this never authorizes a URL fetch or asserts byte safety. */
export interface InboundAttachmentMetadata {
  id: string;
  filename: string | null;
  content_type: string;
  size: number;
}
export class InboundAttachmentMetadataError extends Error {}
const invalid = () =>
  new InboundAttachmentMetadataError("Inbound attachments require review");
function boundedText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.trim().length > 0 &&
    value.length <= maximum && !Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    });
}
export function parseInboundEmailAttachments(
  value: unknown,
): InboundAttachmentMetadata[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 100) throw invalid();
  const seen = new Set<string>();
  return value.map((entry: unknown) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw invalid();
    }
    const item = entry as Record<string, unknown>;
    if (
      !boundedText(item.id, 200) || seen.has(item.id) ||
      (item.filename !== null && !boundedText(item.filename, 255)) ||
      !boundedText(item.content_type, 255) ||
      !Number.isSafeInteger(item.size) || (item.size as number) < 0
    ) throw invalid();
    seen.add(item.id);
    // Do not persist provider URLs, arbitrary properties or inline HTML.
    return {
      id: item.id,
      filename: item.filename as string | null,
      content_type: item.content_type,
      size: item.size as number,
    };
  });
}
export function inboundEmailBody(
  text: unknown,
  html: unknown,
  attachments: number,
): string {
  if (typeof text === "string" && text.trim()) return text;
  const hasHtml = typeof html === "string" && html.trim().length > 0;
  if (attachments > 0) {
    const files = attachments === 1
      ? "1 attachment"
      : `${attachments} attachments`;
    return `[Email contains ${files}${
      hasHtml ? " and an HTML body" : " and no text body"
    }. Attachment contents have not been retrieved.]`;
  }
  return hasHtml
    ? "[Email has no plain-text body. HTML original retained for safe review.]"
    : "[Email has no text body or attachments.]";
}
export function parseInboundMediaCount(value: unknown): number {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,2})$/.test(value)) {
    throw invalid();
  }
  const count = Number(value);
  if (count > 100) throw invalid();
  return count;
}
