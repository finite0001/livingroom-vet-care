import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parsePrescriptionReview,
  prescriptionReviewPayloadSchema,
  prescriptionReviewKey,
  savePrescriptionReviewIntent,
  readPrescriptionReviewIntent,
} from "../../src/hub/features/imports/prescription-review-operation-state.ts";
import { clearOtherInvoiceEmailIntents } from "../../src/hub/contexts/session-draft-retention.ts";
const other = "cd000000-0000-4000-8000-000000000001";
function fixture() {
  const receipt = JSON.parse(
    readFileSync(new URL("./receipt.fixture.json", import.meta.url), "utf8"),
  );
  const context = structuredClone(receipt.context);
  const payload = prescriptionReviewPayloadSchema.parse({
    item_run_id: context.item_run.id,
    patient_version: context.patient_version,
    interpretation: {
      ...context.reviewed,
      replaces_id: receipt.replaces_id,
      expected_predecessor_hash: receipt.expected_predecessor_hash,
      items: context.selected_items.map(
        (item: {
          source: { snapshot_id: string };
          reviewed: unknown;
          product: { id: string; version: number } | null;
        }) => ({
          ...(item.reviewed as Record<string, unknown>),
          snapshot_id: item.source.snapshot_id,
          product_id: item.product?.id ?? null,
          product_version: item.product?.version ?? null,
        }),
      ),
    },
  });
  return {
    receipt,
    clinical_approval_available: true,
    request: {
      id: receipt.id,
      actor_id: receipt.approved_by,
      pet_id: receipt.pet_id,
      status: "approved",
      payload,
      request_hash: "a".repeat(64),
      review_context: context,
      approved_record_id: receipt.id,
      created_at: receipt.approved_at,
      resolved_at: receipt.approved_at,
    },
  };
}
test("binds a recovered approval to retained clinician, patient and exact interpretation", () => {
  const e = fixture(),
    r = e.request;
  assert.equal(
    parsePrescriptionReview(e, r.actor_id, r.pet_id, r.id, r.payload)?.receipt
      ?.id,
    e.receipt.id,
  );
  assert.throws(() => parsePrescriptionReview(e, other, r.pet_id));
  assert.throws(() => parsePrescriptionReview(e, r.actor_id, other));
  assert.throws(() => parsePrescriptionReview(e, r.actor_id, r.pet_id, other));
  assert.throws(() =>
    parsePrescriptionReview(e, r.actor_id, r.pet_id, r.id, {
      ...r.payload,
      patient_version: 999,
    }),
  );
});
test("accepts an equivalent request reusing another clinician's original approved record", () => {
  const e = fixture();
  e.request.id = other;
  e.request.actor_id = other;
  e.request.payload.patient_version = 2;
  e.request.review_context.patient_version = 2;
  assert.equal(
    parsePrescriptionReview(e, other, e.request.pet_id, other)?.receipt?.id,
    e.receipt.id,
  );
});
test("rejects altered prepared source or item interpretation even without a receipt", () => {
  const e = fixture();
  e.request.status = "prepared";
  e.request.approved_record_id = null;
  e.request.resolved_at = null;
  e.receipt = null;
  assert.equal(
    parsePrescriptionReview(e, e.request.actor_id, e.request.pet_id)?.request
      .status,
    "prepared",
  );
  const changed = structuredClone(e);
  changed.request.review_context.selected_items[0].source.original.qty =
    "inferred dose";
  assert.throws(() =>
    parsePrescriptionReview(changed, e.request.actor_id, e.request.pet_id),
  );
  e.request.review_context.reviewed.reason = "Changed review rationale";
  assert.throws(() =>
    parsePrescriptionReview(e, e.request.actor_id, e.request.pet_id),
  );
});
test("rejects approved record inconsistent with frozen prepared interpretation", () => {
  const e = fixture();
  e.receipt.context.reviewed.outside_author = "Different source clinician";
  assert.throws(() =>
    parsePrescriptionReview(e, e.request.actor_id, e.request.pet_id),
  );
});
test("requires explicit completeness, item identity, dates and paired catalog/predecessor values", () => {
  for (const change of [
    (p: ReturnType<typeof fixture>["request"]["payload"]) => {
      p.interpretation.partial_reason = null;
    },
    (p: ReturnType<typeof fixture>["request"]["payload"]) => {
      p.interpretation.items.push(p.interpretation.items[0]);
    },
    (p: ReturnType<typeof fixture>["request"]["payload"]) => {
      p.interpretation.items[0].product_version = null;
    },
    (p: ReturnType<typeof fixture>["request"]["payload"]) => {
      p.interpretation.prescribed_on = "2026-09-13";
    },
    (p: ReturnType<typeof fixture>["request"]["payload"]) => {
      p.interpretation.replaces_id = other;
    },
  ]) {
    const p = fixture().request.payload;
    change(p);
    assert.throws(() => prescriptionReviewPayloadSchema.parse(p));
  }
});
test("unprepared abandonment tombstone remains recoverable but cannot carry approval", () => {
  const e = fixture();
  const tombstone = {
    ...e,
    receipt: null,
    request: {
      ...e.request,
      status: "abandoned",
      payload: null,
      request_hash: null,
      review_context: null,
      approved_record_id: null,
    },
  };
  assert.equal(
    parsePrescriptionReview(tombstone, e.request.actor_id, e.request.pet_id)
      ?.request.status,
    "abandoned",
  );
  assert.throws(() =>
    parsePrescriptionReview(
      { ...tombstone, receipt: e.receipt },
      e.request.actor_id,
      e.request.pet_id,
    ),
  );
});
test("retained payload survives reload, rejects identity tampering and clears on actor change/sign-out", () => {
  const rows = new Map<string, string>();
  const storage = {
    get length() {
      return rows.size;
    },
    key: (i: number) => [...rows.keys()][i] ?? null,
    getItem: (k: string) => rows.get(k) ?? null,
    setItem: (k: string, v: string) => {
      rows.set(k, v);
    },
    removeItem: (k: string) => {
      rows.delete(k);
    },
  };
  const previous = Object.getOwnPropertyDescriptor(
    globalThis,
    "sessionStorage",
  );
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: storage,
  });
  try {
    const e = fixture();
    const intent = {
      id: e.request.id,
      actor: e.request.actor_id,
      pet: e.request.pet_id,
      payload: e.request.payload,
    };
    savePrescriptionReviewIntent(intent);
    const key = prescriptionReviewKey(intent.actor, intent.pet);
    assert.deepEqual(readPrescriptionReviewIntent(key), intent);
    rows.set(key, JSON.stringify({ ...intent, actor: other }));
    assert.throws(() => readPrescriptionReviewIntent(key));
    savePrescriptionReviewIntent(intent);
    clearOtherInvoiceEmailIntents(storage, other);
    assert.equal(rows.size, 0);
    savePrescriptionReviewIntent(intent);
    clearOtherInvoiceEmailIntents(storage, null);
    assert.equal(rows.size, 0);
    storage.setItem = () => {
      throw new Error("Storage unavailable");
    };
    assert.throws(
      () => savePrescriptionReviewIntent(intent),
      /No review request was submitted/,
    );
  } finally {
    if (previous) Object.defineProperty(globalThis, "sessionStorage", previous);
    else Reflect.deleteProperty(globalThis, "sessionStorage");
  }
});

test("recovery rejects a different correction predecessor or hidden consultation association", () => {
  const e = fixture();
  e.request.payload.interpretation.replaces_id = other;
  e.request.payload.interpretation.expected_predecessor_hash = "b".repeat(64);
  assert.throws(() =>
    parsePrescriptionReview(e, e.request.actor_id, e.request.pet_id),
  );
  const c = fixture();
  c.request.status = "prepared";
  c.request.approved_record_id = null;
  c.request.resolved_at = null;
  c.receipt = null;
  c.request.review_context.parent.original.consult_id = "999";
  assert.throws(() =>
    parsePrescriptionReview(c, c.request.actor_id, c.request.pet_id),
  );
});
