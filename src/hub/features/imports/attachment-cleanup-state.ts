import { z } from "zod";
import type { AttachmentFileIntent } from "./attachment-file-state.ts";
const uuid = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
const date = z.string().refine(value => Number.isFinite(Date.parse(value)));
const attempt = z.object({ id: uuid, request_id: uuid, actor_id: uuid, pet_id: uuid, request_hash: hash, intent_hash: hash, created_at: date, lease_until: date }).strict();
const receipt = z.object({ cleanup_id: uuid, request_id: uuid, actor_id: uuid, intent_hash: hash, verified_absent_at: date }).strict();
const cursor = z.object({ before_at: date, before_id: uuid }).strict();
const pageSchema = z.object({ request_id: uuid, pet_id: uuid, cleanups: z.array(z.object({ attempt, receipt: receipt.nullable(), lease_active: z.boolean() }).strict()).max(20), has_more: z.boolean(), next_cursor: cursor.nullable() }).strict();
export interface AttachmentCleanupCursor { before_at: string; before_id: string; }
export function parseAttachmentCleanupHistory(value: unknown, expected: Pick<AttachmentFileIntent, "id" | "actor" | "pet" | "requestHash">) {
  const page = pageSchema.parse(value), ids = new Set<string>();
  if (page.request_id !== expected.id || page.pet_id !== expected.pet) throw new Error("Cleanup history identity differs.");
  let intentHash: string | null = null;
  for (const row of page.cleanups) {
    const a = row.attempt, r = row.receipt;
    if (ids.has(a.id) || a.request_id !== expected.id || a.actor_id !== expected.actor || a.pet_id !== expected.pet || a.request_hash !== expected.requestHash || Date.parse(a.lease_until) <= Date.parse(a.created_at)) throw new Error("Cleanup attempt identity differs.");
    if (intentHash !== null && intentHash !== a.intent_hash) throw new Error("Reserved cleanup file changed.");
    intentHash = a.intent_hash; ids.add(a.id);
    if (r && (r.cleanup_id !== a.id || r.request_id !== a.request_id || r.actor_id !== a.actor_id || r.intent_hash !== a.intent_hash || row.lease_active || Date.parse(r.verified_absent_at) < Date.parse(a.created_at))) throw new Error("Cleanup receipt differs.");
  }
  if (page.has_more !== (page.next_cursor !== null)) throw new Error("Cleanup pagination differs.");
  if (page.next_cursor) {
    const last = page.cleanups.at(-1)?.attempt;
    if (!last || last.id !== page.next_cursor.before_id || last.created_at !== page.next_cursor.before_at) throw new Error("Cleanup cursor differs.");
  }
  return { ...page, next_cursor: page.next_cursor ? { before_at: page.next_cursor.before_at!, before_id: page.next_cursor.before_id! } : null };
}

export interface AttachmentCleanupOperation { id: string; actor: string; pet: string; request: string; requestHash: string; intentHash: string; }
const operationSchema = z.object({ id: uuid, actor: uuid, pet: uuid, request: uuid, requestHash: hash, intentHash: hash }).strict();
export function parseAttachmentCleanupOperation(value: unknown, expected: Pick<AttachmentFileIntent, "id" | "actor" | "pet" | "requestHash">, intentHash: string): AttachmentCleanupOperation {
  const op = operationSchema.parse(value);
  if (op.actor !== expected.actor || op.pet !== expected.pet || op.request !== expected.id || op.requestHash !== expected.requestHash || op.intentHash !== intentHash) throw new Error("Cleanup reference differs.");
  return { id: op.id!, actor: op.actor!, pet: op.pet!, request: op.request!, requestHash: op.requestHash!, intentHash: op.intentHash! };
}
export function parseAttachmentCleanupRecovery(value: unknown, op: AttachmentCleanupOperation) {
  if (value === null) return null;
  const row = z.object({ attempt, receipt: receipt.nullable() }).strict().parse(value);
  const page = parseAttachmentCleanupHistory({ request_id: op.request, pet_id: op.pet, cleanups: [{ ...row, lease_active: false }], has_more: false, next_cursor: null }, { id: op.request, actor: op.actor, pet: op.pet, requestHash: op.requestHash });
  const saved = page.cleanups[0];
  if (saved.attempt.id !== op.id || saved.attempt.intent_hash !== op.intentHash) throw new Error("Cleanup recovery differs from original operation.");
  return saved;
}
