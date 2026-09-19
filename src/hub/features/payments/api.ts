import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
interface PaymentDatabase {
  public: {
    Tables: {
      payment_provider_profiles: {
        Row: { account_id: string; livemode: boolean; return_origin: string };
        Insert: Record<never, never>;
        Update: Record<never, never>;
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
    Functions: {
      read_invoice_payment_state: {
        Args: { p_invoice_id: string; p_client_id: string };
        Returns: unknown;
      };
      prepare_invoice_checkout: {
        Args: {
          p_request_id: string;
          p_invoice_id: string;
          p_client_id: string;
          p_source_hash: string;
          p_amount_cents: number;
          p_account_id: string;
          p_livemode: boolean;
          p_success_url: string;
          p_cancel_url: string;
        };
        Returns: unknown;
      };
      prepare_invoice_refund: {
        Args: {
          p_request_id: string;
          p_invoice_id: string;
          p_payment_id: string;
          p_amount_cents: number;
          p_reason: string;
        };
        Returns: unknown;
      };
    };
  };
}
export const paymentDb = supabase as unknown as SupabaseClient<PaymentDatabase>;
