import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type {
  ReleaseSelection as SharedReleaseSelection,
  ReleasePreview,
  ReleaseRow,
  ReleaseBundle,
  ReleaseEvent,
} from "./print";
export { sourceLabels, type SourceKind } from "./selection";
export interface ReleaseSelection extends SharedReleaseSelection {
  api_original_ids?: string[];
  imported_prescription_ids?: string[];
  lab_report_ids?: string[];
  external_record_ids?: string[];
}
export interface ReleaseCandidate {
  id: string;
  version: number;
  recorded_at: string;
  label: string;
  importance?: string;
  version_hash?: string;
  completeness?: "complete" | "partial";
  partial_disclosure?: string | null;
  required_document_id?: string | null;
  required_document_version?: number;
  kind?: "original" | "corrected" | "replacement";
  historical?: boolean;
  source_label?: string;
  acknowledgment_count?: number;
  required_lab_report_ids?: string[];
  required_external_record_ids?: string[];
  file_size?: number;
  mime_type?: string;
  capture_hash?: string;
  content_sha256?: string;
  historical_source?: boolean;
}
export interface ReleaseCandidates {
  pet_id: string;
  client_id: string;
  client_name: string;
  email: string | null;
  phone: string | null;
  policy_accepted: boolean;
  policy_v4_accepted?: boolean;
  policy_v9_accepted: boolean;
  has_more: Record<import("./selection").SourceKind, boolean>;
  api_original_ids: ReleaseCandidate[];
  imported_history_ids: ReleaseCandidate[];
  imported_vaccination_ids: ReleaseCandidate[];
  imported_prescription_ids: ReleaseCandidate[];
  lab_report_ids: ReleaseCandidate[];
  external_record_ids: ReleaseCandidate[];
  problem_ids: ReleaseCandidate[];
  patient_summary_ids: ReleaseCandidate[];
  weight_ids: ReleaseCandidate[];
  treatment_ids: ReleaseCandidate[];
  encounter_ids: ReleaseCandidate[];
  certificate_ids: ReleaseCandidate[];
  lab_order_ids: ReleaseCandidate[];
  document_ids: ReleaseCandidate[];
  dental_ids: ReleaseCandidate[];
  qol_ids: ReleaseCandidate[];
  anesthesia_ids: ReleaseCandidate[];
  lesion_ids: ReleaseCandidate[];
}
export interface ReleasePreviewArgs {
  p_pet_id: string;
  p_client_id: string;
  p_channel: "EMAIL" | "SMS";
  p_recipient: string;
  p_selection: ReleaseSelection;
}
export interface ReleaseConfirmArgs extends ReleasePreviewArgs {
  p_id: string;
  p_reviewed_snapshot: ReleasePreview["snapshot"];
  p_reviewed_hash: string;
  p_attest_review: boolean;
}
interface Table<Row> {
  Row: { [K in keyof Row]: Row[K] };
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
}
interface ReleaseDatabase {
  public: {
    Tables: { record_releases: Table<ReleaseRow> };
    Views: Record<never, never>;
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
    Functions: {
      select_all_record_release_sources_v9: {
        Args: { p_pet_id: string };
        Returns: {
          selection: ReleaseSelection;
          excluded_unavailable_originals: number;
          excluded_labs_without_shareable_original: number;
          scope: string;
        };
      };
      list_record_release_sources_v9: {
        Args: { p_pet_id: string; p_offset: number };
        Returns: ReleaseCandidates;
      };
      preview_record_release_v9: {
        Args: { [K in keyof ReleasePreviewArgs]: ReleasePreviewArgs[K] };
        Returns: ReleasePreview;
      };
      confirm_record_release: {
        Args: { [K in keyof ReleaseConfirmArgs]: ReleaseConfirmArgs[K] };
        Returns: ReleaseRow;
      };
      read_record_release: { Args: { p_id: string }; Returns: ReleaseBundle };
      withdraw_record_release: {
        Args: { p_id: string; p_release_id: string; p_reason: string };
        Returns: ReleaseEvent;
      };
    };
  };
}
export const releases = supabase as unknown as SupabaseClient<ReleaseDatabase>;
export async function readRelease(id: string) {
  const { data, error } = await releases.rpc("read_record_release", {
    p_id: id,
  });
  if (error) throw error;
  if (!data) throw new Error("Release package not found.");
  return data;
}
