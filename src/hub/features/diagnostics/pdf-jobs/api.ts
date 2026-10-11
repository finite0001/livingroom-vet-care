import { supabase } from "@/integrations/supabase/client";
import { z } from "zod";
import {
  pdfJobDetailSchema,
  pdfRequestSchema,
  pdfRetrySchema,
} from "./model.ts";
interface PdfJobDatabase {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}
const db = supabase as unknown as PdfJobDatabase;
async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw error;
  return data;
}
function bound(data: unknown, id: string, pet: string) {
  const result = pdfJobDetailSchema.parse(data);
  if (result.job.id !== id || result.job.pet_id !== pet)
    throw new Error("PDF job response belongs to another patient/version");
  return result;
}
export async function readPdfJob(id: string, pet: string) {
  z.string().uuid().parse(id);
  z.string().uuid().parse(pet);
  const data = await rpc("read_diagnostic_pdf_job", {
    p_id: id,
    p_pet_id: pet,
  });
  return data === null ? null : bound(data, id, pet);
}
export async function requestPdfJob(input: unknown) {
  const a = pdfRequestSchema.parse(input);
  return bound(
    await rpc("request_diagnostic_pdf_job", {
      p_action_id: a.action_id,
      p_id: a.id,
      p_pet_id: a.pet_id,
      p_source_hash: a.source_hash,
    }),
    a.id,
    a.pet_id,
  );
}
export async function retryPdfJob(input: unknown) {
  const a = pdfRetrySchema.parse(input);
  return bound(
    await rpc("retry_diagnostic_pdf_job", {
      p_action_id: a.action_id,
      p_id: a.id,
      p_pet_id: a.pet_id,
      p_expected_version: a.expected_version,
      p_reason: a.reason,
    }),
    a.id,
    a.pet_id,
  );
}
