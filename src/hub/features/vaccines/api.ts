import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { parseVaccineStatusSummary } from "./vaccine-status";

export interface CatalogVaccineProfile {
  id: string;
  product_id: string;
  group_key: string | null;
  species: string[];
  vaccine_type: string | null;
  labeled_duration: "1 year" | "3 years" | "other licensed duration" | null;
  default_booster_interval_days: number | null;
  review_note: string;
  version: number;
  updated_by: string;
  updated_at: string;
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
interface Table<Row> {
  Row: { [K in keyof Row]: Row[K] };
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
}
// Local typing until src/integrations/supabase/types.ts is regenerated from the migrated schema.
interface VaccineDatabase {
  public: {
    Tables: { catalog_vaccine_profiles: Table<CatalogVaccineProfile> };
    Views: Record<never, never>;
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
    Functions: {
      patient_vaccine_status_summary: {
        Args: { p_pet_id: string };
        Returns: unknown;
      };
      save_catalog_vaccine_profile: {
        Args: { [K in keyof SaveVaccineProfileArgs]: SaveVaccineProfileArgs[K] };
        Returns: CatalogVaccineProfile;
      };
    };
  };
}
const vaccines = supabase as unknown as SupabaseClient<VaccineDatabase>;

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
  return data ?? [];
}

export async function saveVaccineProfile(args: SaveVaccineProfileArgs) {
  const { data, error } = await vaccines.rpc(
    "save_catalog_vaccine_profile",
    args,
  );
  if (error) throw error;
  return data;
}
