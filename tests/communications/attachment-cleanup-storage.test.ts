import test from "node:test";
import assert from "node:assert/strict";
import { inspectCleanupObject, removeCleanupObject, type CleanupStorageBucket } from "../../supabase/functions/_shared/attachment-cleanup-storage.ts";
const id = "11111111-1111-4111-8111-111111111111", path = `${id}/${id}/${id}/original`;
const bucket = (data: unknown, error: unknown = null): CleanupStorageBucket => ({ list: async () => ({ data, error }), remove: async () => ({ data: [], error: null }) });
test("successful listing returns exact identity and normalized time", async () => {
  const value = bucket([{ name: "original", id, created_at: "2026-09-01T00:00:00+00:00" }]);
  assert.deepEqual(await inspectCleanupObject(value, path), { id, createdAt: "2026-09-01T00:00:00.000Z" });
});
test("empty successful listing confirms absence; listing errors never do", async () => {
  assert.equal(await inspectCleanupObject(bucket([]), path), null);
  for (const error of [new Error("Network"), { status: 404 }, { status: 403 }]) await assert.rejects(inspectCleanupObject(bucket([], error), path));
});
test("truncated, duplicate and malformed identity listings are unconfirmed", async () => {
  for (const data of [null, [{ name: "original" }], [{ name: "original-a" }, { name: "original-b" }], [{ name: "original", id, created_at: "bad" }], [{ name: "original" }, { name: "original" }]]) {
    await assert.rejects(inspectCleanupObject(bucket(data), path));
  }
});
test("inspection and removal use only the exact validated path", async () => {
  let listed = false, removed = false;
  const storage: CleanupStorageBucket = {
    list: async (prefix, options) => { assert.equal(prefix, `${id}/${id}/${id}`); assert.equal(options.limit, 2); assert.equal(options.search, "original"); listed = true; return { data: [], error: null }; },
    remove: async paths => { assert.deepEqual(paths, [path]); removed = true; return { data: [], error: null }; },
  };
  await inspectCleanupObject(storage, path); await removeCleanupObject(storage, path); assert.ok(listed && removed);
  await assert.rejects(inspectCleanupObject(storage, "../original")); await assert.rejects(removeCleanupObject(storage, "../original"));
});
test("failed Storage removal propagates for subsequent absence verification", async () => {
  const value = bucket([]); value.remove = async () => ({ data: null, error: new Error("Lost deletion reply") });
  await assert.rejects(removeCleanupObject(value, path));
});
