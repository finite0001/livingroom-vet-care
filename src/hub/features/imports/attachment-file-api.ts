import { parseAttachmentChart, parseAttachmentChartOriginal } from "./attachment-chart-state";
import { parseAttachmentDecisionOutcome, type AttachmentDecision } from "./attachment-decision-state";
import { parseAttachmentReviewHistory, type AttachmentReviewCursor } from "./attachment-review-state";
import { verifyAttachmentOriginal, attachmentOriginalFilename } from "./attachment-original";
import { parseAttachmentCleanupRecovery, type AttachmentCleanupOperation } from "./attachment-cleanup-state";
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

export async function recoverAttachmentCleanup(op: AttachmentCleanupOperation) {
  return parseAttachmentCleanupRecovery(await rpc("recover_ezyvet_attachment_cleanup", { p_cleanup_id: op.id, p_id: op.request, p_pet_id: op.pet }), op);
}
export async function runAttachmentCleanup(op: AttachmentCleanupOperation) {
  const { error } = await supabase.functions.invoke("ezyvet-attachment-cleanup", { body: { cleanup_id: op.id, request_id: op.request, pet_id: op.pet, request_hash: op.requestHash } });
  if (error) {
    let code: unknown;
    if ("context" in error && error.context instanceof Response) { try { code = (await error.context.json())?.error; } catch { /* Do not display transport text. */ } }
    if (code === "CLEANUP_DISABLED") throw new AttachmentFileActionError("Temporary file cleanup is not commissioned. An administrator must finish server setup.");
    if (code === "CLEANUP_NOT_ELIGIBLE") throw new AttachmentFileActionError("Cleanup is not eligible yet. The server requires an abandoned reserved file and a grace period after capture workers finish.");
    throw new AttachmentFileActionError("Cleanup response was unconfirmed. Recover the original attempt before continuing.");
  }
}

export async function loadAttachmentOriginal(intent: AttachmentFileIntent) {
  const before = await recoverAttachmentFile(intent);
  if (!before?.captured || !before.original) throw new AttachmentFileActionError("Recover a captured private file before inspecting the original.");
  const { data, error } = await supabase.storage.from(before.original.bucket).download(before.original.object_path);
  if (error) throw new AttachmentFileActionError("The private original could not be read. Check your access and try again.");
  const blob = await verifyAttachmentOriginal(data, before.original);
  const after = await recoverAttachmentFile(intent);
  if (!after?.original || after.original.captureHash !== before.original.captureHash || after.original.intent_hash !== before.original.intent_hash) throw new AttachmentFileActionError("The captured file could not be reverified. No original is available for inspection.");
  return { blob, captureHash: after.original.captureHash, filename: attachmentOriginalFilename(intent.externalId, after.original.mime_type) };
}

export async function listAttachmentReviewHistory(intent: AttachmentFileIntent, cursor: AttachmentReviewCursor | null) {
  return parseAttachmentReviewHistory(await rpc("list_ezyvet_attachment_record_versions", { p_request_id: intent.id, p_pet_id: intent.pet, p_before_at: cursor?.before_at ?? null, p_before_id: cursor?.before_id ?? null, p_limit: 20 }), intent);
}

export async function recoverAttachmentDecision(op: AttachmentDecision, file: AttachmentFileIntent) {
  return parseAttachmentDecisionOutcome(await rpc("recover_ezyvet_attachment_approval", { p_id: op.id, p_request_id: op.request, p_pet_id: op.pet, p_capture_hash: op.captureHash }), op, file);
}
export async function submitAttachmentDecision(op: AttachmentDecision) {
  await rpc("approve_ezyvet_attachment_record", { p_id: op.id, p_request_id: op.request, p_pet_id: op.pet, p_capture_hash: op.captureHash, p_previous_record_id: op.previous, p_title: op.title, p_review_reason: op.reason, p_attest: true });
}
export async function cancelAttachmentDecision(op: AttachmentDecision) {
  await rpc("cancel_ezyvet_attachment_approval", { p_id: op.id, p_request_id: op.request, p_pet_id: op.pet, p_capture_hash: op.captureHash, p_confirmed: true });
}

export async function readAttachmentChart(pet: string, cursor: AttachmentReviewCursor | null) {
  return parseAttachmentChart(await rpc("read_ezyvet_attachment_chart", { p_pet_id: pet, p_before_at: cursor?.before_at ?? null, p_before_id: cursor?.before_id ?? null, p_limit: 20 }), pet);
}
export async function loadAttachmentChartOriginal(pet: string, id: string, captureHash: string) {
  const recover = async () => parseAttachmentChartOriginal(await rpc("get_ezyvet_attachment_chart_original", { p_record_id: id, p_pet_id: pet }), pet, id, captureHash);
  const before = await recover();
  const { data, error } = await supabase.storage.from(before.capture.bucket).download(before.capture.object_path);
  if (error) throw error;
  const blob = await verifyAttachmentOriginal(data, { file_size: before.capture.file_size!, content_sha256: before.capture.content_sha256!, mime_type: before.capture.mime_type! });
  const after = await recover();
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("Reviewed original changed.");
  return { blob, filename: attachmentOriginalFilename(after.record.attachment_external_id, after.capture.mime_type) };
}
