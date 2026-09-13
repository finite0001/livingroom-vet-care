import { test } from "node:test";
import assert from "node:assert/strict";
import {
  exactTimestamp,
  historyPage,
  matchesReceipt,
  pendingAction,
  resumeIntent,
  verification,
} from "../../src/hub/features/external-records/ExternalRecordState.ts";
const id = (n: number) =>
    `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  date = "2026-09-12T12:00:00.123456+00:00";
const receipt = {
  id: id(1),
  actor_id: id(2),
  animal_link_id: id(3),
  pet_id: id(4),
  pet_version: 2,
  source_origin: "https://example.test",
  source_site_uid: "site",
  source_animal_id: "animal",
  document_id: id(5),
  document_version: 3,
  mime_type: "application/pdf",
  file_size: 30,
  export_reference: "export",
  received_at: date,
  previous_record_id: null,
  review_reason: "Reviewed original",
  receipt_hash: "a".repeat(64),
  entry_method: "staff_reviewed_manual_export_v1" as const,
  created_at: date,
};
const capture = {
  receipt_id: id(1),
  actor_id: id(2),
  receipt_hash: receipt.receipt_hash,
  document_version: 3,
  content_sha256: "b".repeat(64),
  file_size: 30,
  mime_type: "application/pdf",
  capture_hash: "c".repeat(64),
  captured_at: date,
};
test("resume retains exact original microseconds and all immutable stage arguments", () => {
  const p = resumeIntent(receipt, id(2), id(4));
  assert.equal(p.args.p_received_at, date);
  assert.equal(p.args.p_id, id(1));
  assert.equal(
    matchesReceipt(
      { ...receipt, received_at: "2026-09-12T06:00:00.123456-06:00" },
      p,
    ),
    true,
  );
  assert.equal(
    matchesReceipt(
      { ...receipt, received_at: "2026-09-12T12:00:00.123457Z" },
      p,
    ),
    false,
  );
  assert.equal(
    exactTimestamp("2026-09-12T12:00:00Z"),
    exactTimestamp("2026-09-12T12:00:00.000000+00:00"),
  );
  assert.throws(() => resumeIntent(receipt, id(7), id(4)));
  assert.throws(() => exactTimestamp("2026-02-30T12:00:00Z"));
  assert.throws(() =>
    pendingAction(
      { ...p, args: { ...p.args, p_content_sha256: "b".repeat(64) } },
      id(4),
    ),
  );
  assert.throws(() =>
    pendingAction(
      {
        ...p,
        args: { ...p.args, p_received_at: "2026-09-12T12:00:00.1234567Z" },
      },
      id(4),
    ),
  );
});
test("receipt and capture enforce actor, patient, identity, document and original bytes", () => {
  assert.ok(verification({ receipt, capture, record: null }, id(4), id(2)));
  assert.throws(() =>
    verification({ receipt, capture, record: null }, id(8), id(2)),
  );
  assert.throws(() =>
    verification({ receipt, capture, record: null }, id(4), id(8)),
  );
  for (const changes of [
    { file_size: 31 },
    { document_version: 4 },
    { receipt_hash: "d".repeat(64) },
  ])
    assert.throws(() =>
      verification(
        { receipt, capture: { ...capture, ...changes }, record: null },
        id(4),
      ),
    );
});
test("approval and DVM acknowledgment remain bound to original/replacement version", () => {
  const record = {
    id: id(6),
    actor_id: id(2),
    receipt_id: id(1),
    animal_link_id: id(3),
    pet_id: id(4),
    pet_version: 2,
    document_id: id(5),
    document_version: 3,
    receipt_hash: receipt.receipt_hash,
    capture_hash: capture.capture_hash,
    export_reference: "export",
    previous_record_id: null,
    version: 1,
    kind: "original",
    review_reason: "Reviewed original",
    created_at: date,
  };
  assert.ok(verification({ receipt, capture, record }, id(4)));
  assert.throws(() =>
    verification(
      { receipt, capture, record: { ...record, previous_record_id: id(8) } },
      id(4),
    ),
  );
  const historical = {
    ...record,
    capture,
    provider: "ezyVet",
    entry_method: receipt.entry_method,
    source_origin: receipt.source_origin,
    source_site_uid: receipt.source_site_uid,
    source_animal_id: receipt.source_animal_id,
    received_at: date,
    document_status: "void",
    acknowledgments: [],
  };
  assert.equal(
    historyPage(
      { pet_id: id(4), records: [historical], has_more: false },
      id(4),
    ).records[0].document_status,
    "void",
  );
  const ack = {
    id: id(8),
    actor_id: id(2),
    record_id: id(9),
    capture_hash: capture.capture_hash,
    document_version: 3,
    created_at: date,
  };
  assert.throws(() =>
    historyPage(
      {
        pet_id: id(4),
        records: [{ ...historical, acknowledgments: [ack] }],
        has_more: false,
      },
      id(4),
    ),
  );
});
