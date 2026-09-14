import { z } from "zod";
import { parseRecovery, object, same } from "../../../../supabase/functions/ezyvet-attachment-capture/contract.ts";
import { attachmentParentSchema, parseAttachmentParent } from "./attachment-discovery-state.ts";
import type { AttachmentMapping } from "./attachment-discovery-state.ts";
const uuid = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
const date = z.string().refine(value => Number.isFinite(Date.parse(value)));
const intentSchema = z.object({ id: uuid, actor: uuid, pet: uuid, runId: uuid, page: z.number().int().min(1).max(1000), snapshotId: uuid, payloadHash: hash, headVersion: z.number().int().positive(), externalId: z.string().regex(/^(0|[1-9][0-9]{0,15})$/), parent: attachmentParentSchema, name: z.string().max(800), requestHash: hash.optional() }).strict();
export type AttachmentFileIntent = z.infer<typeof intentSchema>;
const workerSchema = z.object({ attempt_no: z.number().int().positive(), lease_active: z.boolean(), lease_until: date, error_code: z.string().nullable(), retryable: z.boolean().nullable(), retry_after: date.nullable() }).strict().nullable();
export function parseAttachmentFileIntent(value: unknown, actor: string, mapping: AttachmentMapping) {
  const intent = intentSchema.parse(value);
  if (intent.actor !== actor || intent.pet !== mapping.pet_id) throw new Error("File request belongs to another operator or patient.");
  parseAttachmentParent(intent.parent, mapping);
  return intent;
}
export function parseAttachmentFileRecovery(value: unknown, expected: AttachmentFileIntent) {
  const intent = intentSchema.parse(expected), envelope = object(value), request = object(envelope.request);
  const requestHash = hash.parse(request.request_hash);
  if (intent.requestHash && intent.requestHash !== requestHash) throw new Error("Saved file request changed.");
  const identity = { id: intent.id!, actor: intent.actor!, pet: intent.pet!, requestHash };
  const saved = parseRecovery(value, identity, { baseUrl: intent.parent.source_origin!, siteUid: intent.parent.source_site_uid! });
  const source = saved.source;
  if (source.run_id !== intent.runId || source.page !== intent.page || source.attachment_snapshot_id !== intent.snapshotId || source.attachment_payload_hash !== intent.payloadHash || source.attachment_observed_head_version !== intent.headVersion || source.attachment_external_id !== intent.externalId || !same(source.parent, intent.parent)) throw new Error("Saved file source differs from the selected observation.");
  const worker = workerSchema.parse(envelope.worker);
  if (envelope.download_available !== false || (saved.status !== "pending" && worker?.lease_active)) throw new Error("File status is inconsistent.");
  return { status: saved.status, requestHash, worker, captured: !!saved.capture, fileSize: saved.capture ? saved.intent!.file_size : null };
}
export type AttachmentFileRecovery = ReturnType<typeof parseAttachmentFileRecovery>;
export function attachmentFileCanCapture(state: AttachmentFileRecovery, now = Date.now()) {
  return state.status === "pending" && !state.worker?.lease_active && state.worker?.retryable !== false && (!state.worker?.retry_after || Date.parse(state.worker.retry_after) <= now);
}

export class AttachmentFileActionError extends Error {}
