import { test } from "node:test";
import assert from "node:assert/strict";
import {
  action,
  actions,
  preview,
  intentSchema,
  storedIntentSchema,
} from "../../src/hub/features/outbox-retry/OutboxRetryState.ts";
const id = (n: number) =>
    `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`,
  hash = "a".repeat(64),
  time = "2026-09-12T12:00:00Z";
const r = {
  id: id(1),
  actor_id: id(2),
  outbox_id: id(3),
  expected_work_hash: hash,
  reason: "source_reverified",
  previous_revision: 1,
  queued_revision: 2,
  created_at: time,
};
test("outgoing action recovery binds original ID, actor, hash and reason independently of current work", () => {
  assert.equal(action(r, id(2), id(1))?.id, id(1));
  assert.throws(() => action(r, id(2), id(9)));
  assert.throws(() => action(r, id(9), id(1)));
  const p = intentSchema.parse({
    p_id: id(1),
    p_outbox_id: id(3),
    p_expected_work_hash: hash,
    p_reason: "source_reverified",
    p_attest: true,
  });
  assert.equal(action(r, id(2), id(1), p)?.queued_revision, 2);
  assert.throws(() => action({...r,queued_revision:3},id(2),id(1)));
  assert.equal(storedIntentSchema.parse({intent:p,reviewed_revision:1}).reviewed_revision,1);
  assert.throws(() => intentSchema.parse({...p,reviewed_revision:1}));
  assert.throws(() =>
    action({ ...r, expected_work_hash: "b".repeat(64) }, id(2), id(1), p),
  );
  assert.throws(() =>
    actions({ items: [{ ...r, actor_id: id(9) }], has_more: false }, id(2)),
  );
  assert.throws(() => intentSchema.parse({ ...p, p_attest: false }));
  assert.throws(() => intentSchema.parse({ ...p, p_override: true }));
});
test("outgoing preview excludes payload and fails closed on contradictory provider/source eligibility", () => {
  const p = {
    outbox: {
      id: id(3),
      conversation_id: id(4),
      client_id: id(5),
      message_id: id(6),
      created_by: id(2),
      channel: "SMS",
      state: "failed",
      provider: "twilio",
      created_at: time,
      updated_at: time,
      revision: 1,
      attempt_count: 0,
      reason: "processing_review_required",
      body: "private",
    },
    eligible: true,
    reason: "eligible_for_requeue",
    expected_work_hash: hash,
    source: { family: "message", source_id: null, eligible: true },
    history: [r],
    history_has_more: false,
  };
  assert.equal("body" in preview(p, id(3), id(2))!.outbox, false);
  for (const change of [{ state: "uncertain" }, { attempt_count: 1 }])
    assert.throws(() =>
      preview({ ...p, outbox: { ...p.outbox, ...change } }, id(3), id(2)),
    );
  assert.throws(() =>
    preview({ ...p, source: { ...p.source, eligible: false } }, id(3), id(2)),
  );
  assert.throws(() => preview({ ...p, reason: "raw exception" }, id(3), id(2)));
  assert.throws(() => preview(p, id(9), id(2)));
});
