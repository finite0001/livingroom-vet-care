import { test } from "node:test";
import assert from "node:assert/strict";
import { validateCapture } from "../../src/hub/features/imports/attachment-capture-state.ts";
import {
  parseAttachmentDecision,
  parseAttachmentDecisionOutcome,
} from "../../src/hub/features/imports/attachment-decision-state.ts";
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
const capture = validateCapture(
  { ...fixture(), status: "ready", retryable: false, capture: receipt },
  actor,
  mapping,
);
function operation() {
  return {
    id: actor,
    actor,
    pet: id,
    request: id,
    captureHash: receipt.capture_hash,
    previous: null,
    title: "Reviewed original",
    reason: "Correct patient and source",
  };
}
function outcome() {
  return {
    status: "approved",
    cancellation: null,
    record: {
      id: actor,
      actor_id: actor,
      pet_id: id,
      request_id: id,
      capture_hash: receipt.capture_hash,
      previous_record_id: null,
      title: operation().title,
      review_reason: operation().reason,
      animal_link_id: link,
      request_hash: capture.request_hash,
      source_origin: mapping.source_origin,
      source_site_uid: mapping.source_site_uid,
      attachment_external_id: capture.external_id,
      version: 1,
      entry_method: "staff_reviewed_api_attachment_v2",
      record_hash: "f".repeat(64),
      created_at: "2026-09-14T12:00:00Z",
      source_context: {
        capture_contract: "canonical_api_original_v1",
        parent: capture.parent_context,
        run_id: capture.run_id,
        page: capture.page,
        ordinal: capture.ordinal,
        attachment_snapshot_id: capture.snapshot_id,
        attachment_observed_head_version: capture.observed_head_version,
        attachment_external_id: capture.external_id,
        file_id: capture.file_id,
        stable_metadata_sha256: capture.stable_metadata_sha256,
        raw_record_sha256: capture.raw_record_sha256,
        metadata: capture.metadata,
      },
    },
  };
}
test("decision retries bind actor patient capture predecessor and exact text", () => {
  const op = parseAttachmentDecision(operation(), capture, actor);
  assert.equal(
    parseAttachmentDecisionOutcome(outcome(), op, capture)?.status,
    "approved",
  );
  for (const changed of [
    { actor: id },
    { pet: actor },
    { request: actor },
    { captureHash: "a".repeat(64) },
    { previous: actor },
    { title: " padded " },
    { reason: "" },
  ])
    assert.throws(() =>
      parseAttachmentDecision({ ...operation(), ...changed }, capture, actor),
    );
  for (const changed of [
    { id: id },
    { actor_id: id },
    { pet_id: actor },
    { request_id: actor },
    { previous_record_id: id },
    { title: "Changed" },
    { review_reason: "Changed" },
    { version: 2 },
    { request_hash: "a".repeat(64) },
  ])
    assert.throws(() =>
      parseAttachmentDecisionOutcome(
        { ...outcome(), record: { ...outcome().record, ...changed } },
        op,
        capture,
      ),
    );
});
test("approval recovery binds canonical file ID ordinal metadata and both source hashes", () => {
  const op = parseAttachmentDecision(operation(), capture, actor);
  for (const changed of [
    { file_id: "9" },
    { ordinal: 2 },
    { page: 2 },
    { stable_metadata_sha256: "f".repeat(64) },
    { raw_record_sha256: "f".repeat(64) },
    { metadata: { ...capture.metadata, name: "Changed" } },
    { parent: { ...capture.parent_context, pet_id: actor } },
    { capture_contract: "alternative" },
    { unexpected: true },
  ])
    assert.throws(() =>
      parseAttachmentDecisionOutcome(
        {
          ...outcome(),
          record: {
            ...outcome().record,
            source_context: { ...outcome().record.source_context, ...changed },
          },
        },
        op,
        capture,
      ),
    );
});
test("cancellation recovery is exact and does not masquerade as approval", () => {
  const op = parseAttachmentDecision(operation(), capture, actor);
  const canceled = {
    status: "canceled",
    record: null,
    cancellation: {
      id: actor,
      actor_id: actor,
      request_id: id,
      pet_id: id,
      capture_hash: receipt.capture_hash,
      created_at: "2026-09-14T12:00:00Z",
    },
  };
  assert.equal(
    parseAttachmentDecisionOutcome(canceled, op, capture)?.status,
    "canceled",
  );
  assert.equal(parseAttachmentDecisionOutcome(null, op, capture), null);
  for (const changed of [
    { id: id },
    { actor_id: id },
    { request_id: actor },
    { pet_id: actor },
    { capture_hash: "a".repeat(64) },
  ])
    assert.throws(() =>
      parseAttachmentDecisionOutcome(
        { ...canceled, cancellation: { ...canceled.cancellation, ...changed } },
        op,
        capture,
      ),
    );
  assert.throws(() =>
    parseAttachmentDecisionOutcome(
      { ...canceled, record: outcome().record },
      op,
      capture,
    ),
  );
});
