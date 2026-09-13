import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assignmentIntent,
  assignmentOutcome,
  recovery,
} from "../../src/hub/features/inbound-review/InboundReviewState.ts";
const id = (n: number) =>
  `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const args = {
  p_actor_id: id(1),
  p_id: id(2),
  p_expected_version: 1,
  p_client_id: id(3),
  p_conversation_id: id(4),
  p_reason: "Compared sender with household",
};
const inbound = {
  id: id(2),
  channel: "EMAIL",
  sender: "sender@example.test",
  recipient: "practice@example.test",
  subject: "Original",
  body: "Literal <script>example</script>",
  occurred_at: "2026-09-12T12:00:00Z",
  received_at: "2026-09-12T12:00:00Z",
  client_id: null,
  conversation_id: null,
  message_id: null,
  review_reason: "unknown_sender",
  version: 1,
};
const assignment = {
  id: id(5),
  inbound_id: id(2),
  client_id: id(3),
  conversation_id: id(4),
  assigned_by: id(1),
  reason: args.p_reason,
  created_at: "2026-09-12T12:00:00Z",
};
test("durable assignment contains exact existing inbound/version/actor with no new-message authority", () => {
  assert.deepEqual(assignmentIntent(args, id(1)), args);
  assert.throws(() => assignmentIntent(args, id(7)));
  assert.throws(() =>
    assignmentIntent({ ...args, p_message_id: id(8) }, id(1)),
  );
  assert.throws(() =>
    assignmentIntent({ ...args, p_expected_version: 1.5 }, id(1)),
  );
});
test("assignment proof requires original message plus exact audited actor and destination", () => {
  const p = assignmentIntent(args, id(1));
  assert.equal(
    assignmentOutcome(recovery({ inbound, assignments: [] }, id(2)), p),
    "unassigned",
  );
  const assigned = {
    ...inbound,
    version: 2,
    client_id: id(3),
    conversation_id: id(4),
    message_id: id(6),
  };
  assert.equal(
    assignmentOutcome(
      recovery({ inbound: assigned, assignments: [assignment] }, id(2)),
      p,
    ),
    "assigned",
  );
  for (const change of [
    { assigned_by: id(7) },
    { reason: "Another reason" },
    { conversation_id: id(8) },
  ])
    assert.equal(
      assignmentOutcome(
        recovery(
          { inbound: assigned, assignments: [{ ...assignment, ...change }] },
          id(2),
        ),
        p,
      ),
      "conflict",
    );
  assert.equal(
    assignmentOutcome(
      recovery({ inbound: assigned, assignments: [] }, id(2)),
      p,
    ),
    "conflict",
  );
  assert.equal(
    assignmentOutcome(recovery({ inbound: null, assignments: [] }, id(2)), p),
    "unavailable",
  );
});
test("review projection drops raw HTML, attachment URLs and unrelated provider metadata", () => {
  const value = recovery(
    {
      inbound: {
        ...inbound,
        html_body: "<img src='https://tracker.test'>",
        attachment_metadata: [{ url: "https://private.test" }],
        resource_id: "provider-private",
      },
      assignments: [],
    },
    id(2),
  );
  assert.equal(value.inbound?.body, inbound.body);
  assert.equal("html_body" in value.inbound!, false);
  assert.equal("attachment_metadata" in value.inbound!, false);
  assert.throws(() =>
    recovery({ inbound: { ...inbound, id: id(8) }, assignments: [] }, id(2)),
  );
});
