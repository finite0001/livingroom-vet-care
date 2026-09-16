/** One bounded cleanup attempt. Database adapters must fence eligibility to terminal abandoned uploads. */
export interface AbandonedAttachmentCleanupLease {
  id: string;
  token: string;
  uploadId: string;
  actorId: string;
  conversationId: string;
  bucket: "conversation-attachment-uploads";
  path: string;
  objectId: string;
  objectCreatedAt: string;
  expiresAt: string;
}
export interface CleanupObjectIdentity { id: string; createdAt: string }
export interface AbandonedAttachmentCleanupDependencies {
  claim(): Promise<AbandonedAttachmentCleanupLease | null>;
  /** Require exact live cleanup token, permanently abandoned reservation and bound object identity. */
  revalidate(lease: AbandonedAttachmentCleanupLease): Promise<void>;
  /** Return null only for confirmed absence; permission/network failures must throw. */
  inspect(bucket: string, path: string): Promise<CleanupObjectIdentity | null>;
  remove(bucket: string, path: string): Promise<void>;
  /** Persist completion only after confirming absence and the exact cleanup lease. */
  finalize(lease: AbandonedAttachmentCleanupLease): Promise<{ id: string; status: "complete" }>;
  now(): number;
}
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
function validate(lease: AbandonedAttachmentCleanupLease, now: number) {
  if (![lease.id, lease.token, lease.uploadId, lease.actorId, lease.conversationId, lease.objectId].every(uuid) ||
    lease.bucket !== "conversation-attachment-uploads" || lease.path !== `${lease.actorId}/${lease.conversationId}/${lease.uploadId}/original` ||
    !Number.isFinite(Date.parse(lease.objectCreatedAt)) || !Number.isFinite(now) || !(Date.parse(lease.expiresAt) > now))
    throw new Error("Abandoned attachment cleanup lease is unconfirmed");
}
export async function cleanupAbandonedAttachment(deps: AbandonedAttachmentCleanupDependencies): Promise<{ status: "empty" } | { id: string; status: "complete" }> {
  const lease = await deps.claim();
  if (!lease) return { status: "empty" };
  validate(lease, deps.now());
  await deps.revalidate(lease);
  const object = await deps.inspect(lease.bucket, lease.path);
  if (object) {
    if (object.id !== lease.objectId || object.createdAt !== lease.objectCreatedAt) throw new Error("Cleanup object identity changed");
    await deps.revalidate(lease);
    validate(lease, deps.now());
    try { await deps.remove(lease.bucket, lease.path); }
    catch { /* Only a confirmed absence can recover an uncertain deletion response. */ }
    if (await deps.inspect(lease.bucket, lease.path)) throw new Error("Attachment deletion is unconfirmed");
  }
  await deps.revalidate(lease);
  validate(lease, deps.now());
  const receipt = await deps.finalize(lease);
  if (receipt.id !== lease.id || receipt.status !== "complete") throw new Error("Cleanup completion receipt is unconfirmed");
  return receipt;
}
