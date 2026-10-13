import { z } from "zod";
const uuid = z.string().uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const instant = z.string().datetime({ offset: true });
const embedded = z
  .object({
    id: uuid,
    panel_id: uuid,
    version: z.number().int().positive(),
    label: z.string().max(300),
    reviewed_at: instant,
    source_hash: hash,
  })
  .strict();
const binding = z
  .object({
    binding_version: z.literal(1),
    job_id: uuid,
    pet_id: uuid,
    panel_id: uuid,
    mode: z.enum(["current", "historical"]),
    version: z.number().int().positive(),
    label: z.string().max(300),
    reviewed_at: instant,
    source_hash: hash,
    snapshot_hash: hash,
    manifest_sha256: hash,
    sha256: hash,
    byte_length: z.number().int().min(1).max(3145728),
    embedded_versions: z.array(embedded).min(1).max(200),
    total_panels: z.number().int().positive(),
    bucket: z.literal("diagnostic-pdfs"),
    object_path: z
      .string()
      .min(1)
      .max(1000)
      .refine((p) => !p.includes("..") && !p.startsWith("/")),
    object_id: uuid,
    object_created_at: instant,
    object_updated_at: instant,
    object_version: z.string().min(1),
  })
  .strict();
export const diagnosticPdfReleaseRecordSchema = z
  .object({
    binding,
    binding_hash: hash,
    review_context: z
      .array(
        z
          .object({
            panel_id: uuid,
            head_id: uuid.nullable(),
            version: z.number().int().positive(),
          })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict()
  .superRefine((r, ctx) => {
    const b = r.binding;
    const main = b.embedded_versions.find((v) => v.id === b.job_id);
    const roots = b.embedded_versions.map((v) => v.panel_id);
    if (
      !main ||
      main.panel_id !== b.panel_id ||
      main.version !== b.version ||
      main.source_hash !== b.source_hash ||
      main.label !== b.label ||
      main.reviewed_at !== b.reviewed_at ||
      new Set(roots).size !== roots.length ||
      b.total_panels < roots.length ||
      r.review_context.length !== roots.length ||
      new Set(r.review_context.map((v) => v.panel_id)).size !== roots.length ||
      r.review_context.some((v) => !roots.includes(v.panel_id))
    )
      ctx.addIssue({
        code: "custom",
        message: "Diagnostic manifest census or review context differs",
      });
  });
export interface DiagnosticPdfReleaseRecord
  extends z.infer<typeof diagnosticPdfReleaseRecordSchema> {}
export interface DiagnosticPdfReference {
  job_id: string;
  mode: "current" | "historical";
  binding_hash: string;
}
export const diagnosticPdfAttachmentSchema = z
  .object({
    id: uuid,
    version: z.number().int().positive(),
    file_name: z.string(),
    file_path: z.string(),
    bucket: z.literal("diagnostic-pdfs"),
    mime_type: z.literal("application/pdf"),
    file_size: z.number().int().min(1).max(3145728),
    content_sha256: hash,
    document_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    category: z.literal("diagnostic_pdf"),
    diagnostic_pdf_ref: z
      .object({
        job_id: uuid,
        mode: z.enum(["current", "historical"]),
        binding_hash: hash,
      })
      .strict(),
  })
  .strict();
export interface DiagnosticPdfAttachment
  extends z.infer<typeof diagnosticPdfAttachmentSchema> {}
interface DiagnosticPackage {
  schema_version: number;
  patient: { id: string };
  diagnostic_pdfs?: DiagnosticPdfReleaseRecord[];
  selection?: {
    diagnostic_pdf_ids?: string[];
    diagnostic_pdf_historical_ids?: string[];
  };
  attachments: Array<{
    id: string;
    bucket: string;
    diagnostic_pdf_ref?: DiagnosticPdfReference;
  }>;
}
const same = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length &&
  [...a].sort().every((v, i) => v === [...b].sort()[i]);
function denverDate(value: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  return ["year", "month", "day"]
    .map((k) => parts.find((p) => p.type === k)!.value)
    .join("-");
}
export function validateDiagnosticPdfPackage(
  s: DiagnosticPackage,
): DiagnosticPdfReleaseRecord[] {
  const diagnosticAttachments = s.attachments.filter(
    (d) => d.bucket === "diagnostic-pdfs" || d.diagnostic_pdf_ref,
  );
  if (s.schema_version !== 14) {
    if (
      diagnosticAttachments.length ||
      s.diagnostic_pdfs?.length ||
      s.selection?.diagnostic_pdf_ids?.length ||
      s.selection?.diagnostic_pdf_historical_ids?.length
    )
      throw new Error("Diagnostic disclosure requires schema14");
    return [];
  }
  const records = z
    .array(diagnosticPdfReleaseRecordSchema)
    .min(1)
    .max(24)
    .parse(s.diagnostic_pdfs);
  const current = z.array(uuid).max(24).parse(s.selection?.diagnostic_pdf_ids);
  const historical = z
    .array(uuid)
    .max(24)
    .parse(s.selection?.diagnostic_pdf_historical_ids);
  const ids = records.map((r) => r.binding.job_id);
  if (
    s.attachments.length > 24 ||
    new Set(s.attachments.map((d) => d.id)).size !== s.attachments.length ||
    new Set(ids).size !== ids.length ||
    diagnosticAttachments.length !== records.length ||
    !same(
      current,
      records
        .filter((r) => r.binding.mode === "current")
        .map((r) => r.binding.job_id),
    ) ||
    !same(
      historical,
      records
        .filter((r) => r.binding.mode === "historical")
        .map((r) => r.binding.job_id),
    )
  )
    throw new Error("Diagnostic attachments differ from explicit selection");
  for (const r of records) {
    const b = r.binding;
    if (b.pet_id !== s.patient.id)
      throw new Error("Diagnostic PDF belongs to another patient");
    const d = diagnosticPdfAttachmentSchema.parse(
      s.attachments.find((d) => d.id === b.job_id),
    );
    if (
      d.file_name !== `diagnostic-${b.job_id}.pdf` ||
      d.version !== b.version ||
      d.file_path !== b.object_path ||
      d.file_size !== b.byte_length ||
      d.content_sha256 !== b.sha256 ||
      d.document_date !== denverDate(b.reviewed_at) ||
      d.diagnostic_pdf_ref.job_id !== b.job_id ||
      d.diagnostic_pdf_ref.mode !== b.mode ||
      d.diagnostic_pdf_ref.binding_hash !== r.binding_hash
    )
      throw new Error("Diagnostic attachment binding differs");
  }
  return records;
}
const escape = (v: unknown) =>
  String(v).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function renderDiagnosticPdfDisclosure(s: DiagnosticPackage): string {
  return validateDiagnosticPdfPackage(s)
    .map(
      ({ binding: b }) =>
        `<article><h2>Diagnostic PDF: ${escape(b.label)}</h2><p>${b.mode === "current" ? "Current reviewed selection" : "Explicit historical selection"} · Version ${b.version} · Reviewed ${escape(b.reviewed_at)}</p><p>This original PDF contains ${b.embedded_versions.length} reviewed panel(s), including the following history. Its bytes are unchanged.</p><ul>${b.embedded_versions.map((v) => `<li>${escape(v.label)} · Version ${v.version} · Reviewed ${escape(v.reviewed_at)} · Source ${escape(v.id)}</li>`).join("")}</ul>${b.total_panels > b.embedded_versions.length ? `<p>The source chart had ${b.total_panels} panels. This PDF contains the listed ${b.embedded_versions.length}; it does not contain the entire diagnostic chart.</p>` : ""}${b.embedded_versions.length > 1 ? "<p>Expanded diagnostic history requires explicit scope review.</p>" : ""}<p>Original byte fingerprint: ${escape(b.sha256)}</p></article>`,
    )
    .join("");
}
