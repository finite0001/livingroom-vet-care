import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
export interface QolRecord {
  id: string;
  pet_id: string;
  template_version: string;
  observed_at: string;
  observer: string;
  appetite: string;
  drinking: string;
  mobility: string;
  comfort: string;
  social_engagement: string;
  good_days: string;
  notes: string;
  status: string;
  version: number;
  created_by: string;
  created_at: string;
  updated_by: string;
  updated_at: string;
  signed_by: string | null;
  signed_at: string | null;
}
export interface Lesion {
  id: string;
  pet_id: string;
  label: string;
  body_view: string;
  x: number;
  y: number;
  version: number;
  created_at: string;
  created_by: string;
  updated_at: string;
  updated_by: string;
}
export interface LesionObservation {
  id: string;
  lesion_id: string;
  observed_at: string;
  label: string;
  body_view: string;
  x: number;
  y: number;
  length_mm: number | null;
  width_mm: number | null;
  depth_mm: number | null;
  notes: string;
  photo_document_id: string | null;
  created_by: string;
  created_at: string;
  request: Record<string, unknown>;
}
export interface QolAddendum {
  id: string;
  qol_id: string;
  content: string;
  created_by: string;
  created_at: string;
}
export interface LesionCorrection {
  id: string;
  observation_id: string;
  reason: string;
  created_by: string;
  created_at: string;
}
interface Table<Row> {
  Row: { [K in keyof Row]: Row[K] };
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
}
export interface QolArgs {
  p_id: string;
  p_pet_id: string;
  p_expected_version: number | null;
  p_observed_at: string;
  p_observer: string;
  p_appetite: string;
  p_drinking: string;
  p_mobility: string;
  p_comfort: string;
  p_social_engagement: string;
  p_good_days: string;
  p_notes: string;
}
export interface LesionArgs {
  p_id: string;
  p_lesion_id: string;
  p_pet_id: string;
  p_expected_version: number | null;
  p_observed_at: string;
  p_label: string;
  p_body_view: string;
  p_x: number;
  p_y: number;
  p_length_mm: number | null;
  p_width_mm: number | null;
  p_depth_mm: number | null;
  p_notes: string;
  p_photo_document_id: string | null;
}
interface CareDatabase {
  public: {
    Tables: {
      patient_qol_records: Table<QolRecord>;
      patient_qol_addenda: Table<QolAddendum>;
      patient_lesions: Table<Lesion>;
      patient_lesion_observations: Table<LesionObservation>;
      patient_lesion_corrections: Table<LesionCorrection>;
    };
    Views: Record<never, never>;
    Functions: {
      save_patient_qol: {
        Args: { [K in keyof QolArgs]: QolArgs[K] };
        Returns: QolRecord;
      };
      sign_patient_qol: {
        Args: { p_id: string; p_expected_version: number };
        Returns: QolRecord;
      };
      add_patient_qol_addendum: {
        Args: { p_id: string; p_qol_id: string; p_content: string };
        Returns: QolAddendum;
      };
      record_lesion_observation: {
        Args: { [K in keyof LesionArgs]: LesionArgs[K] };
        Returns: LesionObservation;
      };
      correct_lesion_observation: {
        Args: { p_id: string; p_observation_id: string; p_reason: string };
        Returns: LesionCorrection;
      };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
}
// This module's exact schema contract keeps parallel migrations out of generated shared types.
export const care = supabase as unknown as SupabaseClient<CareDatabase>;
export type CareMutation = keyof CareDatabase["public"]["Functions"];
export type CareArgs =
  CareDatabase["public"]["Functions"][CareMutation]["Args"];
