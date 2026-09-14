import test from "node:test";
import assert from "node:assert/strict";
import { mergeReleaseSelection, releaseSelectionLimit, sourceLabels } from "../../src/hub/features/record-releases/selection.ts";

test("API originals are a distinct source family capped at 20 without dropping selected IDs", () => {
  assert.equal(sourceLabels.api_original_ids, "DVM-acknowledged API originals");
  const selected = Array.from({ length: 19 }, (_, index) => `record-${index}`);
  assert.equal(releaseSelectionLimit("api_original_ids"), 20);
  assert.equal(mergeReleaseSelection(selected, ["last", "last"], releaseSelectionLimit("api_original_ids")).length, 20);
  assert.throws(() => mergeReleaseSelection(selected, ["last", "overflow"], releaseSelectionLimit("api_original_ids")), /no selections were changed/);
  assert.equal(selected.length, 19);
  assert.equal(releaseSelectionLimit("document_ids"), 100);
});
