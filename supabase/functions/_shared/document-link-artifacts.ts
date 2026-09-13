import {
  renderInvoiceDocument,
  type InvoicePractice,
} from "./invoice-document.ts";
import {
  renderRecordRelease,
  type ReleaseBundle,
} from "./record-release-renderer.ts";
import {
  base64Bytes,
  sha256Hex,
  releaseAttachmentFilename,
} from "./release-email-payload.ts";
export interface DocumentLinkGrant {
  id: string;
  family: "invoice" | "record_release";
  source_id: string;
  client_id: string;
  actor_id: string;
  recipient: string;
  source_hash: string;
  source_bundle: unknown;
  created_at: string;
  expires_at: string;
  origin: string;
  key_version: string;
  capability_context: string;
  message_template: string;
  state: string;
}
export interface FrozenLinkArtifact {
  filename: string;
  mime_type: string;
  document_id: string | null;
  content: string;
}
export async function buildDocumentLinkArtifacts(
  grant: DocumentLinkGrant,
  practice: InvoicePractice,
  download: (
    bucket: string,
    path: string,
    expectedSize: number,
  ) => Promise<Uint8Array>,
) {
  let report: string;
  let sourceByteBound = false;
  let originals: ReleaseBundle["release"]["snapshot"]["attachments"] = [];
  if (grant.family === "invoice")
    report = renderInvoiceDocument(
      (grant.source_bundle as { document: unknown }).document,
      practice,
    );
  else {
    const b = grant.source_bundle as ReleaseBundle;
    if (
      !b.eligible ||
      b.events.length ||
      b.release.id !== grant.source_id ||
      b.release.client_id !== grant.client_id ||
      b.release.channel !== "SMS" ||
      b.release.recipient !== grant.recipient ||
      b.release.source_hash !== grant.source_hash
    )
      throw new Error("Reviewed SMS release unavailable");
    originals = b.release.snapshot.attachments;
    sourceByteBound = [5, 6, 7].includes(b.release.snapshot.schema_version);
    report = renderRecordRelease({
      preview: b.release,
      confirmed: {
        id: b.release.id,
        created_at: b.release.created_at,
        created_by: b.release.created_by,
        eligible: true,
        events: [],
        ineligibility_reason: null,
      },
    });
  }
  // Both production renderers already embed a restrictive CSP. Keep it in the
  // downloaded file, add referrer protection, and fail closed on active markup.
  if (
    !report.includes(
      "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
    ) ||
    /<(?:script|iframe|object|embed|base|form|a|link|img)\b/i.test(report)
  )
    throw new Error("Report contains unsupported active content");
  report = report.replace(
    "<head>",
    '<head><meta name="referrer" content="no-referrer">',
  );
  if (originals.length > 24) throw new Error("Document limit exceeded");
  const bytes = new TextEncoder().encode(report);
  let estimated = Math.ceil(bytes.length / 3) * 4 + 8192;
  for (const d of originals) {
    if (
      !Number.isSafeInteger(d.file_size) ||
      d.file_size < 1 ||
      d.file_size > 20971520
    )
      throw new Error("Original size invalid");
    estimated += Math.ceil(d.file_size / 3) * 4 + 1024;
  }
  if (estimated > 33554432) throw new Error("Encoded document limit exceeded");
  const artifacts: FrozenLinkArtifact[] = [
    {
      filename: `${grant.family}-${grant.source_id}.html`,
      mime_type: "text/html",
      document_id: null,
      content: base64Bytes(bytes),
    },
  ];
  for (const [index, d] of originals.entries()) {
    if (
      d.bucket !== "patient-documents" ||
      !d.file_path ||
      d.file_path.includes("..")
    )
      throw new Error("Private original unavailable");
    const original = await download(d.bucket, d.file_path, d.file_size);
    const matches =
      d.mime_type === "application/pdf"
        ? new TextDecoder().decode(original.subarray(0, 5)) === "%PDF-"
        : d.mime_type === "image/jpeg"
          ? [255, 216, 255].every((b, i) => original[i] === b)
          : d.mime_type === "image/png" &&
            [137, 80, 78, 71, 13, 10, 26, 10].every(
              (b, i) => original[i] === b,
            );
    if (original.length !== d.file_size || !matches)
      throw new Error("Original bytes differ");
    if (sourceByteBound && d.content_sha256 !== undefined && await sha256Hex(original) !== d.content_sha256)
      throw new Error("Original bytes differ from captured source provenance.");
    artifacts.push({
      filename: releaseAttachmentFilename(index + 1, d.file_name, d.mime_type),
      mime_type: d.mime_type,
      document_id: d.id,
      content: base64Bytes(original),
    });
  }
  const payload_text = JSON.stringify({ artifacts });
  const encoded = new TextEncoder().encode(payload_text);
  if (encoded.length > 33554432)
    throw new Error("Encoded document limit exceeded");
  return { payload_text, artifact_hash: await sha256Hex(encoded) };
}
