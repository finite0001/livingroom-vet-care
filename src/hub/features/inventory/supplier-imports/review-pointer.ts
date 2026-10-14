import { z } from "zod";
import { identityCanonical, identityOperationSchema, type IdentityActionMetadata, type IdentityRequest } from "./package-model.ts";
const uuid = z.string().uuid().refine((value) => value === value.toLowerCase());
export const identityPointerSchema = z.object({
  id: uuid, actor_id: uuid, operation: identityOperationSchema,
  request_hash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export interface IdentityPointer extends IdentityActionMetadata { request_hash: string }
interface PointerStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
const key = (actor: string, operation: IdentityActionMetadata["operation"]) => `lrv:inventory-identity-review:${actor}:${operation}`;
export async function identityRequestHash(request: IdentityRequest): Promise<string> {
  const bytes = new TextEncoder().encode(identityCanonical(request));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export function readIdentityPointer(storage: PointerStorage, actor: string, operation: IdentityActionMetadata["operation"]): IdentityPointer | null {
  const raw = storage.getItem(key(actor, operation));
  if (raw === null) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("Saved inventory review details are unrecognized; keep them for recovery"); }
  const parsed = identityPointerSchema.safeParse(value);
  if (!parsed.success || parsed.data.actor_id !== actor || parsed.data.operation !== operation)
    throw new Error("Saved inventory review details are unrecognized; keep them for recovery");
  return { id: parsed.data.id, actor_id: parsed.data.actor_id, operation: parsed.data.operation, request_hash: parsed.data.request_hash };
}
export function rememberIdentityPointer(storage: PointerStorage, pointer: IdentityPointer): void {
  const checked = identityPointerSchema.parse(pointer), existing = readIdentityPointer(storage, checked.actor_id, checked.operation);
  if (existing && identityCanonical(existing) !== identityCanonical(checked)) throw new Error("Check the original inventory review before starting another");
  storage.setItem(key(checked.actor_id, checked.operation), JSON.stringify(checked));
  if (identityCanonical(readIdentityPointer(storage, checked.actor_id, checked.operation)) !== identityCanonical(checked))
    throw new Error("Unable to retain inventory recovery details; nothing was submitted");
}
export function forgetIdentityPointer(storage: PointerStorage, pointer: IdentityPointer): void {
  const actual = readIdentityPointer(storage, pointer.actor_id, pointer.operation);
  if (actual === null || identityCanonical(actual) !== identityCanonical(pointer)) throw new Error("Original recovery details changed; keep this review");
  storage.removeItem(key(pointer.actor_id, pointer.operation));
  if (storage.getItem(key(pointer.actor_id, pointer.operation)) !== null) throw new Error("Unable to release original recovery details");
}
