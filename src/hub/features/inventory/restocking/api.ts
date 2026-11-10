import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { restockSchema, settingSchema } from "./model";
interface AdditiveRpc {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}
export async function stockContextRpc(
  name: string,
  args: Record<string, unknown>,
) {
  const { data, error } = await (supabase as unknown as AdditiveRpc).rpc(
    name,
    args,
  );
  if (error) throw error;
  return data;
}
export async function readRestockAlerts() {
  return restockSchema.parse(
    await stockContextRpc("read_inventory_restock_alerts", {}),
  );
}
export async function saveRestockSetting(input: z.infer<typeof settingSchema>) {
  const args = settingSchema.parse(input);
  const result = z
    .object({
      id: z.string().guid(),
      threshold: z.number().nullable(),
      version: z.number().int(),
    })
    .parse(await stockContextRpc("save_inventory_restock_setting", args));
  if (
    result.id !== args.p_product_id ||
    result.threshold !== args.p_threshold ||
    result.version !== args.p_expected_version + 1
  )
    throw new Error("Restocking response differs. Reload before continuing.");
}
