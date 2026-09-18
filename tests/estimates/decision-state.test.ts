import { test } from "node:test";
import assert from "node:assert/strict";
import { readPendingEstimateDecision, retainPendingEstimateDecision, resolvePendingEstimateDecision } from "../../src/shared/estimate-decision-state.ts";
const id = (n: number) => `fd620000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function fixture() {
  const data = new Map<string, string>();
  const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, removeItem: (k: string) => { data.delete(k); } };
  const operation = { version: 1, id: id(1), grant_id: id(2), publication_id: id(3), request: {
    binding: { target: { estimate_id: id(4), client_id: id(5), pet_id: id(6) }, publication_id: id(3), content_hash: "a".repeat(64), artifact_hash: "b".repeat(64) },
    grant_id: id(2), expected_publication_head: { event_id: id(3), version: 1, record_hash: "c".repeat(64) }, choice: "decline",
    signer_name: "Synthetic Client", signer_relationship: "owner", comment: null, acknowledgment_version: 1,
    attest_document_review: true, attest_authority: true, attest_choice: true,
  } };
  const closure = { version: 1, status: "closed_unrecorded", closure: {
    version: 1, id: operation.id, grant_id: operation.grant_id, request: operation.request, request_hash: "d".repeat(64),
    closed_at: "2026-09-16T12:00:00Z", record_hash: "e".repeat(64), closed_by: "practice_staff",
  } };
  return { storage, data, operation, closure };
}
test("reload retains original token-free decision intent and only an exact closure clears it", () => {
  const { storage, data, operation, closure } = fixture();
  retainPendingEstimateDecision(storage, operation);
  assert.deepEqual(readPendingEstimateDecision(storage, operation.grant_id), operation);
  assert.equal(data.size, 1);
  assert.equal(JSON.stringify([...data.values()]).includes('token'), false);
  resolvePendingEstimateDecision(storage, operation, closure);
  assert.equal(readPendingEstimateDecision(storage, operation.grant_id), null);
});
test("unrecorded and unavailable recovery preserve pending intent", () => {
  const { storage, operation } = fixture(); retainPendingEstimateDecision(storage, operation);
  for (const evidence of [null, { error: "Unavailable" }, { version: 1, status: "unrecorded" }]) {
    assert.throws(() => resolvePendingEstimateDecision(storage, operation, evidence));
    assert.deepEqual(readPendingEstimateDecision(storage, operation.grant_id), operation);
  }
});
test("replacement intent and late original receipts cannot overwrite or clear another pending request", () => {
  const { storage, data, operation, closure } = fixture(); retainPendingEstimateDecision(storage, operation);
  const other = { ...operation, id: id(9) };
  assert.throws(() => retainPendingEstimateDecision(storage, other));
  storage.setItem([...data.keys()][0], JSON.stringify(other));
  assert.throws(() => resolvePendingEstimateDecision(storage, operation, closure));
  assert.deepEqual(readPendingEstimateDecision(storage, operation.grant_id), other);
});
test("corruption is not absence and cannot be silently replaced", () => {
  const { storage, data, operation } = fixture(); retainPendingEstimateDecision(storage, operation);
  storage.setItem([...data.keys()][0], "malformed");
  assert.throws(() => readPendingEstimateDecision(storage, operation.grant_id));
  assert.throws(() => retainPendingEstimateDecision(storage, operation));
  assert.deepEqual([...data.values()], ["malformed"]);
});
test("storage failure and silently dropped writes block submission before any request", () => {
  const { storage, operation } = fixture();
  assert.throws(() => retainPendingEstimateDecision({ ...storage, setItem() { throw new Error("quota"); } }, operation));
  assert.throws(() => retainPendingEstimateDecision({ ...storage, setItem() {} }, operation));
});
test("expanded token-bearing intent is rejected before storage", () => {
  const { storage, data, operation } = fixture();
  assert.throws(() => retainPendingEstimateDecision(storage, { ...operation, token: "e1.secret" }));
  assert.equal(data.size, 0);
});
