import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { DeliveryIntent } from "./PaymentDeliveryState";
interface DeliveryDatabase {
  public: {
    Tables: Record<never, never>;
    Views: Record<never, never>;
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
    Functions: {
      list_payment_deliveries: {
        Args: { p_invoice_id: string; p_grant_id?: string };
        Returns: unknown;
      };
      enqueue_payment_delivery: {
        Args: {
          p_request_id: string;
          p_reviewed_message_hash: string;
          p_reviewed_payload_hash: string;
          p_attest: boolean;
        };
        Returns: unknown;
      };
    };
  };
}
export const deliveryDb =
  supabase as unknown as SupabaseClient<DeliveryDatabase>;
export async function paymentDeliveryAction(
  action: "prepare" | "recover" | "review",
  args: DeliveryIntent | { p_request_id: string },
) {
  const { data, error } = await supabase.functions.invoke(
    "prepare-payment-delivery",
    { body: { action, ...args } },
  );
  if (error) throw error;
  return data as unknown;
}
