import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
export interface LinkHistoryRow {
  id: string;
  created_at: string;
  expires_at: string;
  state: string;
  recipient: string;
  receipt_state: string | null;
}
export interface LinkPreview {
  recipient: string;
  source_hash: string;
}
const historySchema = z.array(
  z.object({
    id: z.string(),
    created_at: z.string(),
    expires_at: z.string(),
    state: z.string(),
    recipient: z.string(),
    receipt_state: z.string().nullable(),
  }),
);
const previewSchema = z.object({
  recipient: z.string(),
  source_hash: z.string(),
});
/** read_document_link_history returns jsonb; null when malformed. */
export function parseLinkHistory(value: unknown): LinkHistoryRow[] | null {
  const parsed = historySchema.safeParse(value);
  return parsed.success ? (parsed.data as LinkHistoryRow[]) : null;
}
/** preview_document_link returns jsonb; throws when malformed. */
export function parseLinkPreview(value: unknown): LinkPreview {
  const parsed = previewSchema.safeParse(value);
  if (!parsed.success)
    throw new Error("Document link recipient could not be verified.");
  return parsed.data as LinkPreview;
}
export const linkDb = supabase;
