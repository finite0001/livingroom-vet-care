import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type {
  InvoiceEmailArgs,
  InvoiceEmailPreparation,
} from "./invoice-email-state";
export interface InvoiceEmailPreview {
  document: unknown;
  source_hash: string;
  client_id: string;
  recipient: string;
}
interface InvoiceEmailDatabase {
  public: {
    Tables: Record<never, never>;
    Views: Record<never, never>;
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
    Functions: {
      read_invoice_email_preview: {
        Args: { p_invoice_id: string; p_client_id: string };
        Returns: InvoiceEmailPreview;
      };
      recover_invoice_email: {
        Args: { p_invoice_id: string; p_request_id?: string };
        Returns: InvoiceEmailPreparation | null;
      };
      enqueue_invoice_email: {
        Args: {
          p_request_id: string;
          p_reviewed_payload_hash: string;
          p_attest: boolean;
        };
        Returns: unknown;
      };
      abandon_invoice_email: {
        Args: { p_request_id: string };
        Returns: undefined;
      };
    };
  };
}
export const invoiceEmailDb =
  supabase as unknown as SupabaseClient<InvoiceEmailDatabase>;
export async function captureInvoiceEmail(args: InvoiceEmailArgs) {
  return supabase.functions.invoke<InvoiceEmailPreparation>(
    "prepare-invoice-email",
    { body: args },
  );
}
