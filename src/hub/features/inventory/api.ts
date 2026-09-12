import { supabase } from "@/integrations/supabase/client";
import type { Database, Tables } from "@/integrations/supabase/types";
export type Product = Tables<"catalog_products">;
export interface LotBalance {
  id: string;
  product_id: string;
  product_name: string;
  kind: string;
  unit: string;
  active: boolean;
  lot_number: string;
  expires_on: string;
  location: string;
  balance: number;
}
export type InventoryMutation =
  | "create_inventory_product"
  | "save_catalog_product"
  | "receive_inventory"
  | "adjust_inventory"
  | "record_patient_treatment"
  | "correct_patient_treatment";
export type InventoryMutationArgs =
  Database["public"]["Functions"][InventoryMutation]["Args"];
export async function products(search: string): Promise<Product[]> {
  const { data, error } = await supabase.rpc("search_inventory_products", {
    p_search: search,
    p_limit: 101,
  });
  if (error) throw error;
  return data;
}
export async function lots(
  search: string,
  productId?: string,
): Promise<LotBalance[]> {
  const { data, error } = await supabase.rpc("inventory_lot_balances", {
    p_search: search,
    p_product_id: productId ?? null,
    p_limit: 101,
  });
  if (error) throw error;
  return data;
}
export async function mutateInventory(
  name: InventoryMutation,
  args: InventoryMutationArgs,
): Promise<unknown> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data;
}
