import { z } from "zod";
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
const previewSchema = z.object({
  document: z.unknown(),
  source_hash: z.string(),
  client_id: z.string(),
  recipient: z.string(),
});
/** read_invoice_email_preview returns jsonb; null when absent or malformed. */
export function parseInvoiceEmailPreview(
  value: unknown,
): InvoiceEmailPreview | null {
  const parsed = previewSchema.safeParse(value);
  return parsed.success ? (parsed.data as InvoiceEmailPreview) : null;
}
export const invoiceEmailDb = supabase;
export async function captureInvoiceEmail(args: InvoiceEmailArgs) {
  return supabase.functions.invoke<InvoiceEmailPreparation>(
    "prepare-invoice-email",
    { body: args },
  );
}
