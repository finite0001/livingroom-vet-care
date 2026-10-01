import type { Database, Json } from "@/integrations/supabase/types";
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
  request: Json;
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
export interface QolScaleAssessment {
  id: string;
  pet_id: string;
  scale_version: string;
  assessed_at: string;
  assessor: string;
  hurt: number | null;
  hunger: number | null;
  hydration: number | null;
  hygiene: number | null;
  happiness: number | null;
  mobility: number | null;
  more_good_days: number | null;
  hurt_note: string;
  hunger_note: string;
  hydration_note: string;
  hygiene_note: string;
  happiness_note: string;
  mobility_note: string;
  more_good_days_note: string;
  notes: string;
  total: number | null;
  status: string;
  version: number;
  created_by: string;
  created_at: string;
  updated_by: string;
  updated_at: string;
  signed_by: string | null;
  signed_at: string | null;
}
export interface QolScaleAddendum {
  id: string;
  assessment_id: string;
  content: string;
  created_by: string;
  created_at: string;
}
export interface QolScaleReference {
  id: string;
  enabled: boolean;
  reference_total: number | null;
  reference_label: string;
  review_note: string;
  version: number;
  updated_by: string | null;
  updated_at: string;
}
export interface QolScaleArgs {
  p_id: string;
  p_pet_id: string;
  p_expected_version: number | null;
  p_assessed_at: string;
  p_assessor: string;
  p_hurt: number | null;
  p_hunger: number | null;
  p_hydration: number | null;
  p_hygiene: number | null;
  p_happiness: number | null;
  p_mobility: number | null;
  p_more_good_days: number | null;
  p_hurt_note: string;
  p_hunger_note: string;
  p_hydration_note: string;
  p_hygiene_note: string;
  p_happiness_note: string;
  p_mobility_note: string;
  p_more_good_days_note: string;
  p_notes: string;
}
export interface QolReferenceArgs {
  p_expected_version: number;
  p_enabled: boolean;
  p_reference_total: number | null;
  p_reference_label: string;
  p_review_note: string;
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
export const care = supabase;
export type CareMutation =
  | "save_patient_qol"
  | "sign_patient_qol"
  | "add_patient_qol_addendum"
  | "record_lesion_observation"
  | "correct_lesion_observation"
  | "save_patient_qol_scale"
  | "sign_patient_qol_scale"
  | "add_patient_qol_scale_addendum"
  | "save_qol_scale_reference";
export type CareArgs = Database["public"]["Functions"][CareMutation]["Args"];
