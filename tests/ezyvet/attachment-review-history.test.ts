import { test } from "node:test";
import assert from "node:assert/strict";
import { validateCapture } from "../../src/hub/features/imports/attachment-capture-state.ts";
import { parseReviewHistory } from "../../src/hub/features/imports/attachment-review-history.ts";
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
const capture = validateCapture({ ...fixture(), status: "ready", retryable: false, capture: receipt }, actor, mapping);
function record(version = 2, created_at = "2026-09-14T12:00:00.123456+00:00") {
  return { id: version === 2 ? id : actor, actor_id: actor, request_id: id, pet_id: id,
    animal_link_id: link, source_origin: mapping.source_origin, source_site_uid: mapping.source_site_uid,
    attachment_external_id: "7", request_hash: capture.request_hash, capture_hash: receipt.capture_hash,
    title: "Reviewed original", review_reason: "Patient and file verified", previous_record_id: version === 2 ? actor : null,
    version, entry_method: "staff_reviewed_api_attachment_v2", record_hash: "f".repeat(64), created_at };
}
function page() {
  return { request_id: id, pet_id: id, animal_link_id: link, attachment_external_id: "7",
    latest_record_id: id, records: [record()], has_more: false, next_cursor: null };
}
test("review history binds patient, source, request and immutable capture receipt", () => {
  assert.equal(parseReviewHistory(page(), capture, null).records.length, 1);
  for (const change of [{ pet_id: actor }, { animal_link_id: actor }, { attachment_external_id: "8" },
    { source_site_uid: "other" }, { source_origin: "https://other.example.test" },
    { request_hash: "a".repeat(64) }, { capture_hash: "a".repeat(64) }, { source_context: {} }])
    assert.throws(() => parseReviewHistory({ ...page(), records: [{ ...record(), ...change }] }, capture, null));
  assert.throws(() => parseReviewHistory({ ...page(), request_id: actor }, capture, null));
  assert.throws(() => parseReviewHistory(page(), { ...capture, status: "prepared" }, null));
});
test("review pagination compares instants across offsets and retains microseconds", () => {
  const cursor = { before_at: "2026-09-14T12:00:00.123457Z", before_id: actor };
  const older = { ...page(), records: [record(1, "2026-09-14T13:00:00.123456+01:00")] };
  assert.equal(parseReviewHistory(older, capture, cursor).records.length, 1);
  assert.throws(() => parseReviewHistory({ ...older, records: [record(1, "2026-09-14T11:00:00.123458-01:00")] }, capture, cursor));
  assert.throws(() => parseReviewHistory({ ...older, records: [record(1, "2026-09-14T13:00:00.123457+01:00")] }, capture, cursor));
});
test("review pages reject duplicates, disorder, malformed timestamps and invented cursors", () => {
  for (const records of [[record(), record()], [record(), record(1, "2026-09-14T12:00:01Z")],
    [record(2, "September 14, 2026")], [record(2, "2026-09-14T12:00:00.1234567Z")]])
    assert.throws(() => parseReviewHistory({ ...page(), records }, capture, null));
  assert.throws(() => parseReviewHistory({ ...page(), latest_record_id: actor }, capture, null));
  assert.throws(() => parseReviewHistory({ ...page(), has_more: true }, capture, null));
  assert.throws(() => parseReviewHistory({ ...page(), has_more: true, next_cursor: { before_at: record().created_at, before_id: actor } }, capture, null));
  assert.equal(parseReviewHistory({ ...page(), has_more: true, next_cursor: { before_at: record().created_at, before_id: id } }, capture, null).has_more, true);
  assert.equal(parseReviewHistory({ ...page(), records: [], latest_record_id: null }, capture, null).records.length, 0);
});
