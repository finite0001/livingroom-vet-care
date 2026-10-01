import type { Tables } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";
import { parseVaccineStatusSummary } from "./vaccine-status";

/** labeled_duration is narrowed by the catalog_vaccine_profiles CHECK constraint. */
export interface CatalogVaccineProfile
  extends Omit<Tables<"catalog_vaccine_profiles">, "labeled_duration"> {
  labeled_duration: "1 year" | "3 years" | "other licensed duration" | null;
}
export interface SaveVaccineProfileArgs {
  p_product_id: string;
  p_expected_version: number | null;
  p_group_key: string | null;
  p_species: string[];
  p_vaccine_type: string | null;
  p_labeled_duration: string | null;
  p_default_booster_interval_days: number | null;
  p_review_note: string;
}
const vaccines = supabase;

export async function readVaccineStatus(petId: string) {
  const { data, error } = await vaccines.rpc("patient_vaccine_status_summary", {
    p_pet_id: petId,
  });
  if (error) throw error;
  return parseVaccineStatusSummary(data, petId);
}

export async function readVaccineProfiles(
  productIds: readonly string[],
): Promise<CatalogVaccineProfile[]> {
  const ids = [...new Set(productIds)].slice(0, 200);
  if (!ids.length) return [];
  const { data, error } = await vaccines
    .from("catalog_vaccine_profiles")
    .select("*")
    .in("product_id", ids);
  if (error) throw error;
  return (data ?? []) as CatalogVaccineProfile[];
}

export async function saveVaccineProfile(args: SaveVaccineProfileArgs) {
  const { data, error } = await vaccines.rpc(
    "save_catalog_vaccine_profile",
    args,
  );
  if (error) throw error;
  return data;
}
