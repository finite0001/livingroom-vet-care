import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  actionRequest,
  emptySections,
  reviewSchema,
  submitSchema,
  verifyReceipt,
  type DictationAction,
} from "../../src/hub/features/clinical/dictation/model.ts";

const actor = randomUUID(),
  pet = randomUUID(),
  encounter = randomUUID(),
  proposal = randomUUID();
function imported() {
  const sections = emptySections();
  sections.subjective = {
    text: "Cough for two days.",
    quote: "cough for two days",
  };
  return {
    pet_id: pet,
    encounter_id: encounter,
    expected_version: 1,
    transcript: "Owner reports cough for two days. 🐾 No exam dictated.",
    source_note: "Synthetic staff transcript authorized for testing.",
    attest_authorized: true as const,
    sections,
  };
}
function reviewed() {
  return {
    pet_id: pet,
    encounter_id: encounter,
    expected_version: 1,
    proposal_id: proposal,
    decision: "accepted" as const,
    accepted_sections: { subjective: "Reviewed cough history." },
    review_note: "",
    attest_reviewed: true as const,
  };
}
function savedEncounter() {
  return {
    id: encounter,
    pet_id: pet,
    version: 2,
    status: "draft",
    visit_at: new Date().toISOString(),
    visit_type: "clinic",
    location: "Synthetic",
    subjective: "Reviewed cough history.",
    objective: "Unchanged exam",
    assessment: "Unchanged assessment",
    plan: "Unchanged plan",
    created_by: actor,
    updated_by: actor,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    signed_by: null,
    signed_at: null,
  };
}
function accepted() {
  const action: DictationAction = {
    id: randomUUID(),
    actor,
    kind: "review",
    request: reviewed(),
  };
  const receipt = {
    id: action.id,
    actor_id: actor,
    kind: "review",
    proposal_id: proposal,
    pet_id: pet,
    encounter_id: encounter,
    decision: "accepted",
    encounter: savedEncounter(),
  };
  return { action, receipt };
}
test("retains exact source whitespace and Unicode", () => {
  const value = imported();
  value.transcript = "\n" + value.transcript + "\n";
  assert.equal(submitSchema.parse(value).transcript, value.transcript);
});
test("empty sections do not become normal findings", () => {
  const value = submitSchema.parse(imported());
  assert.deepEqual(value.sections.objective, { text: "", quote: "" });
});
test("excerpt must be a literal retained source substring", () => {
  const value = imported();
  value.sections.subjective.quote = "Owner denies coughing";
  assert.equal(submitSchema.safeParse(value).success, false);
});
test("Unicode supporting excerpt resolves without offset assumptions", () => {
  const value = imported();
  value.sections.subjective.quote = "🐾 No exam dictated.";
  assert.equal(submitSchema.safeParse(value).success, true);
});
test("missing and unknown SOAP sections rejected", () => {
  const value = imported();
  assert.equal(
    submitSchema.safeParse({
      ...value,
      sections: { subjective: value.sections.subjective },
    }).success,
    false,
  );
  assert.equal(
    submitSchema.safeParse({
      ...value,
      sections: {
        ...value.sections,
        diagnosis: { text: "Made up", quote: "cough" },
      },
    }).success,
    false,
  );
});
test("blank or overlong transcript and null characters rejected", () => {
  for (const transcript of ["  \n\t", "x".repeat(60001), "cough\0for two days"])
    assert.equal(
      submitSchema.safeParse({ ...imported(), transcript }).success,
      false,
    );
});
test("source authorization and attribution required", () => {
  assert.equal(
    submitSchema.safeParse({ ...imported(), attest_authorized: false }).success,
    false,
  );
  assert.equal(
    submitSchema.safeParse({ ...imported(), source_note: " " }).success,
    false,
  );
});
test("no entirely empty proposal or orphaned source excerpt", () => {
  assert.equal(
    submitSchema.safeParse({ ...imported(), sections: emptySections() })
      .success,
    false,
  );
  const value = imported();
  value.sections.objective.quote = "No exam dictated.";
  assert.equal(submitSchema.safeParse(value).success, false);
});
test("acceptance requires explicit nonempty section selection and review", () => {
  assert.equal(
    reviewSchema.safeParse({ ...reviewed(), accepted_sections: {} }).success,
    false,
  );
  assert.equal(
    reviewSchema.safeParse({
      ...reviewed(),
      accepted_sections: { subjective: " " },
    }).success,
    false,
  );
  assert.equal(
    reviewSchema.safeParse({ ...reviewed(), attest_reviewed: false }).success,
    false,
  );
});
test("acceptance cannot introduce an unknown field", () => {
  assert.equal(
    reviewSchema.safeParse({
      ...reviewed(),
      accepted_sections: { signed_by: actor },
    }).success,
    false,
  );
});
test("rejection requires a reason and cannot contain selected edits", () => {
  assert.equal(
    reviewSchema.safeParse({ ...reviewed(), decision: "rejected" }).success,
    false,
  );
  assert.equal(
    reviewSchema.safeParse({
      ...reviewed(),
      decision: "rejected",
      accepted_sections: {},
      review_note: "Wrong patient attribution",
    }).success,
    true,
  );
});
test("valid accepted receipt is tied to actor, source and destination", () => {
  const { action, receipt } = accepted();
  assert.deepEqual(verifyReceipt(receipt, action), receipt);
});
test("counterfeit actor/patient/encounter/proposal/action receipt rejected", () => {
  const { action, receipt } = accepted();
  for (const key of ["id", "actor_id", "pet_id", "encounter_id", "proposal_id"])
    assert.throws(() =>
      verifyReceipt({ ...receipt, [key]: randomUUID() }, action),
    );
});
test("wrong saved version, reviewer or accepted wording rejected", () => {
  const { action, receipt } = accepted();
  for (const delta of [
    { version: 1 },
    { updated_by: randomUUID() },
    { subjective: "Unreviewed text" },
    { pet_id: randomUUID() },
  ])
    assert.throws(() =>
      verifyReceipt(
        { ...receipt, encounter: { ...receipt.encounter, ...delta } },
        action,
      ),
    );
});
test("accepted receipt must stay unsigned and include the saved row", () => {
  const { action, receipt } = accepted();
  assert.throws(() => verifyReceipt({ ...receipt, encounter: null }, action));
  assert.throws(() =>
    verifyReceipt(
      {
        ...receipt,
        encounter: { ...receipt.encounter, status: "signed", signed_by: actor },
      },
      action,
    ),
  );
});
test("submission receipt cannot claim to have changed the chart", () => {
  const action: DictationAction = {
    id: proposal,
    actor,
    kind: "submit",
    request: imported(),
  };
  const receipt = {
    id: proposal,
    actor_id: actor,
    kind: "submit",
    proposal_id: proposal,
    pet_id: pet,
    encounter_id: encounter,
    decision: "submitted",
    encounter: null,
  };
  assert.deepEqual(verifyReceipt(receipt, action), receipt);
  assert.throws(() =>
    verifyReceipt({ ...receipt, encounter: savedEncounter() }, action),
  );
});
test("unknown action and extra request fields denied", () => {
  const action: DictationAction = {
    id: proposal,
    actor,
    kind: "submit",
    request: imported(),
  };
  assert.throws(() => actionRequest({ ...action, kind: "sign" as "submit" }));
  assert.throws(() =>
    actionRequest({
      ...action,
      request: { ...action.request, auto_sign: true },
    }),
  );
});
