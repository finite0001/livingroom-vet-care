import {
  renderRecordRelease,
  type ReleaseBundle,
} from "./record-release-renderer.ts";
import { normalizeEmail } from "./delivery-policy.ts";
export const RELEASE_EMAIL_MAX_BYTES = 32 * 1024 * 1024;
export const RELEASE_EMAIL_MAX_ATTACHMENTS = 25;
export interface ReleaseEmailIntent {
  id: string;
  release_id: string;
  actor_id: string;
  recipient: string;
  subject: string;
  body: string;
  release_hash: string;
}
export interface ReleaseEmailAttachment {
  filename: string;
  content_type: string;
  content: string;
}
export interface ReleaseEmailPayload {
  from: string;
  reply_to: string;
  to: string[];
  subject: string;
  text: string;
  attachments: ReleaseEmailAttachment[];
}
export function releaseAttachmentFilename(
  index: number,
  name: string,
  mime: string,
): string {
  const extension = (
    {
      "application/pdf": "pdf",
      "image/jpeg": "jpg",
      "image/png": "png",
    } as Record<string, string>
  )[mime];
  if (!extension) throw new Error("Original document type cannot be attached.");
  const base =
    name
      .replace(/\.[^.]*$/, "")
      .replace(/[^A-Za-z0-9 _.-]/g, "_")
      .replace(/^[ .]+|[ .]+$/g, "")
      .slice(0, 100) || "record";
  return `${index}-${base}.${extension}`;
}
export function base64Bytes(bytes: Uint8Array): string {
  let text = "";
  for (let offset = 0; offset < bytes.length; offset += 8192)
    text += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(text);
}
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", bytes as BufferSource),
    ),
  ]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
function matchesMime(bytes: Uint8Array, mime: string): boolean {
  if (mime === "application/pdf")
    return new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-";
  if (mime === "image/jpeg")
    return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  return (
    mime === "image/png" &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)
  );
}
export async function buildReleaseEmailPayload(
  intent: ReleaseEmailIntent,
  bundle: ReleaseBundle,
  sender: { from: string; replyTo: string },
  download: (
    bucket: string,
    path: string,
    expectedSize: number,
  ) => Promise<Uint8Array>,
): Promise<{ payload_text: string; payload_hash: string }> {
  if (
    !bundle.eligible ||
    bundle.events.length ||
    bundle.release.id !== intent.release_id ||
    bundle.release.source_hash !== intent.release_hash ||
    bundle.release.channel !== "EMAIL" ||
    bundle.release.recipient !== intent.recipient
  )
    throw new Error("Release is no longer eligible for this email.");
  sender = {
    from: sender.from.trim(),
    replyTo: normalizeEmail(sender.replyTo) || "",
  };
  const mailbox =
    sender.from.match(/^[^<>\r\n]+<([^<>]+)>$/)?.[1] ?? sender.from;
  if (
    !normalizeEmail(mailbox) ||
    !normalizeEmail(sender.replyTo) ||
    sender.from.length > 500
  )
    throw new Error("Practice sender and reply mailbox must be configured.");
  const originals = bundle.release.snapshot.attachments;
  if (originals.length + 1 > RELEASE_EMAIL_MAX_ATTACHMENTS)
    throw new Error(
      "Email supports at most 24 original documents plus the rendered report. Split the reviewed package.",
    );
  const report = renderRecordRelease({
    preview: bundle.release,
    confirmed: {
      id: bundle.release.id,
      created_at: bundle.release.created_at,
      created_by: bundle.release.created_by,
      eligible: true,
      events: [],
      ineligibility_reason: null,
    },
  });
  const reportBytes = new TextEncoder().encode(report);
  let estimated =
    Math.ceil(reportBytes.length / 3) * 4 +
    new TextEncoder().encode(
      intent.subject + intent.body + sender.from + sender.replyTo,
    ).length +
    8192;
  for (const d of originals) {
    if (
      !Number.isSafeInteger(d.file_size) ||
      d.file_size < 1 ||
      d.file_size > 20971520
    )
      throw new Error("Original document size is invalid.");
    estimated += Math.ceil(d.file_size / 3) * 4 + 1024;
  }
  if (estimated > RELEASE_EMAIL_MAX_BYTES)
    throw new Error(
      "Encoded email exceeds the 32 MiB application limit. Split the reviewed package.",
    );
  const attachments: ReleaseEmailAttachment[] = [
    {
      filename: `medical-records-${intent.release_id}.html`,
      content_type: "text/html",
      content: base64Bytes(reportBytes),
    },
  ];
  for (const [index, d] of originals.entries()) {
    if (
      d.bucket !== "patient-documents" ||
      !d.file_path ||
      d.file_path.includes("..")
    )
      throw new Error("Private original reference is invalid.");
    const bytes = await download(d.bucket, d.file_path, d.file_size);
    if (bytes.length !== d.file_size || !matchesMime(bytes, d.mime_type))
      throw new Error(
        "Original document bytes differ from the reviewed type or size.",
      );
    if ([5, 6].includes(bundle.release.snapshot.schema_version) && d.content_sha256 !== undefined && await sha256Hex(bytes) !== d.content_sha256)
      throw new Error("Original bytes differ from captured source provenance.");
    attachments.push({
      filename: releaseAttachmentFilename(index + 1, d.file_name, d.mime_type),
      content_type: d.mime_type,
      content: base64Bytes(bytes),
    });
  }
  const payload: ReleaseEmailPayload = {
    from: sender.from,
    reply_to: sender.replyTo,
    to: [intent.recipient],
    subject: intent.subject,
    text: intent.body,
    attachments,
  };
  const payload_text = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(payload_text);
  if (bytes.length > RELEASE_EMAIL_MAX_BYTES)
    throw new Error(
      "Encoded email exceeds the 32 MiB application limit. Split the reviewed package.",
    );
  return { payload_text, payload_hash: await sha256Hex(bytes) };
}
export async function verifyFrozenReleaseEmail(
  value: { payload_text: string; payload_hash: string },
  expected: {
    recipient: string;
    subject: string;
    body: string;
    from: string;
    replyTo: string;
  },
): Promise<string> {
  const bytes = new TextEncoder().encode(value.payload_text);
  if (
    bytes.length > RELEASE_EMAIL_MAX_BYTES ||
    (await sha256Hex(bytes)) !== value.payload_hash
  )
    throw new Error("Frozen email integrity check failed.");
  const payload = JSON.parse(value.payload_text) as ReleaseEmailPayload;
  if (
    payload.from !== expected.from ||
    payload.reply_to !== expected.replyTo ||
    JSON.stringify(payload.to) !== JSON.stringify([expected.recipient]) ||
    payload.subject !== expected.subject ||
    payload.text !== expected.body ||
    !Array.isArray(payload.attachments) ||
    payload.attachments.length < 1 ||
    payload.attachments.length > RELEASE_EMAIL_MAX_ATTACHMENTS
  )
    throw new Error("Frozen email metadata differs.");
  return value.payload_text;
}

export { verifyFrozenReleaseEmail as verifyFrozenEmailPayload };
