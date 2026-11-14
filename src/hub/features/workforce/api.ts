import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { commandSchema, workforceSchema } from "./model";
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
export async function readWorkforce(from: string, until: string) {
  return workforceSchema.parse(
    await call("workforce_read", {
      p_from: z.iso.date().parse(from),
      p_until: z.iso.date().parse(until),
    }),
  );
}
export async function workforceCommand(
  action: string,
  data: unknown,
  id: string = crypto.randomUUID(),
) {
  const parsed = commandSchema.safeParse({ action, data });
  if (!parsed.success)
    throw new Error(parsed.error.issues.map((i) => i.message).join("; "));
  const receipt = z.object({ id: z.string().uuid(), action: z.string() }).parse(
    await call("workforce_command", {
      p_action: parsed.data.action,
      p_id: z.string().uuid().parse(id),
      p_data: parsed.data.data,
    }),
  );
  if (receipt.id !== id || receipt.action !== action)
    throw new Error(
      "The action could not be verified. Refresh before retrying.",
    );
}
export async function runWorkforceJobs() {
  return call("workforce_run_jobs", {});
}

export async function toggleWorkforceJobs(enabled: boolean) {
  return z.boolean().parse(
    await call("workforce_toggle_jobs", {
      p_enabled: z.boolean().parse(enabled),
    }),
  );
}
