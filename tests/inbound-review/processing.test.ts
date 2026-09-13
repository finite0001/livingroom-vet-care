import { test } from "node:test";
import assert from "node:assert/strict";
import {
  intentSchema,
  preview,
  queue,
  retryReceipt,
} from "../../src/hub/features/inbound-review/ProcessingState.ts";
const id = (n: number) =>
    `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  hash = "a".repeat(64),
  date = "2026-09-12T12:00:00Z";
const event = {
  id: id(1),
  provider: "resend",
  event_id: "signed-event",
  resource_id: "received-email",
  event_type: "inbound",
  state: "review",
  attempts: 10,
  cycle_no: 0,
  cycle_attempts: 10,
  received_at: date,
  available_at: date,
  last_error: "provider_fetch_or_persistence_retry",
  revision: 21,
};
test("processing projection excludes private payloads and unknown upstream error text", () => {
  const result = queue({
    events: [{ ...event, metadata: { html: "private" }, lease_token: id(8) }],
    has_more: false,
  });
  assert.equal("metadata" in result.events[0], false);
  assert.equal("lease_token" in result.events[0], false);
  assert.throws(() =>
    queue({
      events: [{ ...event, last_error: "raw provider failure with secret" }],
      has_more: false,
    }),
  );
});
test("content, crash and unexhausted work cannot be represented as eligible retries", () => {
  const p = {
    event,
    eligible: true,
    expected_work_hash: hash,
    history: [],
    history_has_more: false,
    retries: [],
  };
  assert.equal(preview(p, id(1))?.eligible, true);
  for (const change of [
    { last_error: "provider_content_requires_review" },
    { last_error: "worker_lease_expired" },
    { cycle_attempts: 9 },
    { state: "claimed" },
  ])
    assert.throws(() =>
      preview({ ...p, event: { ...event, ...change } }, id(1)),
    );
  assert.equal(
    preview(
      {
        ...p,
        event: { ...event, last_error: "worker_lease_expired" },
        eligible: false,
      },
      id(1),
    )?.eligible,
    false,
  );
});
test("retry receipt binds exact actor/UUID/hash/reason and preserves lifetime attempts through first cycle", () => {
  const p = intentSchema.parse({
    p_id: id(2),
    p_event_id: id(1),
    p_expected_work_hash: hash,
    p_reason: "configuration_repaired",
    p_attest: true,
  });
  const r = {
    id: id(2),
    actor_id: id(3),
    event_id: id(1),
    expected_work_hash: hash,
    reason: "configuration_repaired",
    previous_cycle_no: 0,
    cycle_no: 1,
    lifetime_attempts: 10,
    created_at: date,
  };
  assert.equal(retryReceipt(r, id(3), p)?.lifetime_attempts, 10);
  assert.equal(retryReceipt(r, id(3), undefined, id(2))?.id, id(2));
  assert.throws(() => retryReceipt(r, id(3), undefined, id(9)));
  assert.throws(() => retryReceipt(r, id(4), p));
  assert.throws(() => retryReceipt({ ...r, cycle_no: 2 }, id(3), p));
  assert.throws(() =>
    retryReceipt({ ...r, expected_work_hash: "b".repeat(64) }, id(3), p),
  );
  assert.throws(() => intentSchema.parse({ ...p, p_attest: false }));
  assert.throws(() => intentSchema.parse({ ...p, p_override_consent: true }));
});
