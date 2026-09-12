import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type {
  CertificateEvent,
  CertificateSnapshot,
  IssuedCertificate,
} from "./print";
export interface CertificateRow extends IssuedCertificate {
  pet_id: string;
  kind: "vaccine_history" | "rabies";
  issued_by: string;
}
export interface CertificateBundle {
  certificate: CertificateRow;
  events: CertificateEvent[];
}
export interface Issuer {
  user_id: string;
  full_name: string;
  license_number: string;
  license_state: string;
  license_expires_on: string;
  active: boolean;
  verified_at: string;
  clinical_acceptance_at: string;
}
export interface PreviewArgs {
  p_pet_id: string;
  p_kind: "vaccine_history" | "rabies";
  p_rabies_treatment_id: string | null;
  p_details: CertificateSnapshot["details"];
}
export interface IssueArgs extends PreviewArgs {
  p_id: string;
  p_reviewed_snapshot: CertificateSnapshot;
  p_signature_name: string;
  p_attest_review: boolean;
  p_replaces_id: string | null;
  p_reason: string | null;
}
interface Table<Row> {
  Row: { [K in keyof Row]: Row[K] };
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
}
interface CertificateDatabase {
  public: {
    Tables: {
      vaccine_certificates: Table<CertificateRow>;
      certificate_issuers: Table<Issuer>;
    };
    Views: Record<never, never>;
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
    Functions: {
      preview_vaccine_certificate: {
        Args: { [K in keyof PreviewArgs]: PreviewArgs[K] };
        Returns: CertificateSnapshot;
      };
      issue_vaccine_certificate: {
        Args: { [K in keyof IssueArgs]: IssueArgs[K] };
        Returns: CertificateRow;
      };
      read_vaccine_certificate: {
        Args: { p_id: string };
        Returns: CertificateBundle;
      };
      void_vaccine_certificate: {
        Args: { p_id: string; p_certificate_id: string; p_reason: string };
        Returns: CertificateEvent;
      };
    };
  };
}
export const certificates =
  supabase as unknown as SupabaseClient<CertificateDatabase>;
export async function readCertificate(id: string) {
  const { data, error } = await certificates.rpc("read_vaccine_certificate", {
    p_id: id,
  });
  if (error) throw error;
  if (!data) throw new Error("Certificate not found.");
  return data;
}
export const attestations = {
  rabies:
    "I reviewed this complete certificate and its due date, confirm this was a rabies vaccine administered by me or under my supervision by the named administrator trained in vaccine storage, handling, administration and adverse-event management, and explicitly sign this certificate.",
  vaccine_history:
    "I reviewed the patient identity, all included vaccine records and their recorded due dates, and explicitly sign this vaccine history certificate. This is not a rabies certificate or an automatically calculated schedule.",
} as const;
