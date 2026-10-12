import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { verifiedDiagnosticPdfResponse } from "../../../../../supabase/functions/_shared/diagnostic-pdf-bytes.ts";
const uuid = z.string().uuid(),
  hash = z.string().regex(/^[a-f0-9]{64}$/);
export const pdfReviewSchema = z
  .object({
    job_id: uuid,
    pet_id: uuid,
    version: z.number().int().positive(),
    reviewed_at: z.string().datetime({ offset: true }),
    historical: z.boolean(),
    state: z.enum([
      "off",
      "waiting",
      "preparing",
      "failed",
      "stored_private",
      "unavailable",
    ]),
    last_error: z.enum([
      "",
      "ADMISSION_FAILED",
      "STORAGE_UNCERTAIN",
      "OBJECT_CHANGED",
      "CAPACITY_EXCEEDED",
    ]),
    download_available: z.boolean(),
    sha256: hash.nullable(),
    byte_length: z.number().int().min(1).max(3145728).nullable(),
    export_eligible: z.literal(false),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      (v.sha256 === null) !== (v.byte_length === null) ||
      (v.download_available &&
        (v.state !== "stored_private" || v.sha256 === null))
    )
      ctx.addIssue({
        code: "custom",
        message: "PDF review availability differs",
      });
  });
export interface PdfReview extends z.infer<typeof pdfReviewSchema> {}
interface ReviewDatabase {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}
export async function readPdfReview(job: string, pet: string) {
  uuid.parse(job);
  uuid.parse(pet);
  const { data, error } = await (supabase as unknown as ReviewDatabase).rpc(
    "read_diagnostic_pdf_review",
    { p_job: job, p_pet: pet },
  );
  if (error) throw error;
  if (data === null) return null;
  const review = pdfReviewSchema.parse(data);
  if (review.job_id !== job || review.pet_id !== pet)
    throw new Error("PDF review belongs to another report");
  return review;
}
export async function downloadPdf(review: PdfReview, actor: string) {
  const checked = pdfReviewSchema.parse(review);
  uuid.parse(actor);
  if (
    !checked.download_available ||
    checked.sha256 === null ||
    checked.byte_length === null
  )
    throw new Error("PDF download unavailable");
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session || data.session.user.id !== actor)
    throw new Error("Staff sign-in changed");
  const origin = new URL(import.meta.env.VITE_SUPABASE_URL);
  if (
    origin.search ||
    origin.hash ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/"
  )
    throw new Error("Practice backend unavailable");
  const response = await fetch(
    new URL("/functions/v1/download-diagnostic-pdf", origin),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${data.session.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: crypto.randomUUID(),
        job_id: checked.job_id,
        pet_id: checked.pet_id,
      }),
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(15000),
    },
  );
  const bytes = await verifiedDiagnosticPdfResponse(
    response,
    checked.byte_length,
    checked.sha256,
  );
  const current = await supabase.auth.getSession();
  if (current.error) throw current.error;
  if (current.data.session?.user.id !== actor)
    throw new Error("Staff sign-in changed during download");
  return new Blob([bytes], { type: "application/pdf" });
}
