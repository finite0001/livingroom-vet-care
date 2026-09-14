import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAttachmentChart } from "../../src/hub/features/imports/attachment-chart-state.ts";
const pet = "11111111-1111-4111-8111-111111111111",
  id = "22222222-2222-4222-8222-222222222222",
  older = "33333333-3333-4333-8333-333333333333";
function row(version = 2) {
  return {
    is_latest: version === 2,
    source_current: false,
    record: {
      id: version === 2 ? id : older,
      actor_id: pet,
      request_id: pet,
      pet_id: pet,
      animal_link_id: pet,
      source_origin: "https://api.trial.ezyvet.com",
      source_site_uid: "synthetic",
      attachment_external_id: "7",
      request_hash: "a".repeat(64),
      capture_hash: "b".repeat(64),
      title: "Reviewed original",
      review_reason: "Verified patient",
      previous_record_id: version === 2 ? older : null,
      version,
      entry_method: "staff_reviewed_api_attachment_v2",
      record_hash: "c".repeat(64),
      created_at: `2026-09-14T12:00:00.12345${version}Z`,
    },
  };
}
function page() {
  return { pet_id: pet, records: [row()], has_more: false, next_cursor: null };
}
test("chart binds patient and retains independent latest versus stale flags", () => {
  const result = parseAttachmentChart(page(), pet, null);
  assert.equal(result.records[0].is_latest, true);
  assert.equal(result.records[0].source_current, false);
  assert.throws(() =>
    parseAttachmentChart({ ...page(), pet_id: id }, pet, null),
  );
  assert.throws(() =>
    parseAttachmentChart(
      {
        ...page(),
        records: [{ ...row(), record: { ...row().record, pet_id: id } }],
      },
      pet,
      null,
    ),
  );
  assert.throws(() =>
    parseAttachmentChart(
      {
        ...page(),
        records: [
          { ...row(), record: { ...row().record, source_context: {} } },
        ],
      },
      pet,
      null,
    ),
  );
});
test("chart rejects duplicate or inconsistent review lineage and currentness claims", () => {
  assert.equal(
    parseAttachmentChart({ ...page(), records: [row(), row(1)] }, pet, null)
      .records.length,
    2,
  );
  for (const records of [
    [row(), row()],
    [row(1), row()],
    [row(), { ...row(1), is_latest: true }],
    [{ ...row(), record: { ...row().record, previous_record_id: null } }],
  ])
    assert.throws(() =>
      parseAttachmentChart({ ...page(), records }, pet, null),
    );
});
test("chart cursor enforces microsecond order and exact last row", () => {
  const cursor = { before_at: row().record.created_at, before_id: id };
  assert.equal(
    parseAttachmentChart({ ...page(), records: [row(1)] }, pet, cursor).records
      .length,
    1,
  );
  assert.throws(() => parseAttachmentChart(page(), pet, cursor));
  assert.throws(() =>
    parseAttachmentChart(
      {
        ...page(),
        has_more: true,
        next_cursor: { ...cursor, before_id: older },
      },
      pet,
      null,
    ),
  );
  assert.equal(
    parseAttachmentChart(
      { ...page(), has_more: true, next_cursor: cursor },
      pet,
      null,
    ).has_more,
    true,
  );
});
