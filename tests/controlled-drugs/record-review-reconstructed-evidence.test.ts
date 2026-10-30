import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { decodeExactJson, ExactJsonNumber, type ExactJson } from "../../src/hub/features/controlled-drugs/record-review/exact-json.ts";
import { createReconstructedReviewEvidence, sameLosslessReviewValue } from "../../src/hub/features/controlled-drugs/record-review/reconstructed-evidence.ts";
import { reviewPreparedResponseSchema } from "../../src/hub/features/controlled-drugs/record-review/prepared-packet.ts";
import { reviewDetailResponseSchema } from "../../src/hub/features/controlled-drugs/record-review/read-detail.ts";
import type { ReviewStaffSessionSource } from "../../src/hub/features/controlled-drugs/record-review/staff-session.ts";
import { sameReviewIdentity } from "../../src/hub/features/controlled-drugs/record-review/raw-rpc.ts";
import { deferred } from "./record-review-lifecycle-fixture.ts";

const rawFixture = () => decodeExactJson(readFileSync(new URL("./record-review-stock-movement-reference.json", import.meta.url)));
const preparedFixture = () => reviewPreparedResponseSchema.parse(rawFixture());
function sessions(actorId: string) {
  let active = true;
  const identity = { actorId, sessionId: "ffffffff-ffff-4fff-8fff-ffffffffffff", generation: 1 };
  const source: ReviewStaffSessionSource = { getSnapshot: () => active ? identity : null, isCurrent: input => active && sameReviewIdentity(identity, input),
    current: async () => null, subscribe: () => () => {} };
  return { source, expire: () => { active = false; } };
}

test("complete comparison preserves numeric spelling, Unicode and array order", () => {
  const a = decodeExactJson(new TextEncoder().encode('{"q":1.250,"list":["é",true,null]}'));
  const b = decodeExactJson(new TextEncoder().encode('{"list":["é",true,null],"q":1.250}'));
  assert.equal(sameLosslessReviewValue(a, b), true);
  for (const token of ["1.25", "125e-2", "1.2500"]) assert.equal(sameLosslessReviewValue(new ExactJsonNumber("1.250"), new ExactJsonNumber(token)), false);
  assert.equal(sameLosslessReviewValue("é", "e\u0301"), false);
  assert.equal(sameLosslessReviewValue(["a", "b"], ["b", "a"]), false);
  assert.equal(sameLosslessReviewValue(1, 1), false);
});

test("complete comparison refuses accessors, custom arrays, cycles and fake number tokens", () => {
  let invoked = false;
  const accessor = Object.defineProperty({}, "x", { enumerable: true, get() { invoked = true; return "x"; } });
  assert.equal(sameLosslessReviewValue(accessor, accessor), false); assert.equal(invoked, false);
  const sparse = Object.assign(new Array(1), { custom: "x" });
  assert.equal(sameLosslessReviewValue(sparse, sparse), false);
  const array = Object.assign(["x"], { extra: "x" }); assert.equal(sameLosslessReviewValue(array, array), false);
  const customArray = Object.setPrototypeOf(["x"], null); assert.equal(sameLosslessReviewValue(customArray, customArray), false);
  const cycle: { self?: unknown } = {}; cycle.self = cycle; assert.equal(sameLosslessReviewValue(cycle, cycle), false);
  assert.equal(sameLosslessReviewValue({ token: "1.250" }, new ExactJsonNumber("1.250")), false);
});

test("prepared evidence requires a fresh owned backend reconstruction and exact complete packet", async () => {
  const f = preparedFixture(), login = sessions(f.data.request.actor_id), calls: unknown[] = [];
  const evidence = createReconstructedReviewEvidence({ async call(method, request) {
    calls.push({ method, request }); return rawFixture();
  } }, login.source);
  await evidence.prepared.validate(f.data.packet, f.data.request);
  assert.deepEqual(calls, [{ method: "get_controlled_record_review_admission_v1", request: { schema_version: 1,
    actor_id: f.data.request.actor_id, event_id: f.data.request.event_id, operation_id: f.data.request.operation_id, view: "prepared" } }]);
  await assert.rejects(evidence.prepared.validate({ ...f.data.packet, original_result: { ...f.data.packet.original_result, unexpected: true } }, f.data.request));
  const unavailable = createReconstructedReviewEvidence({ async call() { throw new Error("Unavailable"); } }, login.source);
  await assert.rejects(unavailable.prepared.validate(f.data.packet, f.data.request));
});

test("reconstruction rejects request substitution and login changes across the read", async () => {
  const f = preparedFixture(), login = sessions(f.data.request.actor_id);
  const evidence = createReconstructedReviewEvidence({ async call() { return rawFixture(); } }, login.source);
  await assert.rejects(evidence.prepared.validate(f.data.packet, { ...f.data.request, reason: "Different reason" }));
  const pending = deferred<ExactJson>();
  const changing = createReconstructedReviewEvidence({ async call() { return pending.promise; } }, login.source);
  const attempt = changing.prepared.validate(f.data.packet, f.data.request); login.expire(); pending.resolve(rawFixture());
  await assert.rejects(attempt);
});

test("read-only exception reconstruction stays read-only and checks the entire response", async () => {
  const f = preparedFixture(), login = sessions(f.data.request.actor_id), event = f.data.packet.event;
  const value = { version: new ExactJsonNumber("3"), state: "exception", data: { summary: {
    event_id: f.data.request.event_id, event_sequence: String(f.data.packet.target.sequence), event_kind: "receive_inventory",
    site_basis: "unproven", site_id: null, observed_at: event.observed_at, recorded_at: event.recorded_at,
    review_state: "not_required", deadline_state: "not_required", deadline_basis: "not_required", due_at: null, unavailable_reason: null,
    signing_state: "blocked", signing_reason: "not_required",
  } } };
  const parsed = reviewDetailResponseSchema.parse(value), calls: unknown[] = [];
  const evidence = createReconstructedReviewEvidence({ async call(method, request) { calls.push({ method, request }); return value as ExactJson; } }, login.source);
  const request = { actor_id: f.data.request.actor_id, event_id: f.data.request.event_id };
  await evidence.detail.validate(parsed, request);
  assert.equal(calls.length, 1); assert.deepEqual(calls[0], { method: "get_controlled_record_review_admission_v1", request: { schema_version: 1, ...request, operation_id: null, view: "detail" } });
  await assert.rejects(evidence.detail.validate({ ...parsed, data: { summary: { ...parsed.data.summary, event_sequence: "9223372036854775807" } } }, request));
});
