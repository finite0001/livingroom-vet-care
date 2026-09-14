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

const sourceSummary = z.object({ schema_version: z.literal(1), run_id: uuid, page: z.number().int().min(1).max(1000), parent: attachmentParentSchema, attachment_snapshot_id: uuid, attachment_payload_hash: hash, attachment_observed_head_version: z.number().int().positive(), attachment_external_id: z.string().regex(/^(0|[1-9][0-9]{0,15})$/) }).strict();
const requestPayload = z.object({ run_id: uuid, page: z.number().int().min(1).max(1000), snapshot_id: uuid, payload_hash: hash, observed_head_version: z.number().int().positive() }).strict();
const requestSummary = z.object({ id: uuid, actor_id: uuid, pet_id: uuid, status: z.enum(["pending", "captured", "abandoned"]), request_payload: requestPayload.nullable(), request_hash: hash.nullable(), source_context: sourceSummary.nullable(), created_at: date, resolved_at: date.nullable() }).strict();
const historyCursor = z.object({ before_at: date, before_id: uuid }).strict();
const requestPage = z.object({ requests: z.array(z.object({ request: requestSummary, capture_intent: z.unknown(), capture: z.unknown(), download_available: z.literal(false), worker: workerSchema }).strict()).max(20), has_more: z.boolean(), next_cursor: historyCursor.nullable() }).strict();
export function parseAttachmentFileHistory(value: unknown, actor: string, mapping: AttachmentMapping) {
  const page = requestPage.parse(value), ids = new Set<string>();
  const requests = page.requests.map(row => {
    const r = row.request;
    if (ids.has(r.id) || r.actor_id !== actor || r.pet_id !== mapping.pet_id || (r.status === "pending") !== (r.resolved_at === null) || (r.status === "captured") !== (row.capture !== null) || (r.status !== "pending" && row.worker?.lease_active)) throw new Error("File history identity or status differs.");
    ids.add(r.id);
    let intent: AttachmentFileIntent | null = null;
    if (r.source_context && r.request_payload && r.request_hash) {
      const c = r.source_context, p = r.request_payload;
      if (c.parent.pet_id !== mapping.pet_id || p.run_id !== c.run_id || p.page !== c.page || p.snapshot_id !== c.attachment_snapshot_id || p.payload_hash !== c.attachment_payload_hash || p.observed_head_version !== c.attachment_observed_head_version) throw new Error("File history source differs.");
      intent = intentSchema.parse({ id: r.id, actor, pet: r.pet_id, runId: p.run_id, page: p.page, snapshotId: p.snapshot_id, payloadHash: p.payload_hash, headVersion: p.observed_head_version, externalId: c.attachment_external_id, parent: c.parent, name: `Source attachment ${c.attachment_external_id}`, requestHash: r.request_hash });
      for (const record of [row.capture_intent, row.capture]) if (record !== null) {
        const item = object(record);
        if (item.request_id !== r.id || item.actor_id !== actor || item.pet_id !== mapping.pet_id) throw new Error("File history receipt belongs to another request.");
      }
      if (row.capture !== null && row.capture_intent === null) throw new Error("Captured request has no reserved intent.");
    } else if (r.status !== "abandoned" || r.source_context !== null || r.request_payload !== null || r.request_hash !== null || row.capture_intent !== null || row.capture !== null || row.worker !== null) throw new Error("Incomplete file history context.");
    return { id: r.id, createdAt: r.created_at, status: r.status, intent, sameMapping: !!intent && intent.parent.animal_link_id === mapping.link_id && intent.parent.source_origin === mapping.source_origin && intent.parent.source_site_uid === mapping.source_site_uid && intent.parent.animal_external_id === mapping.external_id };
  });
  if (page.has_more !== (page.next_cursor !== null)) throw new Error("File history pagination differs.");
  if (page.next_cursor) { const last = requests.at(-1); if (!last || last.id !== page.next_cursor.before_id || last.createdAt !== page.next_cursor.before_at) throw new Error("File history cursor differs."); }
  return { requests, has_more: page.has_more, next_cursor: page.next_cursor };
}
