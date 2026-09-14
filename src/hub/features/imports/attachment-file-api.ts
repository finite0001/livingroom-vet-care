import { parseAttachmentCleanupHistory, type AttachmentCleanupCursor } from "./attachment-cleanup-state";
import { parsePreparedAttachmentRun } from "./attachment-discovery-state";
import type { AttachmentMapping, AttachmentHistoryCursor } from "./attachment-discovery-state";
import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseAttachmentFileRecovery, AttachmentFileActionError, parseAttachmentFileHistory } from "./attachment-file-state";
import type { AttachmentFileIntent } from "./attachment-file-state";
interface Database { public: { Tables: Record<never, never>; Views: Record<never, never>; Enums: Record<never, never>; CompositeTypes: Record<never, never>; Functions: { [key: string]: { Args: Record<string, unknown>; Returns: unknown } }; }; }
const client = supabase as unknown as SupabaseClient<Database>;
async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new AttachmentFileActionError("File request is unconfirmed. Recover the original request before continuing.");
  return data;
}
export async function prepareAttachmentFile(intent: AttachmentFileIntent) {
  return parseAttachmentFileRecovery(await rpc("prepare_ezyvet_attachment_download", { p_id: intent.id, p_pet_id: intent.pet, p_run_id: intent.runId, p_page: intent.page, p_snapshot_id: intent.snapshotId, p_payload_hash: intent.payloadHash, p_observed_head_version: intent.headVersion }), intent);
}
export async function recoverAttachmentFile(intent: AttachmentFileIntent) {
  const value = await rpc("recover_ezyvet_attachment_download", { p_id: intent.id, p_pet_id: intent.pet });
  return value === null ? null : parseAttachmentFileRecovery(value, intent);
}
export async function captureAttachmentFile(intent: AttachmentFileIntent) {
  if (!intent.requestHash) throw new AttachmentFileActionError("Recover the saved file request before capture.");
  const { data, error } = await supabase.functions.invoke("ezyvet-attachment-capture", { body: { request_id: intent.id, pet_id: intent.pet, request_hash: intent.requestHash } });
  if (error) {
    let code: unknown;
    if ("context" in error && error.context instanceof Response) { try { code = (await error.context.json())?.error; } catch { /* Never display raw provider text. */ } }
    if (code === "CAPTURE_DISABLED" || code === "IMPORT_DISABLED") throw new AttachmentFileActionError("Private file capture is not commissioned. An administrator must finish server setup.");
    throw new AttachmentFileActionError("Capture response was unconfirmed. Recover this file request before trying again.");
  }
  if (!data || data.request_id !== intent.id) throw new AttachmentFileActionError("Capture response was unconfirmed. Recover this file request before trying again.");
}
export async function listAttachmentFileHistory(actor: string, mapping: AttachmentMapping, cursor: AttachmentHistoryCursor | null) {
  return parseAttachmentFileHistory(await rpc("list_ezyvet_attachment_downloads", { p_pet_id: mapping.pet_id, p_before_at: cursor?.before_at ?? null, p_before_id: cursor?.before_id ?? null, p_limit: 20 }), actor, mapping);
}
export async function recoverAttachmentFileScan(intent: AttachmentFileIntent, mapping: AttachmentMapping) {
  const value = await rpc("recover_ezyvet_attachment_run", { p_id: intent.runId, p_animal_link_id: mapping.link_id });
  return parsePreparedAttachmentRun(value, intent.runId, intent.actor, mapping, intent.parent);
}

export async function abandonAttachmentFile(intent: AttachmentFileIntent) {
  return parseAttachmentFileRecovery(await rpc("abandon_ezyvet_attachment_download", { p_id: intent.id, p_pet_id: intent.pet, p_confirmed: true }), intent);
}

export async function listAttachmentCleanupHistory(intent: AttachmentFileIntent, cursor: AttachmentCleanupCursor | null) {
  return parseAttachmentCleanupHistory(await rpc("list_ezyvet_attachment_cleanups", { p_id: intent.id, p_pet_id: intent.pet, p_before_at: cursor?.before_at ?? null, p_before_id: cursor?.before_id ?? null, p_limit: 20 }), intent);
}
