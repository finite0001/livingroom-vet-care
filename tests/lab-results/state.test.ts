import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pendingLabAction,
  receiptMatchesIntent,
  resultHistory,
  verification,
  matchingSource,
  resumeReceiptIntent,
} from "../../src/hub/features/lab-work/LabResultState.ts";
import { clearOtherInvoiceEmailIntents } from "../../src/hub/contexts/session-draft-retention.ts";
const id = (n: number) =>
  `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const date = "2026-09-12T12:00:00.123Z";
const receipt = {
  id: id(1),
  actor_id: id(2),
  source_account_id: id(3),
  document_id: id(4),
  document_version: 1,
  pet_id: id(5),
  source_patient_reference: "patient",
  source_order_reference: "order",
  source_report_reference: "report",
  received_at: date,
  mime_type: "application/pdf",
  file_size: 12,
  receipt_hash: "a".repeat(64),
  entry_method: "staff_entered_v1",
  created_at: date,
};
const capture = {
  receipt_id: id(1),
  actor_id: id(2),
  receipt_hash: "a".repeat(64),
  document_version: 1,
  content_sha256: "b".repeat(64),
  file_size: 12,
  mime_type: "application/pdf",
  capture_hash: "c".repeat(64),
  captured_at: date,
};
const args = {
  p_id: id(1),
  p_source_account_id: id(3),
  p_document_id: id(4),
  p_document_version: 1,
  p_source_patient_reference: "patient",
  p_source_order_reference: "order",
  p_source_report_reference: "report",
  p_received_at: date,
};
test("verification intent rejects manual hashes, foreign scope and timestamp precision corruption", () => {
  const p = pendingLabAction({ kind: "verify", args }, id(5), id(6));
  assert.equal(
    receiptMatchesIntent(
      verification({ receipt, capture, report: null }, id(5))!.receipt,
      p,
    ),
    true,
  );
  for (const extra of [
    { p_content_sha256: "b".repeat(64) },
    { p_received_at: "2026-09-12T12:00:00.123001Z" },
  ])
    assert.throws(() =>
      pendingLabAction(
        { kind: "verify", args: { ...args, ...extra } },
        id(5),
        id(6),
      ),
    );
  assert.equal(
    receiptMatchesIntent(
      {
        ...receipt,
        entry_method: "staff_entered_v1",
        received_at: "2026-09-12T12:00:00.123000+00:00",
      },
      p,
    ),
    true,
  );
  assert.equal(
    receiptMatchesIntent(
      {
        ...receipt,
        entry_method: "staff_entered_v1",
        received_at: "2026-09-12T12:00:00.123001+00:00",
      },
      p,
    ),
    false,
  );
  assert.equal(
    receiptMatchesIntent(
      {
        ...receipt,
        entry_method: "staff_entered_v1",
        source_report_reference: "changed",
      },
      p,
    ),
    false,
  );
});
test("capture cannot authorize foreign patient, actor, receipt or document bytes", () => {
  assert.throws(() => verification({ receipt, capture, report: null }, id(7)));
  assert.throws(() =>
    verification({ receipt, capture, report: null }, id(5), id(7)),
  );
  for (const change of [
    { receipt_id: id(9) },
    { document_version: 2 },
    { receipt_hash: "d".repeat(64) },
    { file_size: 13 },
    { mime_type: "image/png" },
  ])
    assert.throws(() =>
      verification(
        { receipt, capture: { ...capture, ...change }, report: null },
        id(5),
      ),
    );
});
test("correction acknowledgment stays bound to exact report and verified document version", () => {
  const report = {
    id: id(8),
    actor_id: id(2),
    created_at: date,
    order_id: id(6),
    pet_id: id(5),
    order_version: 1,
    source_review_id: id(9),
    receipt_id: id(1),
    receipt_hash: receipt.receipt_hash,
    capture_hash: capture.capture_hash,
    document_id: id(4),
    document_version: 1,
    previous_report_id: null,
    version: 1,
    kind: "original",
    review_reason: "Reviewed",
    capture,
    document_status: "ready",
    acknowledgments: [],
  };
  const h = {
    pet_id: id(5),
    order_id: id(6),
    sources: [],
    staged_receipts: [],
    source_reviews: [],
    reports: [report],
  };
  assert.equal(resultHistory(h, id(5), id(6)).reports.length, 1);
  const ack = {
    id: id(10),
    actor_id: id(2),
    created_at: date,
    report_id: id(11),
    capture_hash: capture.capture_hash,
    document_version: 1,
  };
  assert.throws(() =>
    resultHistory(
      { ...h, reports: [{ ...report, acknowledgments: [ack] }] },
      id(5),
      id(6),
    ),
  );
  const r = verification({ receipt, capture, report: null }, id(5))!.receipt;
  const mapping = {
    id: id(9),
    actor_id: id(2),
    created_at: date,
    order_id: id(6),
    pet_id: id(5),
    order_version: 1,
    source_account_id: id(3),
    source_patient_reference: "patient",
    source_order_reference: "order",
    previous_review_id: null,
    revision: 1,
    review_reason: "Compared",
  };
  assert.equal(matchingSource(r, mapping), true);
  assert.equal(
    matchingSource(r, { ...mapping, source_account_id: id(10) }),
    false,
  );
});
test("pending clinical result actions are removed on signout and actor change", () => {
  const items = new Map([
    [`lab-result-intent:${id(2)}:pet:order`, "draft"],
    [`lab-result-intent:${id(3)}:pet:order`, "other"],
    ["unrelated", "keep"],
  ]);
  const storage = {
    get length() {
      return items.size;
    },
    key: (i: number) => [...items.keys()][i] ?? null,
    removeItem: (k: string) => {
      items.delete(k);
    },
  };
  clearOtherInvoiceEmailIntents(storage, id(2));
  assert.equal(items.size, 2);
  clearOtherInvoiceEmailIntents(storage, null);
  assert.deepEqual([...items.keys()], ["unrelated"]);
});

test("actor-owned incomplete receipt resumes unchanged after local storage cleanup", () => {
  const r = verification(
    { receipt, capture: null, report: null },
    id(5),
  )!.receipt;
  const p = resumeReceiptIntent(
    { ...r, received_at: "2026-09-12T12:00:00.123000+00:00" },
    id(2),
    id(5),
    id(6),
  );
  assert.deepEqual(p.args, args);
  assert.throws(() => resumeReceiptIntent(r, id(7), id(5), id(6)));
  assert.throws(() =>
    resumeReceiptIntent(
      { ...r, received_at: "2026-09-12T12:00:00.123001+00:00" },
      id(2),
      id(5),
      id(6),
    ),
  );
});
