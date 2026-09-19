import { test } from "node:test";
import assert from "node:assert/strict";
import {
  reconciliationIntent,
  reconciliationReview,
  reconciliationTarget,
  matchesReconciliationIntent,
  freshReconciliationProof,
} from "../../src/hub/features/payments/ReconciliationState.ts";
const id = (n: number) =>
  `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const c = {
  id: id(1),
  invoice_id: id(2),
  actor_id: id(3),
  family: "checkout",
  request_id: id(4),
  provider_object_id: "cs_fixture",
  blocker_refs: [{ kind: "observation", id: id(5) }],
  snapshot_hash: "a".repeat(64),
  created_at: "2026-09-13T03:00:00Z",
};
const e = {
  family: c.family,
  request_id: c.request_id,
  object_id: c.provider_object_id,
  account_id: "acct_fixture",
  livemode: false,
  amount_cents: "12500",
  currency: "usd",
  provider_observed_at: c.created_at,
  status: "session_expired",
  payment_id: null,
  source_hash: "b".repeat(64),
};
const envelope = {
  case: c,
  capture: {
    case_id: c.id,
    evidence: e,
    proof_hash: "c".repeat(64),
    provider_observed_at: "2026-09-13T03:00:00+00:00",
    created_at: c.created_at,
  },
  resolution: null,
};
const intent = {
  p_case_id: c.id,
  p_invoice_id: c.invoice_id,
  p_family: c.family,
  p_request_id: c.request_id,
  p_provider_object_id: c.provider_object_id,
  p_blocker_refs: c.blocker_refs,
  p_expected_case_hash: c.snapshot_hash,
};
test("reconciliation retains exact nonsecret intent and projects coarse proof without provider URLs", () => {
  const prepared = reconciliationIntent(intent, c.invoice_id);
  const r = reconciliationReview(
    { ...envelope, checkout_url: "https://checkout.stripe.com/c/pay/private" },
    c.invoice_id,
    c.id,
  )!;
  assert.ok(matchesReconciliationIntent(r, prepared, c.actor_id));
  assert.equal(r.capture?.status, "session_expired");
  assert.doesNotMatch(
    JSON.stringify(r),
    /checkout_url|source_hash|payment_id|evidence/,
  );
  assert.equal(
    matchesReconciliationIntent(
      r,
      { ...prepared, p_expected_case_hash: "d".repeat(64) },
      c.actor_id,
    ),
    false,
  );
  assert.equal(matchesReconciliationIntent(r, prepared, id(9)), false);
  assert.throws(() =>
    reconciliationIntent({ ...intent, p_paid: true }, c.invoice_id),
  );
});
test("review rejects mismatched proof, receipt and duplicate or arbitrary blockers", () => {
  for (const patch of [
    { object_id: "cs_other" },
    { amount_cents: "125.00" },
    { status: "paid" },
    { request_id: id(9) },
  ])
    assert.throws(() =>
      reconciliationReview(
        {
          ...envelope,
          capture: { ...envelope.capture, evidence: { ...e, ...patch } },
        },
        c.invoice_id,
      ),
    );
  assert.throws(() =>
    reconciliationReview(
      {
        ...envelope,
        resolution: {
          case_id: c.id,
          actor_id: c.actor_id,
          proof_hash: "d".repeat(64),
          ledger_evidence_id: id(8),
          created_at: c.created_at,
        },
      },
      c.invoice_id,
    ),
  );
  for (const p_blocker_refs of [
    [...c.blocker_refs, ...c.blocker_refs],
    [{ kind: "all", id: id(5) }],
    [],
  ])
    assert.throws(() =>
      reconciliationIntent({ ...intent, p_blocker_refs }, c.invoice_id),
    );
});
test("matching durable receipt survives proof expiry while new completion requires fresh proof", () => {
  const r = reconciliationReview(
    {
      ...envelope,
      resolution: {
        case_id: c.id,
        actor_id: c.actor_id,
        proof_hash: envelope.capture.proof_hash,
        ledger_evidence_id: id(8),
        created_at: c.created_at,
      },
    },
    c.invoice_id,
  )!;
  assert.equal(r.resolution?.case_id, c.id);
  assert.equal(
    freshReconciliationProof(r.capture!, Date.parse(c.created_at) + 299999),
    true,
  );
  assert.equal(
    freshReconciliationProof(r.capture!, Date.parse(c.created_at) + 300000),
    false,
  );
  assert.equal(
    freshReconciliationProof(r.capture!, Date.parse(c.created_at) - 1),
    false,
  );
});
test("preview requires known family object and exact bounded blocker set", () => {
  const preview = {
    invoice_id: c.invoice_id,
    family: c.family,
    request_id: c.request_id,
    provider_object_id: c.provider_object_id,
    amount_cents: "12500",
    currency: "usd",
    account_id: "acct_fixture",
    livemode: false,
    blocker_refs: c.blocker_refs,
    snapshot_hash: c.snapshot_hash,
  };
  assert.equal(
    reconciliationTarget(preview, c.invoice_id).snapshot_hash,
    c.snapshot_hash,
  );
  assert.throws(() =>
    reconciliationTarget(
      { ...preview, provider_object_id: "re_other" },
      c.invoice_id,
    ),
  );
  assert.throws(() =>
    reconciliationTarget({ ...preview, blocker_refs: [] }, c.invoice_id),
  );
});
import { reconciliationDiscovery } from "../../src/hub/features/payments/ReconciliationState.ts";
test("administrator discovery rejects cross-invoice and foreign-reviewer history while retaining unavailable known targets", () => {
  const v = {
    invoice_id: c.invoice_id,
    targets: [
      {
        family: c.family,
        request_id: c.request_id,
        provider_object_id: c.provider_object_id,
        amount_cents: "12500",
        currency: "usd",
        state: "reconciliation",
        reviewable: false,
      },
    ],
    cases: [envelope],
    has_more_cases: true,
  };
  const parsed = reconciliationDiscovery(v, c.invoice_id, c.actor_id);
  assert.equal(parsed.targets[0].reviewable, false);
  assert.equal(parsed.hasMoreCases, true);
  assert.throws(() => reconciliationDiscovery(v, id(9), c.actor_id));
  assert.throws(() => reconciliationDiscovery(v, c.invoice_id, id(9)));
  assert.throws(() =>
    reconciliationDiscovery(
      {
        ...v,
        targets: [
          {
            ...v.targets[0],
            provider_object_id: "https://checkout.stripe.com/c/pay/private",
          },
        ],
      },
      c.invoice_id,
      c.actor_id,
    ),
  );
});
