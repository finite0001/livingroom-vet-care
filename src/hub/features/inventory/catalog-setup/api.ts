import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import {
  configureSourceSchema,
  linkSourceSchema,
  sourceItemSchema,
  type ConfigureSource,
} from "./model";

interface CatalogSetupRpc {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}
// Additive RPCs are runtime-validated; generated database types remain untouched.
async function call(name: string, args: Record<string, unknown>) {
  const { data, error } = await (supabase as unknown as CatalogSetupRpc).rpc(
    name,
    args,
  );
  if (error) throw error;
  return data;
}
export async function searchSourceItems(search: string) {
  return z.array(sourceItemSchema).parse(
    await call("search_catalog_source_items", {
      p_search: z.string().max(200).parse(search),
    }),
  );
}
export async function configureSourceItem(request: ConfigureSource) {
  const args = configureSourceSchema.parse(request);
  const product = z
    .object({ id: z.string().guid(), name: z.string() })
    .parse(await call("configure_catalog_source_item", args));
  if (product.id !== args.p_id || product.name !== args.p_name)
    throw new Error(
      "Catalog response differs. Reload and check the source row before continuing.",
    );
  return product;
}
export async function linkSourceProduct(
  actor: string,
  source: string,
  product: string,
) {
  await call(
    "link_catalog_source_product",
    linkSourceSchema.parse({
      p_actor_id: actor,
      p_source_id: source,
      p_product_id: product,
    }),
  );
}
