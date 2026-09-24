import { test } from "node:test";
import assert from "node:assert/strict";
import {
  estimateClientDecisionRequestSchema,
  estimateClientDecisionOperationSchema,
  estimatePublicDecisionReceiptSchema,
  estimateWitnessedDecisionRequestSchema,
  verifyEstimateDecisionResolution,
} from "../../supabase/functions/_shared/estimate-decision-contract.ts";

const id = (n: number) => `fd610000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = "a".repeat(64), time = "2026-09-16T12:00:00.000001Z";
function fixture() {
  const binding = { target: { estimate_id: id(1), client_id: id(2), pet_id: id(3) },
    publication_id: id(4), content_hash: hash, artifact_hash: hash };
  const request = { binding, grant_id: id(5), expected_publication_head: { event_id: id(4), version: 1, record_hash: hash },
    choice: "accept", signer_name: "Synthetic Client", signer_relationship: "owner", comment: null,
    acknowledgment_version: 1, attest_document_review: true, attest_authority: true, attest_choice: true };
  const operation = { version: 1, id: id(6), grant_id: id(5), publication_id: id(4), request };
  const receipt = { version: 1, id: id(6), grant_id: id(5), request, request_hash: hash, created_at: time,
    result: { version: 1, id: id(6), sequence: 1, binding, choice: "accept", signer_name: request.signer_name,
      signer_relationship: "owner", comment: null, acknowledgment_version: 1,
      attribution: "link_holder", recorded_at: time, record_hash: hash } };
  return { request, operation, receipt };
}
test("client evidence verifies exact accepted and declined requests, independent of object order", () => {
  for (const choice of ["accept", "decline"]) {
    const f = fixture(); f.request.choice = choice; f.receipt.result.choice = choice;
    const response = { version: 1, status: "recorded", receipt: f.receipt };
    const reordered = Object.fromEntries(Object.entries(f.operation).reverse());
    assert.equal(verifyEstimateDecisionResolution(response, reordered, true).status, "recorded");
  }
});
test("public response refuses private staff fields and fabricated witness attribution", () => {
  const { receipt } = fixture();
  for (const result of [{ ...receipt.result, actor_id: id(9) }, { ...receipt.result, witness_note: "internal" },
    { ...receipt.result, attribution: "practice_staff_witness" }]) {
    assert.equal(estimatePublicDecisionReceiptSchema.safeParse({ ...receipt, result }).success, false);
  }
});
test("wrong original operation, household, choice and grant never resolve a pending write", () => {
  for (const alter of [
    (f: ReturnType<typeof fixture>) => { f.receipt.id = id(8); f.receipt.result.id = id(8); },
    (f: ReturnType<typeof fixture>) => { f.receipt.request.binding.target.client_id = id(8); },
    (f: ReturnType<typeof fixture>) => { f.receipt.result.choice = "decline"; },
    (f: ReturnType<typeof fixture>) => { f.receipt.grant_id = id(8); },
  ]) {
    const f = fixture(), original = structuredClone(f.operation); alter(f);
    assert.throws(() => verifyEstimateDecisionResolution({ version: 1, status: "recorded", receipt: f.receipt }, original));
  }
});
test("point-in-time absence cannot satisfy terminal closure", () => {
  const { operation } = fixture();
  const absent = { version: 1, status: "unrecorded" };
  assert.equal(verifyEstimateDecisionResolution(absent, operation).status, "unrecorded");
  assert.throws(() => verifyEstimateDecisionResolution(absent, operation, true));
  assert.throws(() => verifyEstimateDecisionResolution(null, operation));
});
test("staff reconciliation can close exact client intent without exposing the staff identity", () => {
  const { operation, request } = fixture();
  const closure = { version: 1, id: operation.id, grant_id: operation.grant_id, request, request_hash: hash,
    closed_at: time, record_hash: hash, closed_by: "practice_staff" };
  assert.equal(verifyEstimateDecisionResolution({ version: 1, status: "closed_unrecorded", closure }, operation, true).status, "closed_unrecorded");
  assert.throws(() => verifyEstimateDecisionResolution({ version: 1, status: "closed_unrecorded", closure: { ...closure, actor_id: id(9) } }, operation));
});
test("pending state cannot contain a bearer token or switch publication identity", () => {
  const { operation } = fixture();
  assert.equal(estimateClientDecisionOperationSchema.safeParse({ ...operation, token: "e1.secret" }).success, false);
  assert.equal(estimateClientDecisionOperationSchema.safeParse({ ...operation, publication_id: id(9) }).success, false);
  assert.equal(estimateClientDecisionOperationSchema.safeParse({ ...operation, request: { ...operation.request, token: "secret" } }).success, false);
});
test("signer input rejects malformed Unicode, controls and missing explicit attestations", () => {
  const { request } = fixture();
  for (const signer_name of ["", " Synthetic", "Client\rName", "\ud800", "X".repeat(201)]) {
    assert.equal(estimateClientDecisionRequestSchema.safeParse({ ...request, signer_name }).success, false);
  }
  assert.equal(estimateClientDecisionRequestSchema.safeParse({ ...request, signer_name: "Client 🐾" }).success, true);
  assert.equal(estimateClientDecisionRequestSchema.safeParse({ ...request, attest_authority: false }).success, false);
});
test("witnessed requests cannot borrow a client capability", () => {
  const { request } = fixture();
  const witness = { channel: "telephone", occurred_at: time, note: "Client explicitly declined the estimate.", attest_direct_client_instruction: true };
  assert.equal(estimateWitnessedDecisionRequestSchema.safeParse({ decision: request, witness }).success, false);
  assert.equal(estimateWitnessedDecisionRequestSchema.safeParse({ decision: { ...request, grant_id: null }, witness }).success, true);
  assert.equal(estimateWitnessedDecisionRequestSchema.safeParse({ decision: { ...request, grant_id: null }, witness: { ...witness, actor_id: id(9) } }).success, false);
});
