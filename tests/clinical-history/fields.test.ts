import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyClinicalProblem,
  reviewedProblem,
} from "../../src/hub/features/imports/history-fields.ts";
test("imported prose cannot populate or classify a new local finding", () => {
  const draft = emptyClinicalProblem();
  assert.deepEqual(draft, {
    title: "",
    notes: "",
    onset: "",
    status: "",
    importance: "",
  });
  assert.throws(
    () => reviewedProblem({ ...draft, title: "Reviewed reaction" }),
    /Explicitly/,
  );
});
test("reviewed problem retains unknown onset and uses the native title boundary", () => {
  const draft = {
    ...emptyClinicalProblem(),
    title: "Reviewed reaction",
    status: "active" as const,
    importance: "high" as const,
  };
  assert.equal(reviewedProblem(draft).onset_date, null);
  assert.equal(
    reviewedProblem({ ...draft, title: "a".repeat(250) }).title.length,
    250,
  );
  assert.throws(() => reviewedProblem({ ...draft, title: "a".repeat(251) }));
  assert.throws(() => reviewedProblem({ ...draft, onset: "2026-02-30" }));
  assert.equal(
    reviewedProblem({ ...draft, onset: "2024-02-29" }).onset_date,
    "2024-02-29",
  );
});
