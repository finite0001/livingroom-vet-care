import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  parseCountManagementRequest, parseCountManagementReceipt, decodeCountManagementRequest,
  type CountManagementAction, type CountManagementMutationAction,
} from "../../src/hub/features/controlled-drugs/count/count-management-schema.ts";
import {
  countManagementRequestBytes, countManagementReceiptBytes, digestCountManagementRequest, digestCountManagementReceipt,
  verifyCountManagementSavedReply, verifyCountManagementNotFound,
} from "../../src/hub/features/controlled-drugs/count/count-management-wire.ts";

interface RequestVector { name: string; action: CountManagementAction; request: unknown; frame_hex: string; sha256: string }
interface ReceiptVector { name: string; action: CountManagementMutationAction; request_name: string; receipt: unknown; saved_reply: unknown; frame_hex: string; sha256: string }
interface InvalidVector { name: string; action: CountManagementAction; request: unknown }
interface RawVersionVector { name: string; raw_json: string; accepted: boolean; expected_sha256: string | null }
interface RawSpellingVector { name: string; raw_json: string; decoded_request: unknown; frame_hex: string; sha256: string }
interface ReceiptMutant { name: string; receipt: unknown; schema_valid: boolean; retained_original_request_binding: boolean }
interface OpaqueVector { receipt: unknown; frame_hex: string; sha256: string; local_public_consistency: boolean; private_result_or_origin_proved: boolean }
interface IndependentVectors {
  request_cases: RequestVector[]; valid_prepare_boundaries: RequestVector[]; valid_changed_requests: RequestVector[];
  invalid_requests: InvalidVector[]; raw_version_cases: RawVersionVector[]; raw_JSON_spellings: RawSpellingVector[];
  public_receipts: ReceiptVector[]; receipt_mutants: ReceiptMutant[]; opaque_structural_case: OpaqueVector;
  not_found_reply: { request_name: string; value: unknown };
  Root_new_codec_used_as_oracle: boolean; SQL_Auth_physical_or_private_opaque_proof: boolean;
}
const bytes = readFileSync(new URL("./count-management-wire-fixtures/independent-vectors.json", import.meta.url));
assert.equal(createHash("sha256").update(bytes).digest("hex"), "1790ef3efebe1fbc99dbb881e8d82bd24b826dd08938e7f82839da024bdbac12");
const vectors = JSON.parse(bytes.toString("utf8")) as IndependentVectors;
assert.equal(vectors.Root_new_codec_used_as_oracle, false);
assert.equal(vectors.SQL_Auth_physical_or_private_opaque_proof, false);
const hex = (value: Uint8Array) => Buffer.from(value).toString("hex");
const encoder = new TextEncoder();
function primary(name: string): RequestVector {
  const matches = vectors.request_cases.filter(v => v.name === name);
  assert.equal(matches.length, 1); return matches[0];
}

test("independently derived literal frames and digests cover every management request and boundary", async t => {
  assert.equal(vectors.request_cases.length, 8);
  assert.equal(vectors.valid_prepare_boundaries.length, 15);
  assert.equal(vectors.valid_changed_requests.length, 11);
  for (const item of [...vectors.request_cases, ...vectors.valid_prepare_boundaries, ...vectors.valid_changed_requests]) await t.test(item.name, async () => {
    assert.deepEqual(parseCountManagementRequest(item.action, item.request), item.request);
    assert.equal(hex(countManagementRequestBytes(item.action, item.request)), item.frame_hex);
    assert.equal(await digestCountManagementRequest(item.action, item.request), item.sha256);
  });
});
test("independently source-classified invalid request values refuse before commitment", async t => {
  assert.equal(vectors.invalid_requests.length, 37);
  for (const item of vectors.invalid_requests) await t.test(item.name, () => {
    assert.throws(() => parseCountManagementRequest(item.action, item.request), error => error instanceof Error && error.message === "Invalid count management wire value");
  });
});
test("independent raw version spellings preserve the parsed PostgreSQL numeric-text1 rule", async t => {
  assert.equal(vectors.raw_version_cases.length, 19);
  // These source vectors vary the schema token of the primary prepare request.
  for (const item of vectors.raw_version_cases) await t.test(item.name, async () => {
    if (!item.accepted) { assert.throws(() => decodeCountManagementRequest("reconciliation_prepare", encoder.encode(item.raw_json))); return; }
    const parsed = decodeCountManagementRequest("reconciliation_prepare", encoder.encode(item.raw_json));
    assert.equal(parsed.schema_version, 1);
    assert.equal(await digestCountManagementRequest("reconciliation_prepare", parsed), item.expected_sha256);
  });
});
test("independent JSON escape cases retain decoded strings and their exact commitments", async t => {
  assert.equal(vectors.raw_JSON_spellings.length, 3);
  for (const item of vectors.raw_JSON_spellings) await t.test(item.name, async () => {
    const parsed = decodeCountManagementRequest("reconciliation_prepare", encoder.encode(item.raw_json));
    assert.deepEqual(parsed, item.decoded_request);
    assert.equal(hex(countManagementRequestBytes("reconciliation_prepare", parsed)), item.frame_hex);
    assert.equal(await digestCountManagementRequest("reconciliation_prepare", parsed), item.sha256);
  });
});
test("all five independent nine-field public receipt vectors match exact bytes and retained requests", async t => {
  assert.equal(vectors.public_receipts.length, 5);
  for (const item of vectors.public_receipts) await t.test(item.name, async () => {
    assert.equal(hex(countManagementReceiptBytes(item.receipt)), item.frame_hex);
    assert.equal(await digestCountManagementReceipt(item.receipt), item.sha256);
    assert.deepEqual(await verifyCountManagementSavedReply(item.action, primary(item.request_name).request, item.saved_reply), item.saved_reply);
  });
});
test("independent recommitted or malformed receipt mutations cannot replace the original request", async t => {
  assert.equal(vectors.receipt_mutants.length, 12);
  for (const item of vectors.receipt_mutants) await t.test(item.name, async () => {
    if (item.schema_valid) parseCountManagementReceipt(item.receipt);
    else assert.throws(() => parseCountManagementReceipt(item.receipt));
    assert.equal(item.retained_original_request_binding, false);
    await assert.rejects(verifyCountManagementSavedReply("reconciliation_prepare", primary("prepare").request, { schema_version: 1, state: "saved", data: { receipt: item.receipt } }));
  });
});
test("public opaque-reference consistency does not pretend to authenticate its hidden private preimage", async () => {
  const item = vectors.opaque_structural_case;
  assert.equal(item.local_public_consistency, true);
  assert.equal(item.private_result_or_origin_proved, false);
  assert.equal(hex(countManagementReceiptBytes(item.receipt)), item.frame_hex);
  assert.equal(await digestCountManagementReceipt(item.receipt), item.sha256);
  await verifyCountManagementSavedReply("reconciliation_prepare", primary("prepare").request, { schema_version: 1, state: "saved", data: { receipt: item.receipt } });
});
test("independent compact not_found response binds only the exact supplied recovery scope", () => {
  const item = vectors.not_found_reply;
  assert.deepEqual(verifyCountManagementNotFound(primary(item.request_name).request, item.value), item.value);
});
