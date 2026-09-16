import { cleanupAbandonedAttachment, type AbandonedAttachmentCleanupLease } from "./cleanup-abandoned-attachment.ts";
import { inspectCleanupObject, removeCleanupObject, type CleanupStorageBucket } from "./attachment-cleanup-storage.ts";
export interface AbandonedCleanupClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
  storage: { from(bucket: string): CleanupStorageBucket };
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
/** Server-only adapter. Caller must enforce its default-off gate and configured grace. */
export async function runAbandonedUploadCleanup(client: AbandonedCleanupClient, uploadId: string, graceHours: number) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(uploadId) || !Number.isInteger(graceHours) || graceHours < 24 || graceHours > 720)
    throw new Error("Exact upload identity and cleanup grace required");
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const { data, error } = await client.rpc(name, args);
    if (error) throw error;
    return data;
  };
  return cleanupAbandonedAttachment({
    claim: async () => {
      const data = await rpc("claim_abandoned_attachment_cleanup", { p_upload_id: uploadId, p_grace_hours: graceHours });
      if (data === null) return null;
      if (!record(data) || data.uploadId !== uploadId) throw new Error("Cleanup claim identity changed");
      // The core validates all lease identity, bucket, path and expiry fields before use.
      return data as unknown as AbandonedAttachmentCleanupLease;
    },
    revalidate: async lease => {
      const data = await rpc("revalidate_abandoned_attachment_cleanup", { p_id: lease.id, p_token: lease.token });
      if (!record(data)) throw new Error("Cleanup eligibility is unconfirmed");
      for (const key of ["id", "token", "uploadId", "actorId", "conversationId", "bucket", "path", "objectId", "objectCreatedAt", "expiresAt"] as const) {
        if (data[key] !== lease[key]) throw new Error("Cleanup lease identity changed");
      }
    },
    inspect: (bucket, path) => inspectCleanupObject(client.storage.from(bucket), path),
    remove: (bucket, path) => removeCleanupObject(client.storage.from(bucket), path),
    finalize: async lease => {
      const data = await rpc("finalize_abandoned_attachment_cleanup", { p_id: lease.id, p_token: lease.token });
      if (!record(data) || data.id !== lease.id || data.status !== "complete") throw new Error("Cleanup receipt is unconfirmed");
      return { id: data.id as string, status: "complete" };
    },
    now: Date.now,
  });
}
