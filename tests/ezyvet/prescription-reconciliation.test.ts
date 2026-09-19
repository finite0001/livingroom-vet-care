import test from "node:test";
import assert from "node:assert/strict";
import { reconcilePrescriptionItems } from "../../supabase/functions/ezyvet-import/prescription-reconciliation.ts";

test("matching references require a finished scan and tolerate ordering and numeric strings", () => {
  assert.equal(reconcilePrescriptionItems([1, "2"], [2, "1"], true).status, "matched");
  assert.equal(reconcilePrescriptionItems([1], [1], false).status, "unresolved");
});

test("a terminal page cannot hide missing, unexpected or duplicate medication items", () => {
  const result = reconcilePrescriptionItems([1, "1", 2, 3], [1, 4, "4"], true);
  assert.equal(result.status, "unresolved");
  assert.deepEqual(result.missingIds, ["2", "3"]);
  assert.deepEqual(result.unexpectedIds, ["4"]);
  assert.deepEqual(result.duplicateSourceIds, ["1"]);
  assert.deepEqual(result.duplicateObservedIds, ["4"]);
});

test("absent or malformed source lists are distinct from an explicitly empty list", () => {
  for (const list of [undefined, null, "", "1,2", { id: 1 }]) {
    const result = reconcilePrescriptionItems(list, [], true);
    assert.equal(result.status, "unresolved");
    assert.equal(result.sourceListPresent, false);
    assert.deepEqual(result.invalidSourceReferences, [{ index: -1, value: list }]);
  }
  assert.equal(reconcilePrescriptionItems([], [], true).status, "matched");
});

test("malformed references retain their position and exact evidence without guessed normalization", () => {
  const invalid = ["01", " 1", "1e2", -1, 1.5, true, null, { id: 2 }, Number.MAX_SAFE_INTEGER + 1];
  const result = reconcilePrescriptionItems(invalid, invalid, true);
  assert.equal(result.status, "unresolved");
  assert.deepEqual(result.invalidSourceReferences, invalid.map((value, index) => ({ index, value })));
  assert.deepEqual(result.invalidObservedReferences, result.invalidSourceReferences);
});

test("large string IDs remain distinct and input evidence is not mutated", () => {
  const source = Object.freeze(["9007199254740992", "9007199254740993"]);
  const observed = Object.freeze(["9007199254740992"]);
  const result = reconcilePrescriptionItems(source, observed, true);
  assert.deepEqual(result.missingIds, ["9007199254740993"]);
  assert.equal(result.status, "unresolved");
  assert.deepEqual(source, ["9007199254740992", "9007199254740993"]);
});
