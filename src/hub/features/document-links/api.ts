import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { DocumentFamily, LinkPreparation } from "./state";
interface LinkDatabase {
  public: {
    Tables: Record<never, never>;
    Views: Record<never, never>;
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
    Functions: {
      preview_document_link: {
        Args: {
          p_family: DocumentFamily;
          p_source_id: string;
          p_client_id: string;
        };
        Returns: { recipient: string; source_hash: string };
      };
      recover_document_link: {
        Args: {
          p_family: DocumentFamily;
          p_source_id: string;
          p_request_id?: string;
        };
        Returns: LinkPreparation | null;
      };
      attest_document_link: {
        Args: {
          p_request_id: string;
          p_reviewed_artifact_hash: string;
          p_reviewed_message_hash: string;
          p_attest: boolean;
        };
        Returns: unknown;
      };
      enqueue_document_link_sms: {
        Args: {
          p_request_id: string;
          p_reviewed_artifact_hash: string;
          p_reviewed_message_hash: string;
          p_attest: boolean;
        };
        Returns: unknown;
      };
      revoke_document_link: {
        Args: { p_request_id: string; p_reason: string };
        Returns: unknown;
      };
      read_document_link_artifact: {
        Args: { p_request_id: string; p_index: number };
        Returns: unknown;
      };
    };
  };
}
export const linkDb = supabase as unknown as SupabaseClient<LinkDatabase>;
