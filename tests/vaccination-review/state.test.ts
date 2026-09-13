import { test } from "node:test";
import assert from "node:assert/strict";
import {
  vaccinationReviewPayloadSchema,
  importedVaccinationSchema,
  parseVaccinationReview,
  saveVaccinationReviewIntent,
  readVaccinationReviewIntent,
  vaccinationReviewKey,
} from "../../src/hub/features/imports/vaccination-review-state.ts";
import { clearOtherInvoiceEmailIntents } from "../../src/hub/contexts/session-draft-retention.ts";
import { actor, pet, id, payload, request, receipt } from "./fixtures.ts";
test("review requires explicit date and status interpretations, preserves ambiguous raw dates", () => {
  assert.equal(
    vaccinationReviewPayloadSchema.parse(payload()).administered_on,
    null,
  );
  for (const patch of [
    { status: "" },
    { administration_date_status: "date" },
    { administration_date_status: "date", administered_on: "2026-02-30" },
    { administration_date_status: "unknown", administered_on: "2026-01-01" },
    { product_id: id(9) },
    { replaces_id: id(7) },
    { product_version: 2 },
    { dose: "1ml" },
  ])
    assert.equal(
      vaccinationReviewPayloadSchema.safeParse({ ...payload(), ...patch })
        .success,
      false,
    );
  assert.equal(
    vaccinationReviewPayloadSchema.parse({
      ...payload(),
      administration_date_status: "date",
      administered_on: "2024-02-29",
    }).administered_on,
    "2024-02-29",
  );
});
test("recovered identity and exact intent must match before approval", () => {
  assert.ok(
    parseVaccinationReview(
      request(),
      actor,
      pet,
      id(8),
      vaccinationReviewPayloadSchema.parse(payload()),
    ),
  );
  assert.throws(() => parseVaccinationReview(request(), id(9), pet));
  assert.throws(() => parseVaccinationReview(request(), actor, id(9)));
  assert.throws(() => parseVaccinationReview(request(), actor, pet, id(9)));
  assert.throws(() =>
    parseVaccinationReview(request(), actor, pet, id(8), {
      ...vaccinationReviewPayloadSchema.parse(payload()),
      reason: "Changed rationale",
    }),
  );
  assert.throws(() =>
    parseVaccinationReview(
      { ...request(), request: { ...request().request, status: "approved" } },
      actor,
      pet,
    ),
  );
});
test("full intent survives reload, refuses a different actor, and clears on signout", () => {
  const values = new Map<string, string>();
  const storage = {
    get length() {
      return values.size;
    },
    key: (n: number) => [...values.keys()][n] ?? null,
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      values.set(k, v);
    },
    removeItem: (k: string) => {
      values.delete(k);
    },
  };
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: storage,
  });
  const intent = {
    id: id(8),
    actor,
    pet,
    payload: vaccinationReviewPayloadSchema.parse(payload()),
  };
  saveVaccinationReviewIntent(intent);
  assert.deepEqual(
    readVaccinationReviewIntent(vaccinationReviewKey(actor, pet)),
    intent,
  );
  values.set(vaccinationReviewKey(id(9), pet), JSON.stringify(intent));
  assert.throws(() =>
    readVaccinationReviewIntent(vaccinationReviewKey(id(9), pet)),
  );
  clearOtherInvoiceEmailIntents(storage, actor);
  assert.equal(values.size, 1);
  clearOtherInvoiceEmailIntents(storage, null);
  assert.equal(values.size, 0);
  storage.setItem = () => {
    throw new Error("blocked");
  };
  assert.throws(
    () => saveVaccinationReviewIntent(intent),
    /No review request was submitted/,
  );
});

test("frozen evidence independently binds reviewed fields and source pins", () => {
  const value = request();
  for (const context of [
    { ...value.request.review_context, pet_id: id(99) },
    { ...value.request.review_context, observed_head_version: 2 },
    {
      ...value.request.review_context,
      consult: {
        ...value.request.review_context.consult,
        observed_head_version: 9,
      },
    },
    {
      ...value.request.review_context,
      reviewed: {
        ...value.request.review_context.reviewed,
        status: "administered",
      },
    },
    {
      ...value.request.review_context,
      product: { id: id(9), name: "invented", version: 1, kind: "vaccine" },
    },
  ])
    assert.throws(() =>
      parseVaccinationReview(
        { ...value, request: { ...value.request, review_context: context } },
        actor,
        pet,
      ),
    );
});

test("chart projection cannot present a date alongside unknown interpretation", () => {
  const value = receipt();
  assert.equal(
    importedVaccinationSchema.safeParse({
      ...value,
      reviewed: { ...value.reviewed, administered_on: "2026-01-01" },
    }).success,
    false,
  );
});
