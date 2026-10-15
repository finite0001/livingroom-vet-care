import { z } from "zod";
import { draftCanonical, draftOperationSchema, type DraftActionMetadata, type DraftRequest } from "./draft-model.ts";
const uuid = z.string().uuid().refine((value) => value === value.toLowerCase());
export const draftPointerSchema = z.object({
  id: uuid, actor_id: uuid, operation: draftOperationSchema,
  request_hash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export interface DraftPointer extends DraftActionMetadata { request_hash: string }
interface PointerStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
const key = (actor: string, operation: DraftActionMetadata["operation"]) => `lrv:controlled-draft-review:${actor}:${operation}`;
export async function draftRequestHash(request: DraftRequest): Promise<string> {
  const bytes = new TextEncoder().encode(draftCanonical(request));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export function readDraftPointer(storage: PointerStorage, actor: string, operation: DraftActionMetadata["operation"]): DraftPointer | null {
  const raw = storage.getItem(key(actor, operation));
  if (raw === null) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("Saved controlled draft review details are unrecognized; keep them for recovery"); }
  const parsed = draftPointerSchema.safeParse(value);
  if (!parsed.success || parsed.data.actor_id !== actor || parsed.data.operation !== operation)
    throw new Error("Saved controlled draft review details are unrecognized; keep them for recovery");
  return { id: parsed.data.id, actor_id: parsed.data.actor_id, operation: parsed.data.operation, request_hash: parsed.data.request_hash };
}
export function rememberDraftPointer(storage: PointerStorage, pointer: DraftPointer): void {
  const checked = draftPointerSchema.parse(pointer), existing = readDraftPointer(storage, checked.actor_id, checked.operation);
  if (existing && draftCanonical(existing) !== draftCanonical(checked)) throw new Error("Check the original controlled draft review before starting another");
  storage.setItem(key(checked.actor_id, checked.operation), JSON.stringify(checked));
  if (draftCanonical(readDraftPointer(storage, checked.actor_id, checked.operation)) !== draftCanonical(checked))
    throw new Error("Unable to retain inventory recovery details; nothing was submitted");
}
export function forgetDraftPointer(storage: PointerStorage, pointer: DraftPointer): void {
  const actual = readDraftPointer(storage, pointer.actor_id, pointer.operation);
  if (actual === null || draftCanonical(actual) !== draftCanonical(pointer)) throw new Error("Original recovery details changed; keep this review");
  storage.removeItem(key(pointer.actor_id, pointer.operation));
  if (storage.getItem(key(pointer.actor_id, pointer.operation)) !== null) throw new Error("Unable to release original recovery details");
}
