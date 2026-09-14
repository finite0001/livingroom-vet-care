import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { parseAttachmentParent, parseAttachmentObservations, parseAttachmentCleanups, parseAttachmentRuns } from "./attachment-discovery-state";
import type { AttachmentMapping, AttachmentOwner, AttachmentParent, AttachmentObservationCursor, AttachmentHistoryCursor } from "./attachment-discovery-state";
interface Database {
  public: {
    Tables: Record<never, never>; Views: Record<never, never>; Enums: Record<never, never>; CompositeTypes: Record<never, never>;
    Functions: { [key: string]: { Args: Record<string, unknown>; Returns: unknown } };
  };
}
const client = supabase as unknown as SupabaseClient<Database>;
async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error("Attachment history is unavailable. Keep the original request and recheck its saved state.");
  return data;
}
export async function getAttachmentAnimalParent(mapping: AttachmentMapping) {
  const parent = parseAttachmentParent(await rpc("get_ezyvet_attachment_animal_parent", { p_animal_link_id: mapping.link_id }), mapping);
  if (parent && (parent.parent_type !== "Animal" || parent.parent_external_id !== mapping.external_id)) throw new Error("Attachment animal parent differs from the selected mapping.");
  return parent;
}
export async function listAttachmentRuns(actor: string, mapping: AttachmentMapping, cursor: AttachmentHistoryCursor | null) {
  return parseAttachmentRuns(await rpc("list_ezyvet_attachment_runs", { p_animal_link_id: mapping.link_id, p_before_at: cursor?.before_at ?? null, p_before_id: cursor?.before_id ?? null, p_limit: 20 }), actor, mapping);
}
export async function listAttachmentObservations(runId: string, mapping: AttachmentMapping, parent: AttachmentParent, cursor: AttachmentObservationCursor | null) {
  return parseAttachmentObservations(await rpc("list_ezyvet_attachment_observations", { p_run_id: runId, p_pet_id: mapping.pet_id, p_after_page: cursor?.after_page ?? null, p_after_snapshot_id: cursor?.after_snapshot_id ?? null, p_limit: 10 }), runId, mapping, parent);
}
export async function listAttachmentCleanups(owner: AttachmentOwner, cursor: AttachmentHistoryCursor | null) {
  return parseAttachmentCleanups(await rpc("list_ezyvet_attachment_cleanups", { p_id: owner.id, p_pet_id: owner.pet, p_before_at: cursor?.before_at ?? null, p_before_id: cursor?.before_id ?? null, p_limit: 20 }), owner);
}
