import { test } from "node:test";
import assert from "node:assert/strict";
import {
  reviewAction,
  reviewIntent,
  historyPage,
  candidatePage,
} from "../../src/hub/features/imports/attachment-original-review-state.ts";
import {
  actor,
  pet,
  client,
  request,
  at,
  record,
  candidate,
  approvalIntent,
} from "./attachment-review-fixture.ts";
const action = () => ({
  id: request,
  action: "approve",
  actor_id: actor,
  pet_id: pet,
  request_hash: "b".repeat(64),
  status: "committed",
  created_at: at,
  record: record(),
  acknowledgment: null,
  withdrawal: null,
});
test("exact historical original approval validates without current source head", () => {
  assert.equal(
    reviewAction(action(), pet, actor, reviewIntent(approvalIntent(), pet))
      ?.record?.source_current_at_review,
    false,
  );
});
test("action owner patient immutable reason and capture substitutions fail closed", () => {
  for (const a of [
    { ...action(), actor_id: client },
    { ...action(), pet_id: client },
    { ...action(), record: { ...record(), capture_hash: "b".repeat(64) } },
    { ...action(), record: { ...record(), review_reason: "changed" } },
  ])
    assert.throws(() =>
      reviewAction(a, pet, actor, reviewIntent(approvalIntent(), pet)),
    );
});
test("abandoned action has no result and retains exact action identity", () => {
  assert.equal(
    reviewAction(
      { ...action(), status: "abandoned", record: null },
      pet,
      actor,
      reviewIntent(approvalIntent(), pet),
    )?.status,
    "abandoned",
  );
  assert.throws(() =>
    reviewAction(
      { ...action(), status: "abandoned" },
      pet,
      actor,
      reviewIntent(approvalIntent(), pet),
    ),
  );
});
test("candidate source and admitted capture associations reject tampering", () => {
  const c = candidate();
  assert.equal(
    candidatePage({ candidates: [c], has_more: false, next_cursor: null }, pet)
      .candidates.length,
    1,
  );
  assert.throws(() =>
    candidatePage(
      {
        candidates: [{ ...c, source_file_id: "9" }],
        has_more: false,
        next_cursor: null,
      },
      pet,
    ),
  );
  assert.throws(() =>
    candidatePage(
      {
        candidates: [
          { ...c, metadata: { ...c.metadata, file_download_url: "secret" } },
        ],
        has_more: false,
        next_cursor: null,
      },
      pet,
    ),
  );
});
test("history retains exact withdrawn version and earlier acknowledgment", () => {
  const r = record();
  const ack = {
    id: client,
    action_id: client,
    record_id: r.id,
    pet_id: pet,
    actor_id: actor,
    record_hash: r.record_hash,
    capture_hash: r.capture_hash,
    created_at: at,
  };
  const row = {
    record: r,
    latest_record_id: r.id,
    is_latest: true,
    withdrawal: {
      id: request,
      action_id: request,
      record_id: r.id,
      pet_id: pet,
      actor_id: actor,
      record_hash: r.record_hash,
      reason: "Incorrect association",
      created_at: at,
    },
    acknowledgments: [ack],
  };
  assert.equal(
    historyPage(
      { pet_id: pet, records: [row], has_more: false, next_cursor: null },
      pet,
    ).records[0].acknowledgments.length,
    1,
  );
  assert.throws(() =>
    historyPage(
      {
        pet_id: pet,
        records: [
          {
            ...row,
            acknowledgments: [{ ...ack, capture_hash: "b".repeat(64) }],
          },
        ],
        has_more: false,
        next_cursor: null,
      },
      pet,
    ),
  );
});
test("wrong patient intents and added capabilities are rejected", () => {
  assert.throws(() => reviewIntent(approvalIntent(), client));
  assert.throws(() =>
    reviewIntent(
      {
        ...approvalIntent(),
        args: { ...approvalIntent().args, object_path: "secret" },
      },
      pet,
    ),
  );
});
