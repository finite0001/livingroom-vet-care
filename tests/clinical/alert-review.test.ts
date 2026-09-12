import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decodePatientAlertReview,
  alertAcknowledgmentMatches,
} from "../../src/hub/features/clinical/alert-review-policy.ts";
function fixture() {
  return {
    source_hash: "a".repeat(64),
    snapshot: {
      schema_version: 1,
      pet_id: "pet",
      patient_version: 1,
      important_problems: [
        {
          id: "problem",
          version: 1,
          title: "Prior reaction",
          notes: "Authored note",
          status: "resolved",
          importance: "high",
          onset_date: null,
          updated_at: "2026-09-12T12:00:00Z",
        },
      ],
      legacy_allergies: {
        text: null,
        provenance: "Existing profile; verification unknown",
      },
    },
  };
}
test("resolved important history is reviewable and acknowledgment binds exact content", () => {
  const review = decodePatientAlertReview(fixture(), "pet");
  assert.equal(review.snapshot.important_problems[0].status, "resolved");
  assert.equal(alertAcknowledgmentMatches(review, null), false);
  assert.equal(alertAcknowledgmentMatches(review, "a".repeat(64)), true);
  assert.equal(
    alertAcknowledgmentMatches(
      { ...review, source_hash: "b".repeat(64) },
      "a".repeat(64),
    ),
    false,
  );
});
test("malformed alert rows and legacy allergy fields fail locally", () => {
  for (const value of [
    null,
    [],
    { ...fixture(), source_hash: "bad" },
    {
      ...fixture(),
      snapshot: { ...fixture().snapshot, important_problems: [null] },
    },
    {
      ...fixture(),
      snapshot: {
        ...fixture().snapshot,
        important_problems: [
          {
            ...fixture().snapshot.important_problems[0],
            title: { unexpected: true },
          },
        ],
      },
    },
    {
      ...fixture(),
      snapshot: {
        ...fixture().snapshot,
        legacy_allergies: { text: 42, provenance: "unknown" },
      },
    },
  ])
    assert.throws(() => decodePatientAlertReview(value, "pet"), /incomplete/);
  assert.throws(
    () => decodePatientAlertReview(fixture(), "other"),
    /incomplete/,
  );
});
