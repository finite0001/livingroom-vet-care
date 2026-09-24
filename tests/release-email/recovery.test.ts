import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEmailPreparation } from "../../src/hub/features/record-releases/email-state.ts";
test("malformed recovery responses fail locally instead of crashing the patient page", () => {
  for (const value of [
    [],
    {},
    "unexpected",
    { request: {} },
    { request: null },
  ])
    assert.throws(() => parseEmailPreparation(value, "release"), /incomplete/);
  assert.equal(parseEmailPreparation(null, "release"), null);
});
