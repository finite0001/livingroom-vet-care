import { FunctionsHttpError } from "@supabase/supabase-js";

export interface DeliveryResult {
  accepted?: boolean;
  queued?: boolean;
  success?: boolean;
  acceptance_unknown?: boolean;
  error?: string;
  note?: string;
}

export async function deliveryErrorNote(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError && error.context instanceof Response) {
    try {
      const result: DeliveryResult = await error.context.clone().json();
      if (result.accepted || result.acceptance_unknown) {
        return `${result.error || result.note || "Delivery status is uncertain."} The provider may have accepted this message. Check provider activity before retrying; your draft has been kept.`;
      }
      return result.error || result.note || "The request was rejected. Your draft has been kept.";
    } catch {
      // A non-JSON error provides no reliable delivery state.
    }
  }
  return "Unable to confirm the request outcome. Check provider activity before retrying; your draft has been kept.";
}

export function isDeliveryAccepted(result: DeliveryResult | null | undefined): boolean {
  if (!result || result.success === false || result.acceptance_unknown) return false;
  return result.accepted === true || result.queued === true;
}
