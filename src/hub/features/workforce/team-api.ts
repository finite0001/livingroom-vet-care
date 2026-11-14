import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { teamSchema, teamCommandSchema } from "./team-model";
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
export async function readTeam() {
  return teamSchema.parse(await call("team_read", {}));
}
export async function teamCommand(
  action: string,
  data: unknown,
  id: string = crypto.randomUUID(),
) {
  const input = teamCommandSchema.safeParse({ action, data });
  if (!input.success)
    throw new Error(input.error.issues.map((i) => i.message).join("; "));
  const receipt = z.object({ action: z.string(), id: z.string().uuid() }).parse(
    await call("team_command", {
      p_action: action,
      p_id: z.string().uuid().parse(id),
      p_data: input.data.data,
    }),
  );
  if (receipt.action !== action || receipt.id !== id)
    throw new Error("Please refresh before retrying this action.");
}
