import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import {
  peopleSchema,
  peopleCommandSchema,
  payrollSchema,
} from "./people-model";
interface RpcClient {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}
async function call(name: string, args: Record<string, unknown>) {
  const { data, error } = await (supabase as unknown as RpcClient).rpc(
    name,
    args,
  );
  if (error) throw new Error(error.message);
  return data;
}
export async function readPeople() {
  return peopleSchema.parse(await call("people_read", {}));
}
export async function peopleCommand(
  action: string,
  data: unknown,
  id: string = crypto.randomUUID(),
) {
  const input = peopleCommandSchema.safeParse({ action, data });
  if (!input.success)
    throw new Error(input.error.issues.map((i) => i.message).join("; "));
  const receipt = z
    .object({
      action: z.string(),
      id: z.string().uuid(),
      snapshot: payrollSchema.optional(),
    })
    .parse(
      await call("people_command", {
        p_action: action,
        p_id: z.string().uuid().parse(id),
        p_data: input.data.data,
      }),
    );
  if (receipt.action !== action || receipt.id !== id)
    throw new Error("Please refresh before retrying this action.");
  return receipt;
}
export async function uploadBenefit(path: string, file: File) {
  if (
    file.type !== "application/pdf" ||
    file.size > 10 * 1024 * 1024 ||
    file.size === 0
  )
    throw new Error("Choose a PDF up to 10 MB.");
  const { error } = await supabase.storage
    .from("staff-benefits")
    .upload(path, file, { upsert: false, contentType: "application/pdf" });
  if (error) throw error;
}
export async function benefitDownload(path: string) {
  const { data, error } = await supabase.storage
    .from("staff-benefits")
    .createSignedUrl(path, 60);
  if (error) throw error;
  return data.signedUrl;
}
