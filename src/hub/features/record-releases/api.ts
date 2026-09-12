import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type {
  ReleaseSelection,
  ReleasePreview,
  ReleaseRow,
  ReleaseBundle,
  ReleaseEvent,
} from "./print";
export { sourceLabels, type SourceKind } from "./selection";
export interface ReleaseCandidate {
  id: string;
  version: number;
  recorded_at: string;
  label: string;
  required_document_id?: string | null;
  file_size?: number;
  mime_type?: string;
}
export interface ReleaseCandidates {
  pet_id: string;
  client_id: string;
  client_name: string;
  email: string | null;
  phone: string | null;
  policy_accepted: boolean;
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
      list_record_release_sources: {
        Args: { p_pet_id: string; p_offset: number };
        Returns: ReleaseCandidates;
      };
      preview_record_release: {
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
