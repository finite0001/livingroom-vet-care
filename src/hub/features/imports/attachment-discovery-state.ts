import { z } from "zod";
const uuid = z.string().uuid();
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const date = z.string().refine(value => Number.isFinite(Date.parse(value)), "Invalid timestamp");
const externalId = z.string().regex(/^(0|[1-9][0-9]{0,15})$/).refine(value => Number(value) <= Number.MAX_SAFE_INTEGER);
const preview = (limit: number) => z.string().refine(value => [...value].length <= limit).nullable();
export interface AttachmentMapping { link_id: string; pet_id: string; source_origin: string; source_site_uid: string; external_id: string; }
export interface AttachmentOwner { actor: string; pet: string; id: string; requestHash: string; intentHash: string; }
export const attachmentParentSchema = z.object({
  animal_link_id: uuid, pet_id: uuid, client_id: uuid, animal_external_id: externalId,
  source_origin: z.string().url(), source_site_uid: z.string().min(1),
  parent_type: z.enum(["Animal", "Consult"]), parent_external_id: externalId,
  parent_snapshot_id: uuid, parent_payload_hash: digest, parent_observed_head_version: z.number().int().positive(),
}).strict();
export type AttachmentParent = z.infer<typeof attachmentParentSchema>;
const observationCursor = z.object({ after_page: z.number().int().min(1).max(1000), after_snapshot_id: uuid }).strict();
export type AttachmentObservationCursor = z.infer<typeof observationCursor>;
const historyCursor = z.object({ before_at: date, before_id: uuid }).strict();
export type AttachmentHistoryCursor = z.infer<typeof historyCursor>;
const run = z.object({ id: uuid, requested_by: uuid, resource: z.literal("attachment"), source_origin: z.string().url(), source_site_uid: z.string(),
  status: z.enum(["running", "review_ready", "page_limit_reached"]), next_page: z.number().int().positive(), retry_after: date.nullable(), last_error_code: z.string().nullable(),
  created_at: date, updated_at: date, lease_active: z.boolean(), scope: z.literal("parent_scoped"), parent_context: attachmentParentSchema }).strict();
const runPage = z.object({ runs: z.array(run).max(50), has_more: z.boolean(), next_cursor: historyCursor.nullable() }).strict();
export type AttachmentRun = z.infer<typeof run>;
const observation = z.object({
  run_id: uuid, pet_id: uuid, page: z.number().int().min(1).max(1000), snapshot_id: uuid,
  payload_hash: digest, observed_head_version: z.number().int().positive(), external_id: externalId,
  current_snapshot_id: uuid.nullable(), current_head_version: z.number().int().positive().nullable(), is_current: z.boolean(),
  metadata: z.object({ name: preview(400), mime_type: preview(200), file_id: preview(200), notes: preview(4000), notes_truncated: z.boolean(), name_truncated: z.boolean() }).strict(),
}).strict();
const observationPage = z.object({ run_id: uuid, pet_id: uuid, parent_context: attachmentParentSchema, parent_is_current: z.boolean(), observations: z.array(observation).max(10), has_more: z.boolean(), next_cursor: observationCursor.nullable() }).strict();
export type AttachmentObservation = z.infer<typeof observation>;
const cleanupAttempt = z.object({ id: uuid, request_id: uuid, actor_id: uuid, pet_id: uuid, request_hash: digest, intent_hash: digest, created_at: date, lease_until: date }).strict();
const cleanupReceipt = z.object({ cleanup_id: uuid, request_id: uuid, actor_id: uuid, intent_hash: digest, verified_absent_at: date }).strict();
const cleanupPage = z.object({ request_id: uuid, pet_id: uuid, cleanups: z.array(z.object({ attempt: cleanupAttempt, receipt: cleanupReceipt.nullable(), lease_active: z.boolean() }).strict()).max(50), has_more: z.boolean(), next_cursor: historyCursor.nullable() }).strict();
function requireMatch(matches: boolean) { if (!matches) throw new Error("Attachment evidence changed or belongs to another request. Recheck the saved state."); }
export function parseAttachmentParent(value: unknown, mapping: AttachmentMapping) {
  if (value === null) return null;
  const parent = attachmentParentSchema.parse(value);
  requireMatch(parent.animal_link_id === mapping.link_id && parent.pet_id === mapping.pet_id && parent.source_origin === mapping.source_origin && parent.source_site_uid === mapping.source_site_uid && parent.animal_external_id === mapping.external_id);
  return parent;
}
export function parseAttachmentRuns(value: unknown, actor: string, mapping: AttachmentMapping) {
  const page = runPage.parse(value), ids = new Set<string>();
  for (const item of page.runs) {
    requireMatch(!ids.has(item.id) && item.requested_by === actor && item.source_origin === mapping.source_origin && item.source_site_uid === mapping.source_site_uid);
    ids.add(item.id); parseAttachmentParent(item.parent_context, mapping);
  }
  requireMatch(page.has_more === (page.next_cursor !== null));
  if (page.next_cursor) { const last = page.runs.at(-1); requireMatch(!!last && page.next_cursor.before_at === last.created_at && page.next_cursor.before_id === last.id); }
  return page;
}
export function parseAttachmentObservations(value: unknown, runId: string, mapping: AttachmentMapping, expected: AttachmentParent) {
  const page = observationPage.parse(value), parent = parseAttachmentParent(page.parent_context, mapping)!, pinned = attachmentParentSchema.parse(expected);
  requireMatch(page.run_id === runId && page.pet_id === mapping.pet_id && Object.keys(pinned).every(key => parent[key as keyof AttachmentParent] === pinned[key as keyof AttachmentParent]));
  const keys = new Set<string>();
  for (const item of page.observations) {
    const key = `${item.page}:${item.snapshot_id}`;
    requireMatch(!keys.has(key) && item.run_id === runId && item.pet_id === mapping.pet_id);
    keys.add(key);
    requireMatch((item.current_snapshot_id === null) === (item.current_head_version === null));
    requireMatch(item.is_current === (item.current_snapshot_id === item.snapshot_id && item.current_head_version === item.observed_head_version));
  }
  requireMatch(page.has_more === (page.next_cursor !== null));
  if (page.next_cursor) {
    const last = page.observations.at(-1);
    requireMatch(!!last && page.next_cursor.after_page === last.page && page.next_cursor.after_snapshot_id === last.snapshot_id);
  }
  return page;
}
export function parseAttachmentCleanups(value: unknown, owner: AttachmentOwner) {
  const page = cleanupPage.parse(value), ids = new Set<string>();
  requireMatch(page.request_id === owner.id && page.pet_id === owner.pet);
  for (const { attempt: a, receipt: r, lease_active } of page.cleanups) {
    requireMatch(!ids.has(a.id) && a.request_id === owner.id && a.actor_id === owner.actor && a.pet_id === owner.pet && a.request_hash === owner.requestHash && a.intent_hash === owner.intentHash);
    ids.add(a.id);
    requireMatch(Date.parse(a.lease_until) > Date.parse(a.created_at));
    if (r) requireMatch(r.cleanup_id === a.id && r.request_id === owner.id && r.actor_id === owner.actor && r.intent_hash === owner.intentHash && !lease_active);
  }
  requireMatch(page.has_more === (page.next_cursor !== null));
  if (page.next_cursor) {
    const last = page.cleanups.at(-1)?.attempt;
    requireMatch(!!last && page.next_cursor.before_at === last.created_at && page.next_cursor.before_id === last.id);
  }
  return page;
}
