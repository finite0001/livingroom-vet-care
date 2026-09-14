import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateCapture,
  capturePage,
  intentOf,
  canAdvanceCapture,
  captureIntentSchema,
} from "../../src/hub/features/imports/attachment-capture-state.ts";
const actor = "11111111-1111-4111-8111-111111111111",
  id = "22222222-2222-4222-8222-222222222222",
  link = "33333333-3333-4333-8333-333333333333";
const mapping = {
  link_id: link,
  pet_id: id,
  external_id: "22",
  source_origin: "https://api.trial.ezyvet.com",
  source_site_uid: "synthetic",
};
function fixture() {
  return {
    id,
    requested_by: actor,
    animal_link_id: link,
    pet_id: id,
    client_id: actor,
    run_id: id,
    page: 1,
    ordinal: 1,
    snapshot_id: id,
    observed_head_version: 1,
    external_id: "7",
    file_id: "8",
    stable_metadata_sha256: "a".repeat(64),
    raw_record_sha256: "b".repeat(64),
    metadata: {
      id: "7",
      file_id: "8",
      record_type: "Animal",
      record_id: "22",
      name: "synthetic",
    },
    parent_context: {
      animal_link_id: link,
      pet_id: id,
      client_id: actor,
      animal_external_id: "22",
      source_origin: mapping.source_origin,
      source_site_uid: mapping.source_site_uid,
      parent_type: "Animal",
      parent_external_id: "22",
      parent_snapshot_id: id,
      parent_payload_hash: "a".repeat(64),
      parent_observed_head_version: 1,
    },
    request_hash: "c".repeat(64),
    status: "prepared",
    source_current: true,
    lease_active: false,
    retry_after: null,
    last_error_code: null,
    retryable: true,
    created_at: "2026-09-13T12:00:00Z",
    updated_at: "2026-09-13T12:00:00Z",
    capture: null,
  };
}
const receipt = {
  id,
  request_id: id,
  entry_method: "ezyvet_api_attachment_original_v1",
  content_sha256: "d".repeat(64),
  mime_type: "application/pdf",
  file_size: 20,
  capture_hash: "e".repeat(64),
  captured_at: "2026-09-13T12:00:00Z",
};
test("capture intent binds exact observation and refuses injected fields", () => {
  const c = validateCapture(fixture(), actor, mapping);
  assert.equal(canAdvanceCapture(c), true);
  assert.deepEqual(validateCapture(c, actor, mapping, intentOf(c)), c);
  assert.throws(() =>
    validateCapture(c, actor, mapping, { ...intentOf(c), p_ordinal: 2 }),
  );
  assert.throws(() =>
    captureIntentSchema.parse({ ...intentOf(c), file_download_url: "secret" }),
  );
});
test("capture projection rejects cross actor mapping source file and parent substitutions", () => {
  const c = fixture();
  for (const changed of [
    { ...c, requested_by: id },
    { ...c, animal_link_id: id },
    { ...c, file_id: "9" },
    { ...c, parent_context: { ...c.parent_context, source_site_uid: "other" } },
    { ...c, metadata: { ...c.metadata, record_id: "23" } },
    { ...c, parent_context: { ...c.parent_context, client_id: id } },
  ])
    assert.throws(() => validateCapture(changed, actor, mapping));
});
test("ready historical captures retain verified receipt and cannot advance", () => {
  const c = validateCapture(
    {
      ...fixture(),
      status: "ready",
      source_current: false,
      retryable: false,
      capture: receipt,
    },
    actor,
    mapping,
  );
  assert.equal(canAdvanceCapture(c), false);
  assert.equal(c.capture?.entry_method, "ezyvet_api_attachment_original_v1");
});
test("receipt state and immutable request association are enforced", () => {
  for (const changed of [
    { ...fixture(), status: "ready" },
    { ...fixture(), capture: receipt },
    {
      ...fixture(),
      status: "ready",
      retryable: false,
      capture: { ...receipt, request_id: actor },
    },
    { ...fixture(), status: "blocked", retryable: true },
    { ...fixture(), source_current: false, retryable: true },
  ])
    assert.throws(() => validateCapture(changed, actor, mapping));
});
test("unknown capability fields and manual export provenance are rejected", () => {
  const c = fixture();
  for (const changed of [
    { ...c, lease_id: id },
    { ...c, metadata: { ...c.metadata, file_download_url: "https://secret" } },
    {
      ...c,
      status: "ready",
      retryable: false,
      capture: { ...receipt, entry_method: "staff_reviewed_manual_export_v1" },
    },
  ])
    assert.throws(() => validateCapture(changed, actor, mapping));
});
test("lease and cooldown gate retries independently of retryable state", () => {
  const c = validateCapture(fixture(), actor, mapping);
  assert.equal(canAdvanceCapture({ ...c, lease_active: true }), false);
  assert.equal(
    canAdvanceCapture({ ...c, retry_after: "2099-01-01T00:00:00Z" }),
    false,
  );
  assert.equal(canAdvanceCapture({ ...c, status: "reserved" }), true);
});
test("history cursor must identify final returned request", () => {
  const c = fixture();
  assert.equal(
    capturePage(
      { captures: [c], has_more: false, next_cursor: null },
      actor,
      mapping,
    ).captures.length,
    1,
  );
  assert.throws(() =>
    capturePage(
      {
        captures: [c],
        has_more: true,
        next_cursor: { before_at: c.created_at, before_id: actor },
      },
      actor,
      mapping,
    ),
  );
  assert.throws(() =>
    capturePage(
      { captures: [], has_more: true, next_cursor: null },
      actor,
      mapping,
    ),
  );
});
