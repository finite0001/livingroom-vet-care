import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  collectionIntent,
  parseCollection,
  matchesCollectionIntent,
  collectionCurrent,
} from "../../src/hub/features/payments/PaymentCollectionState.ts";
const id = (n: number) =>
  `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const g = {
  id: id(1),
  actor_id: id(2),
  invoice_id: id(3),
  client_id: id(4),
  source_hash: "a".repeat(64),
  amount_cents: "12500",
  currency: "usd",
  created_at: "2026-09-13T03:00:00Z",
  expires_at: "2026-09-20T03:00:00Z",
  status_expires_at: "2026-10-20T03:00:00Z",
};
const context = JSON.stringify({
  domain: "lrv-payment-collection/v2",
  context_version: 2,
  origin: "https://thelivingroom.vet",
  key_version: "first",
  grant: g,
});
const envelope = {
  grant: { ...g, state: "captured" },
  capture: {
    grant_id: g.id,
    context_version: 2,
    origin: "https://thelivingroom.vet",
    key_version: "first",
    capability_context: context,
    context_hash: createHash("sha256").update(context).digest("hex"),
  },
};
const args = {
  p_request_id: g.id,
  p_invoice_id: g.invoice_id,
  p_client_id: g.client_id,
  p_source_hash: g.source_hash,
  p_amount_cents: 12500,
  p_expires_at: new Date(g.expires_at).toISOString(),
};
test("safe client projection validates frozen context then discards raw context and any unexpected capability", async () => {
  const parsed = await parseCollection(
    { ...envelope, token: "p1.secret" },
    g.actor_id,
    g.invoice_id,
    g.client_id,
    g.id,
  );
  assert.ok(parsed);
  assert.equal(parsed.contextHash, envelope.capture.context_hash);
  assert.doesNotMatch(
    JSON.stringify(parsed),
    /capability_context|p1|origin|key_version/,
  );
  assert.ok(matchesCollectionIntent(parsed, args));
  for (const grant of [
    { ...g, amount_cents: "12501" },
    { ...g, actor_id: id(9) },
  ])
    await assert.rejects(
      parseCollection(
        { ...envelope, grant: { ...grant, state: "captured" } },
        g.actor_id,
        g.invoice_id,
        g.client_id,
      ),
    );
  await assert.rejects(
    parseCollection(
      {
        ...envelope,
        capture: { ...envelope.capture, context_hash: "b".repeat(64) },
      },
      g.actor_id,
      g.invoice_id,
      g.client_id,
    ),
  );
});
test("durable intent permits only six nonsecret fields and keeps exact expiry", () => {
  assert.deepEqual(collectionIntent(args, g.invoice_id, g.client_id), args);
  for (const patch of [
    { token: "p1.secret" },
    { p_amount_cents: "12500" },
    { p_amount_cents: 49 },
    { p_amount_cents: 100000000 },
    { p_expires_at: "invalid" },
    { p_client_id: id(9) },
  ])
    assert.throws(() =>
      collectionIntent({ ...args, ...patch }, g.invoice_id, g.client_id),
    );
});
test("source, amount and deadline changes disable new review without changing saved grant", async () => {
  const parsed = (await parseCollection(
    envelope,
    g.actor_id,
    g.invoice_id,
    g.client_id,
  ))!;
  assert.equal(
    collectionCurrent(
      parsed,
      g.source_hash,
      g.amount_cents,
      Date.parse(g.created_at),
    ),
    true,
  );
  assert.equal(
    collectionCurrent(
      parsed,
      "b".repeat(64),
      g.amount_cents,
      Date.parse(g.created_at),
    ),
    false,
  );
  assert.equal(
    collectionCurrent(parsed, g.source_hash, "12501", Date.parse(g.created_at)),
    false,
  );
  assert.equal(
    collectionCurrent(
      parsed,
      g.source_hash,
      g.amount_cents,
      Date.parse(g.expires_at),
    ),
    false,
  );
  assert.equal(
    matchesCollectionIntent(parsed, {
      ...args,
      p_expires_at: "2026-09-19T03:00:00Z",
    }),
    false,
  );
});
import {
  requiresReconciliation,
  parsePaymentState,
  type PaymentState,
} from "../../src/hub/features/payments/state.ts";
test("resolved observation history permits actions while new or legacy unresolved evidence still blocks", () => {
  const s: PaymentState = {
    invoice_id: g.invoice_id,
    client_id: g.client_id,
    source_hash: g.source_hash,
    balance: {
      obligation_cents: "12500",
      paid_cents: "0",
      refunded_cents: "0",
      net_cash_cents: "0",
      outstanding_cents: "12500",
      pending_refund_cents: "0",
      refundable_cents: "0",
    },
    payments: [],
    attempts: [],
    refund_requests: [],
    reconciliation_observations: [
      {
        id: id(9),
        family: "checkout",
        request_id: id(8),
        reason: "review",
        created_at: g.created_at,
        resolved: true,
      },
    ],
  };
  assert.equal(
    requiresReconciliation(parsePaymentState(s, g.invoice_id, g.client_id)),
    false,
  );
  for (const resolved of [undefined, false])
    assert.equal(
      requiresReconciliation({
        ...s,
        reconciliation_observations: [
          ...s.reconciliation_observations,
          { ...s.reconciliation_observations[0], resolved },
        ],
      }),
      true,
    );
  assert.throws(() =>
    parsePaymentState(
      {
        ...s,
        reconciliation_observations: [
          { ...s.reconciliation_observations[0], resolved: "true" },
        ],
      },
      g.invoice_id,
      g.client_id,
    ),
  );
  assert.equal(
    requiresReconciliation({
      ...s,
      attempts: [
        {
          id: id(8),
          actor_id: g.actor_id,
          invoice_id: g.invoice_id,
          client_id: g.client_id,
          source_hash: g.source_hash,
          amount_cents: "12500",
          state: "reconciliation",
          created_at: g.created_at,
        },
      ],
    }),
    true,
  );
});

test("pending expiry is canonical milliseconds and SQL recovery cannot hide microsecond differences", async () => {
  const parsed = (await parseCollection(
    envelope,
    g.actor_id,
    g.invoice_id,
    g.client_id,
  ))!;
  const intent = { ...args, p_expires_at: "2026-09-20T03:00:00.123Z" };
  assert.deepEqual(collectionIntent(intent, g.invoice_id, g.client_id), intent);
  for (const p_expires_at of [
    "2026-09-20T03:00:00.123001Z",
    "2026-09-20T03:00:00.123000Z",
    "2026-09-20T03:00:00.123+00:00",
    "2026-09-20T03:00:00Z",
    "2026-02-30T03:00:00.123Z",
  ])
    assert.throws(() =>
      collectionIntent({ ...intent, p_expires_at }, g.invoice_id, g.client_id),
    );
  for (const expires_at of [
    "2026-09-20T03:00:00.123001+00:00",
    "2026-09-20T03:00:00.123999Z",
  ])
    assert.equal(
      matchesCollectionIntent({ ...parsed, expires_at }, intent),
      false,
    );
  for (const expires_at of [
    "2026-09-20T03:00:00.123+00:00",
    "2026-09-20T03:00:00.123000+00:00",
    intent.p_expires_at,
  ])
    assert.equal(
      matchesCollectionIntent({ ...parsed, expires_at }, intent),
      true,
    );
  assert.equal(
    matchesCollectionIntent(
      { ...parsed, expires_at: intent.p_expires_at },
      { ...intent, p_expires_at: "2026-09-20T03:00:00.123001Z" },
    ),
    false,
  );
});
