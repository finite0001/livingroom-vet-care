import test from "node:test";
import assert from "node:assert/strict";
import { cleanupAbandonedAttachment, type AbandonedAttachmentCleanupDependencies, type AbandonedAttachmentCleanupLease, type CleanupObjectIdentity } from "../../supabase/functions/_shared/cleanup-abandoned-attachment.ts";
const id = "11111111-1111-4111-8111-111111111111";
function fixture() {
  const lease: AbandonedAttachmentCleanupLease = { id, token: id, uploadId: id, actorId: id, conversationId: id, bucket: "conversation-attachment-uploads", path: `${id}/${id}/${id}/original`, objectId: id, objectCreatedAt: "2026-09-01T00:00:00Z", expiresAt: "2026-09-16T00:02:00Z" };
  let object: CleanupObjectIdentity | null = { id, createdAt: lease.objectCreatedAt };
  let removed = 0, finalized = 0;
  const deps: AbandonedAttachmentCleanupDependencies = {
    claim: async () => lease, revalidate: async () => {}, inspect: async () => object,
    remove: async () => { removed++; object = null; },
    finalize: async () => { finalized++; return { id, status: "complete" }; },
    now: () => Date.parse("2026-09-16T00:00:00Z"),
  };
  return { lease, deps, counts: () => ({ removed, finalized }), absent: () => { object = null; } };
}
test("records completion only after deletion and confirmed absence", async () => {
  const f = fixture(); assert.deepEqual(await cleanupAbandonedAttachment(f.deps), { id, status: "complete" }); assert.deepEqual(f.counts(), { removed: 1, finalized: 1 });
});
test("lost deletion reply recovers through confirmed absence", async () => {
  const f = fixture(); f.deps.remove = async () => { f.absent(); throw new Error("Lost reply"); };
  assert.equal((await cleanupAbandonedAttachment(f.deps)).status, "complete"); assert.equal(f.counts().finalized, 1);
});
test("already absent object recovers without another removal", async () => {
  const f = fixture(); f.absent(); await cleanupAbandonedAttachment(f.deps); assert.deepEqual(f.counts(), { removed: 0, finalized: 1 });
});
test("failed deletion or failed absence check cannot finalize", async () => {
  for (const failure of ["remove", "inspect"]) {
    const f = fixture();
    if (failure === "remove") f.deps.remove = async () => { throw new Error("Unavailable"); };
    else f.deps.inspect = async () => { throw new Error("Permission denied is not absence"); };
    await assert.rejects(cleanupAbandonedAttachment(f.deps)); assert.equal(f.counts().finalized, 0);
  }
});
test("changed identity, path, expired lease and failed eligibility never remove", async () => {
  for (const failure of ["identity", "path", "expired", "eligibility"]) {
    const f = fixture();
    if (failure === "identity") f.deps.inspect = async () => ({ id: "22222222-2222-4222-8222-222222222222", createdAt: f.lease.objectCreatedAt });
    if (failure === "path") f.lease.path = "another/original";
    if (failure === "expired") f.lease.expiresAt = "2026-09-15T00:00:00Z";
    if (failure === "eligibility") f.deps.revalidate = async () => { throw new Error("Not abandoned"); };
    await assert.rejects(cleanupAbandonedAttachment(f.deps)); assert.deepEqual(f.counts(), { removed: 0, finalized: 0 });
  }
});
test("revoked eligibility after inspection prevents deletion", async () => {
  const f = fixture(); let checks = 0;
  f.deps.revalidate = async () => { if (++checks === 2) throw new Error("Lease replaced"); };
  await assert.rejects(cleanupAbandonedAttachment(f.deps)); assert.equal(f.counts().removed, 0);
});
test("unconfirmed final receipt is not reported complete", async () => {
  const f = fixture(); f.deps.finalize = async () => ({ id: "22222222-2222-4222-8222-222222222222", status: "complete" });
  await assert.rejects(cleanupAbandonedAttachment(f.deps));
});
