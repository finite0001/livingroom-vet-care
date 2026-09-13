import { test } from "node:test";
import assert from "node:assert/strict";
import {
  matchingStripeRetry,
  stripeRetryCycle,
  stripeRetryIntent,
  stripeRetryPreview,
  stripeRetryRows,
} from "../../src/hub/features/payments/StripeRetryState.ts";
const id = (n: number) =>
  `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const intent = {
  p_resolution_id: id(1),
  p_receipt_id: id(2),
  p_expected_work_hash: "a".repeat(64),
  p_reason: "provider_recovered",
  p_attest: true,
};
const cycle = {
  id: id(1),
  receipt_id: id(2),
  actor_id: id(3),
  cycle_no: 1,
  expected_work_hash: "a".repeat(64),
  reason: "provider_recovered",
  previous_attempt_count: 5,
  previous_cycle_attempt_count: 5,
  created_at: new Date().toISOString(),
};
test("retry intent rejects extra fields, missing attestation and inherited reasons", () => {
  assert.equal(stripeRetryIntent(intent).p_resolution_id, id(1));
  for (
    const change of [{ p_attest: false }, { p_reason: "toString" }, {
      p_expected_work_hash: "x",
    }, { extra: "ignored" }]
  ) assert.throws(() => stripeRetryIntent({ ...intent, ...change }));
});
test("recovery receipt must match actor and complete original retry intent", () => {
  const c = stripeRetryCycle(cycle), i = stripeRetryIntent(intent);
  assert.equal(matchingStripeRetry(c, i, id(3)), true);
  for (
    const patch of [{ actor_id: id(4) }, { receipt_id: id(4) }, {
      expected_work_hash: "b".repeat(64),
    }, { reason: "processor_repaired" as const }]
  ) assert.equal(matchingStripeRetry({ ...c, ...patch }, i, id(3)), false);
});
test("preview separates lifetime attempts from bounded cycle and validates receipt scope", () => {
  const p = {
    receipt: { id: id(2) },
    work: {
      receipt_id: id(2),
      state: "quarantined",
      attempt_count: 10,
      cycle_no: 1,
      cycle_attempt_count: 5,
    },
    eligible: true,
    expected_work_hash: "b".repeat(64),
    cycles: [cycle],
    history: [{
      action: "exhausted",
      reason: "provider_unavailable",
      attempt_count: 10,
      cycle_no: 1,
      created_at: new Date().toISOString(),
    }],
  };
  const v = stripeRetryPreview(p, id(2));
  assert.equal(v.attemptCount, 10);
  assert.equal(v.cycleAttemptCount, 5);
  assert.equal(v.history.length, 1);
  assert.throws(() =>
    stripeRetryPreview(
      { ...p, work: { ...p.work, cycle_attempt_count: 6 } },
      id(2),
    )
  );
  assert.throws(() => stripeRetryPreview(p, id(4)));
  assert.throws(() =>
    stripeRetryCycle({ ...cycle, previous_cycle_attempt_count: 4 })
  );
});

test("completed and ignored jobs remain discoverable and completed retry receipts recover", () => {
  const rows = ["completed", "ignored"].map((state, i) => ({
    id: id(i + 8),
    event_type: "v2.future_event.completed",
    work_state: state,
    attempt_count: 6,
    cycle_no: 1,
    cycle_attempt_count: 1,
    work_reason: "",
  }));
  assert.equal(stripeRetryRows(rows).length, 2);
  const p = {
    receipt: { id: id(2) },
    work: {
      receipt_id: id(2),
      state: "completed",
      attempt_count: 6,
      cycle_no: 1,
      cycle_attempt_count: 1,
    },
    eligible: false,
    expected_work_hash: "b".repeat(64),
    cycles: [cycle],
    history: [],
  };
  const v = stripeRetryPreview(p, id(2));
  assert.equal(v.workState, "completed");
  assert.equal(
    matchingStripeRetry(v.cycles[0], stripeRetryIntent(intent), id(3)),
    true,
  );
});
