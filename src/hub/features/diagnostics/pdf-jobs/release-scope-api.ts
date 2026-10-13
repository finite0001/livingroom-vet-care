import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { diagnosticReleaseScopeSchema } from "./release-scope-model";
const uuid = z.string().uuid();
export async function readReleaseScope(
  job: string,
  pet: string,
  mode: "current" | "historical",
) {
  const args = z
    .object({
      p_job: uuid,
      p_pet: uuid,
      p_mode: z.enum(["current", "historical"]),
    })
    .strict()
    .parse({ p_job: job, p_pet: pet, p_mode: mode });
  const { data, error } = await supabase.rpc(
    "read_diagnostic_pdf_release_scope" as never,
    args as never,
  );
  if (error) throw error;
  const parsed = diagnosticReleaseScopeSchema.parse(data);
  if (parsed.job_id !== job || parsed.pet_id !== pet || parsed.mode !== mode)
    throw new Error("Diagnostic scope does not match this report");
  return parsed;
}
