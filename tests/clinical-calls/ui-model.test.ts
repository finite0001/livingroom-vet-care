import assert from "node:assert/strict";
import test from "node:test";
import { pendingCallSchema, callCaptureIntentSchema, verifyPendingCall, verifyCallCapture, verifyCallPolicy, verifyCallSource, callPolicyRequestSchema, callFeedback, summarizeCallSource, CallSourceError } from "../../src/hub/features/clinical/call-drafts/model.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = id(1), pet = id(2), encounter = id(3), action = id(4), inbound = id(5), at = "2026-10-17T04:00:00.000000Z";
const request = callCaptureIntentSchema.parse({ pet_id: pet, expected_pet_version: 2, encounter_id: encounter, expected_encounter_version: 3, inbound_id: inbound, expected_inbound_version: 4, policy_version: 1, attest_authorized: true });
const pending = pendingCallSchema.parse({ actor_id: actor, action_id: action, request });
const policy = { version: 2, status: "approved", consent_text: "Approved synthetic call evidence only.", retention_text: "Synthetic retention.", reviewed_by: actor, reviewed_at: at, created_at: at };
function readFixture() {
  return { action: { id: action, actor_id: actor, request, state: "pending", source_id: null, error_code: null, lease_until: null, created_at: at, finished_at: null }, source: null, policy };
}
function sourceFixture() {
  const source = { id: id(6), capture_id: action, actor_id: actor, pet_id: pet, encounter_id: encounter, client_id: id(7), conversation_id: id(8), call_uuid: "synthetic-call", call_id: "123", policy_version: 1, sha256: "a".repeat(64), created_at: at,
    context: { client_id: id(7), conversation_id: id(8), message_id: id(9), call_uuid: "synthetic-call", call_id: "123", call_started_at: null, call_ended_at: at, call_last_event_at: at, inbound_version: 4 },
    document: { contract_version: "clinical-call-source-v1", provider_schema_version: "cloudtalk-ci-transcription-v1", completeness: "observed_two_pass", call_id: "123", language: "en", callers: [{ type: "contact", id: null, localIdentifier: "speaker-original" }], segments: [{ ordinal: 1, start: 0, end: 1, caller: "speaker-original", text: "Fictional owner report.", text_sha256: "b".repeat(64), projection_from: 0, projection_to: 23 }], projection: "Fictional owner report.", pages: [1, 2].map((pass) => ({ pass, offset: 0, limit: 100, total: 1, count: 1, sha256: "c".repeat(64), retrieved_at: at, normalized_json: JSON.stringify({ data: { callId: 123, language: "en", callers: [{ type: "contact", id: null, localIdentifier: "speaker-original" }], segments: [{ start: 0, end: 1, caller: "speaker-original", text: "Fictional owner report." }] }, pagination: { limit: 100, offset: 0, total: 1 } }) })), captured_from: at, captured_until: at } };
  return source;
}
test("call recovery storage permits only exact nonclinical scope and rejects transcript or wrong actor/patient/encounter", () => {
  assert.deepEqual(verifyPendingCall(pending, actor, pet, encounter), pending);
  for (const patch of [{ transcript: "private call" }, { source_text: "private call" }, { actor_id: id(9) }]) assert.throws(() => verifyPendingCall({ ...pending, ...patch }, actor, pet, encounter));
  for (const patch of [{ pet_id: id(9) }, { encounter_id: id(9) }, { transcript: "private call" }, { attest_authorized: false }]) assert.throws(() => verifyPendingCall({ ...pending, request: { ...request, ...patch } }, actor, pet, encounter));
});
test("capture response cannot substitute a different action, owner, destination or exact expected version", () => {
  const read = readFixture();
  assert.equal(verifyCallCapture(read, pending).action.state, "pending");
  for (const patch of [{ id: id(9) }, { actor_id: id(9) }, { request: { ...request, pet_id: id(9) } }, { request: { ...request, expected_encounter_version: 99 } }, { request: null }]) assert.throws(() => verifyCallCapture({ ...read, action: { ...read.action, ...patch } }, pending));
});
test("complete call receipt binds retained source, capture, operator, patient, encounter and policy", () => {
  const read = readFixture(), source = sourceFixture();
  const completed = { ...read, action: { ...read.action, state: "completed", source_id: source.id }, source };
  assert.equal(verifyCallCapture(completed, pending).source?.id, source.id);
  for (const patch of [{ capture_id: id(9) }, { actor_id: id(9) }, { pet_id: id(9) }, { encounter_id: id(9) }, { policy_version: 99 }, { id: id(9) }, { call_id: "456" }]) assert.throws(() => verifyCallCapture({ ...completed, source: { ...source, ...patch } }, pending));
  assert.throws(() => verifyCallCapture({ ...completed, source: null }, pending));
  assert.throws(() => verifyCallCapture({ ...read, source }, pending));
  assert.throws(() => verifyCallSource(source, id(9)));
  for (const patch of [{ call_id: "456" }, { call_uuid: "different-call" }, { client_id: id(10) }, { conversation_id: id(10) }]) assert.throws(() => verifyCallSource({ ...source, context: { ...source.context, ...patch } }, pet));
});
test("call policy requests require explicit approval and recovered receipts bind original version, reviewer and wording", () => {
  const p = { actor_id: actor, action_id: action, expected_version: 1 };
  const input = callPolicyRequestSchema.parse({ expected_version: 1, status: "approved", consent_text: policy.consent_text, retention_text: policy.retention_text, attest_reviewed: true });
  assert.equal(verifyCallPolicy(policy, p, input).version, 2);
  assert.throws(() => callPolicyRequestSchema.parse({ ...input, attest_reviewed: false }));
  for (const patch of [{ version: 3 }, { reviewed_by: id(9) }, { reviewed_at: null }, { consent_text: "Different use." }, { retention_text: "Different retention." }]) assert.throws(() => verifyCallPolicy({ ...policy, ...patch }, p, input));
});
test("call errors expose bounded workflow guidance without raw transcript/provider/database text", () => {
  const privateText = "PRIVATE OWNER AND PATIENT TRANSCRIPT";
  assert.ok(callFeedback(new CallSourceError("capture_disabled")).includes("not activated"));
  assert.ok(callFeedback({ code: "PT409", message: privateText }).includes("changed"));
  assert.equal(callFeedback(new Error(privateText)).includes(privateText), false);
  assert.equal(callFeedback({ code: "unknown", message: privateText }).includes(privateText), false);
});
test("recent source metadata omits the complete document and its private transcript", () => {
  const source = verifyCallSource(sourceFixture(), pet);
  const summary = summarizeCallSource(source);
  assert.equal("document" in summary, false);
  assert.equal(summary.id, source.id);
  assert.equal(summary.sha256, source.sha256);
  assert.equal(JSON.stringify(summary).includes("Fictional owner report."), false);
});
