import type { CleanupObjectIdentity } from "./cleanup-abandoned-attachment.ts";
export interface CleanupStorageBucket {
  list(prefix: string, options: { search: string; limit: number; sortBy: { column: string; order: string } }): PromiseLike<{ data: unknown; error: unknown }>;
  remove(paths: string[]): PromiseLike<{ data: unknown; error: unknown }>;
}
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
function folder(path: string): string {
  const parts = path.split("/");
  if (parts.length !== 4 || parts[3] !== "original" || !parts.slice(0, 3).every(uuid)) throw new Error("Invalid abandoned upload path");
  return parts.slice(0, 3).join("/");
}
/** A successful complete listing, not a failed GET, is evidence of absence. */
export async function inspectCleanupObject(bucket: CleanupStorageBucket, path: string): Promise<CleanupObjectIdentity | null> {
  const { data, error } = await bucket.list(folder(path), { search: "original", limit: 2, sortBy: { column: "name", order: "asc" } });
  if (error) throw error;
  if (!Array.isArray(data) || data.length > 2) throw new Error("Storage listing is unconfirmed");
  for (const row of data) if (!row || typeof row !== "object" || typeof row.name !== "string") throw new Error("Invalid object listing");
  const matches = data.filter(row => row.name === "original");
  if (matches.length > 1) throw new Error("Ambiguous object identity");
  if (!matches.length) {
    if (data.length === 2) throw new Error("Storage listing may be truncated");
    return null;
  }
  const match = matches[0];
  if (!uuid(match.id) || typeof match.created_at !== "string" || !Number.isFinite(Date.parse(match.created_at))) throw new Error("Storage object identity is unconfirmed");
  return { id: match.id, createdAt: new Date(match.created_at).toISOString() };
}
export async function removeCleanupObject(bucket: CleanupStorageBucket, path: string): Promise<void> {
  folder(path);
  const { error } = await bucket.remove([path]);
  if (error) throw error;
  // A successful delete response still requires the caller's separate absence check.
}
