import { supabase } from "@/integrations/supabase/client";
import type { DeliveryIntent } from "./PaymentDeliveryState";
export const deliveryDb = supabase;
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
