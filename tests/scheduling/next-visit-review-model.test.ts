import { test } from "node:test";
import assert from "node:assert/strict";
import {
  reviewMetadataSchema,
  rememberReview,
  readReviewMetadata,
  forgetReview,
  reviewStorageKey,
  nextVisitReviewSchema,
} from "../../src/hub/features/scheduling/next-visit-review-model.ts";
const id = (n: number) =>
  `50000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const meta = { id: id(1), actor_id: id(2), operation: "decide" as const };
function storage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}
test("Browser storage accepts identifiers only and is actor scoped", () => {
  const db = storage();
  rememberReview(db, meta);
  assert.deepEqual(readReviewMetadata(db, meta.actor_id), [meta]);
  assert.deepEqual(readReviewMetadata(db, id(3)), []);
  assert.throws(() =>
    rememberReview(db, {
      ...meta,
      request: { note: "Clinical text" },
    } as typeof meta),
  );
  assert.equal(JSON.stringify([...db.data]).includes("Clinical"), false);
  forgetReview(db, meta);
  assert.equal(db.getItem(reviewStorageKey(meta.actor_id)), null);
});
test("Corrupted or adopted metadata fails closed before submitting new work", () => {
  const db = storage();
  db.setItem(reviewStorageKey(id(3)), JSON.stringify([meta]));
  assert.throws(() => readReviewMetadata(db, id(3)));
  assert.equal(
    reviewMetadataSchema.safeParse({ ...meta, operation: "book" }).success,
    false,
  );
});
test("Reviewed envelope preserves operation and exact payload shape", () => {
  const envelope = {
    ...meta,
    operation: "complete",
    request: { id: id(4), expected_version: 1 },
    expires_at: "2030-01-01T00:00:00Z",
    state: "prepared",
    receipt: null,
  };
  assert.equal(nextVisitReviewSchema.safeParse(envelope).success, true);
  assert.equal(
    nextVisitReviewSchema.safeParse({ ...envelope, state: "saved" }).success,
    false,
  );
  assert.equal(
    nextVisitReviewSchema.safeParse({ ...envelope, operation: "decide" })
      .success,
    false,
  );
  assert.equal(
    nextVisitReviewSchema.safeParse({
      ...envelope,
      request: { ...envelope.request, notes: "Unexpected" },
    }).success,
    false,
  );
});
