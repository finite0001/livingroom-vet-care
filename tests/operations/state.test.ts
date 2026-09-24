import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runSchema,
  outboxSchema,
  conversationLink,
  householdLink,
  patientLink,
} from "../../src/hub/features/operations/OperationsState.ts";
import { stripeQueuePage } from "../../src/hub/features/payments/StripeRetryState.ts";
const id = "11111111-1111-4111-8111-111111111111",
  time = "2026-09-12T12:00:00.123456+00:00";
test("unfinished scheduler evidence stays unknown and contradictory counts are rejected", () => {
  const run = {
    run_id: id,
    requested_limit: 50,
    started_at: time,
    outcome: "started",
    finished_at: null,
    counts: null,
    failure_code: null,
  };
  assert.equal(runSchema.parse(run).counts, null);
  assert.throws(() =>
    runSchema.parse({
      ...run,
      counts: { queued: 0, blocked: 0, skipped: 0, dispatched: false },
    }),
  );
  assert.throws(() => runSchema.parse({ ...run, outcome: "completed" }));
});
test("safe outbox projection drops private fields and rejects arbitrary upstream errors", () => {
  const row = {
    id,
    conversation_id: id,
    client_id: id,
    message_id: id,
    channel: "EMAIL",
    state: "uncertain",
    reason: "processing_review_required",
    created_at: time,
    updated_at: time,
    attempt_count: 1,
    lease_expired: false,
    first_attempt_at: time,
    accepted_at: null,
    delivered_at: null,
    delivery_failure_kind: null,
    body: "private",
  };
  assert.equal("body" in outboxSchema.parse(row), false);
  assert.throws(() =>
    outboxSchema.parse({ ...row, reason: "private upstream failure" }),
  );
  assert.equal(conversationLink(id), `/hub/conversation/${id}`);
  assert.equal(householdLink(id), `/hub/client/${id}`);
  assert.equal(patientLink(id), `/hub/patient/${id}`);
  assert.throws(() => householdLink("https://external.test"));
});
test("Stripe keyset preserves database timestamp precision for older discovery", () => {
  const page = stripeQueuePage({
    items: [
      {
        id,
        event_type: "checkout.session.completed",
        work_state: "quarantined",
        attempt_count: 5,
        cycle_no: 0,
        cycle_attempt_count: 5,
        work_reason: "retry_exhausted",
        created_at: time,
      },
    ],
    has_more: true,
  });
  assert.equal(page.items[0].created_at, time);
  assert.equal(page.has_more, true);
  assert.throws(() => stripeQueuePage({ items: [], has_more: "yes" }));
});

test("scheduler receipts reject impossible limit, totals and backwards completion", () => {
  const r = {
    run_id: id,
    requested_limit: 50,
    started_at: time,
    outcome: "completed",
    finished_at: "2026-09-12T13:00:00Z",
    counts: { queued: 20, blocked: 20, skipped: 10, dispatched: false },
    failure_code: null,
  };
  assert.equal(runSchema.parse(r).requested_limit, 50);
  assert.throws(() =>
    runSchema.parse({ ...r, finished_at: "2026-09-12T12:00:00.123455+00:00" }),
  );
  for (const requested_limit of [0, 101])
    assert.throws(() => runSchema.parse({ ...r, requested_limit }));
  assert.throws(() =>
    runSchema.parse({ ...r, counts: { ...r.counts, skipped: 11 } }),
  );
  assert.throws(() =>
    runSchema.parse({ ...r, finished_at: "2026-09-12T11:59:59Z" }),
  );
});
