import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
interface CollectionDatabase {
  public: {
    Tables: Record<never, never>;
    Views: Record<never, never>;
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
    Functions: {
      list_payment_collections: {
        Args: { p_invoice_id: string; p_client_id: string };
        Returns: unknown;
      };
      attest_payment_collection: {
        Args: {
          p_request_id: string;
          p_reviewed_context_hash: string;
          p_attest: boolean;
        };
        Returns: unknown;
      };
      revoke_payment_collection: {
        Args: { p_request_id: string; p_reason: string };
        Returns: unknown;
      };
    };
  };
}
export const collectionDb =
  supabase as unknown as SupabaseClient<CollectionDatabase>;
