import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { decodeExactJson, ExactJsonNumber, type ExactJson } from "../../src/hub/features/controlled-drugs/record-review/exact-json.ts";
import { verifyReviewDetail, type ReviewDetailEvidenceAdmission } from "../../src/hub/features/controlled-drugs/record-review/read-detail.ts";
import { reviewRequiredPacketSchema } from "../../src/hub/features/controlled-drugs/record-review/prepared-packet.ts";
import { verifyProspectiveStockMovement } from "../../src/hub/features/controlled-drugs/record-review/prospective-stock-movement.ts";
import { hashReviewTarget } from "../../src/hub/features/controlled-drugs/record-review/component-hashes.ts";
import { deferred, other } from "./record-review-lifecycle-fixture.ts";

interface MutableObject { [key: string]: MutableJson }
type MutableJson = null | boolean | string | ExactJsonNumber | MutableJson[] | MutableObject;
const object = (value: MutableJson): MutableObject => value as MutableObject;
function clone(value: ExactJson): MutableJson {
  if (value === null || typeof value !== "object" || value instanceof ExactJsonNumber) return value;
  if (Array.isArray(value)) return value.map(clone);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
}
// DTO/component fixture only: this conversion creates no genuine read, current
// authorization or terminal history. The original PG17.6 fixture is unchanged.
function fixture() {
  const original = object(clone(decodeExactJson(readFileSync(new URL("./record-review-stock-movement-reference.json", import.meta.url)))));
  const packet = object(object(original.data).packet), event = object(packet.event), adapter = object(packet.adapter);
  const authorization = object(packet.current_authorization), historical = object(object(packet.obligation).historical);
  const request = { actor_id: String(object(authorization.read).actor_id), event_id: String(event.id) };
  const summary: MutableObject = { event_id: request.event_id, event_sequence: String(event.sequence), event_kind: event.event_kind,
    site_basis: adapter.site_basis, site_id: adapter.site_id, observed_at: event.observed_at, recorded_at: event.recorded_at,
    review_state: "awaiting_review", deadline_state: historical.deadline_basis, deadline_basis: historical.deadline_basis,
    due_at: historical.due_at, unavailable_reason: historical.unavailable_reason, signing_state: "available", signing_reason: "none" };
  const data: MutableObject = { summary, packet, terminal_review: null, escalations: [], derived_escalation_reasons: [],
    policy_id: object(authorization.policy).id, read_eligibility_id: object(authorization.read).id, review_eligibility_id: object(authorization.review).id };
  return { request, packet, event, adapter, authorization, summary, data, response: { version: new ExactJsonNumber("3"), state: "detail", data } };
}
// Deliberately scoped fixture implementation, not a production admission gate.
const stockFixtureAdmission: ReviewDetailEvidenceAdmission = { async validate(result, request) {
  assert.equal(result.state, "detail");
  if (result.state !== "detail") throw new Error("Stock fixture only");
  await verifyProspectiveStockMovement(reviewRequiredPacketSchema.parse(result.data.packet), { event_id: request.event_id });
} };
async function terminalFixture(actorName = "Synthetic reviewer") {
  const f = fixture(); f.summary.review_state = "approved"; f.summary.signing_state = "terminal";
  f.summary.signing_reason = "terminal_outcome"; f.summary.deadline_state = "completed_time_unassessable";
  f.data.terminal_review = { decision: "approve", meaning: "independent_record_review_v1",
    meaning_text: "Independent record review; no claim of personal physical observation.", meaning_version: new ExactJsonNumber("1"),
    actor_id: f.request.actor_id, actor_name: actorName, recorded_at: "2026-10-24T15:23:00.000000Z", reason: "Synthetic DTO check",
    receipt_hash: "a".repeat(64), target_hash: await hashReviewTarget(f.packet.target), packet_hash: "b".repeat(64) };
  return f;
}

test("source detail yields exactly five server IDs without a mutation envelope", async () => {
  const f = fixture(), accepted = await verifyReviewDetail(f.request, f.response, stockFixtureAdmission, () => {});
  assert.deepEqual(accepted.selection, { ...f.request, policy_id: f.data.policy_id,
    read_eligibility_id: f.data.read_eligibility_id, review_eligibility_id: f.data.review_eligibility_id });
  assert.equal(Object.keys(accepted.selection!).length, 5);
  assert.equal("operation_id" in accepted.response.data, false); assert.equal("expires_at" in accepted.response.data, false);
  assert.ok(Object.isFrozen(accepted) && Object.isFrozen(accepted.selection) && Object.isFrozen(accepted.response));
});

test("mandatory evidence admission may refuse an otherwise matching selection", async () => {
  const f = fixture();
  await assert.rejects(verifyReviewDetail(f.request, f.response, undefined as never, () => {}));
  await assert.rejects(verifyReviewDetail(f.request, f.response, { validate() { throw new Error("PRIVATE_SOURCE_VALUE"); } }, () => {}),
    error => !String(error).includes("PRIVATE"));
});

test("detail IDs, viewer, event and scope are bound before invoking source admission", async () => {
  const changes = [
    f => { f.data.policy_id = other; }, f => { f.data.read_eligibility_id = other; }, f => { f.data.review_eligibility_id = other; },
    f => { object(f.authorization.policy).id = other; }, f => { object(f.authorization.read).id = other; }, f => { object(f.authorization.review).id = other; },
    f => { object(f.authorization.read).actor_id = other; }, f => { object(f.authorization.review).actor_id = other; },
    f => { f.summary.event_id = other; }, f => { f.summary.event_sequence = "2"; }, f => { f.summary.site_id = other; },
    f => { f.summary.observed_at = null; }, f => { f.summary.recorded_at = "2000-01-01T00:00:00Z"; },
    f => { object(f.adapter.target).record_hash = "0".repeat(64); }, f => { f.event.product_id = other; },
  ];
  for (const change of changes) {
    const f = fixture(); change(f); let invoked = false;
    await assert.rejects(verifyReviewDetail(f.request, f.response, { validate() { invoked = true; } }, () => {}));
    assert.equal(invoked, false);
  }
});

test("prepared metadata and hidden backend fields cannot enter the read response", async () => {
  for (const extra of ["operation_id", "created_at", "expires_at", "packet_hash", "transport_digest", "_configuration_ids"]) {
    const f = fixture(); f.data[extra] = "not-read-data";
    await assert.rejects(verifyReviewDetail(f.request, f.response, stockFixtureAdmission, () => {}));
  }
});

test("nullable policy/review projections are delegated as read data and never become selection", async () => {
  const f = fixture(); f.authorization.policy = null; f.authorization.review = null;
  f.data.policy_id = null; f.data.review_eligibility_id = null;
  f.summary.signing_state = "blocked"; f.summary.signing_reason = "no_current_policy";
  let invoked = false;
  // Boundary test double only; it supplies no source/Auth/history authority.
  const accepted = await verifyReviewDetail(f.request, f.response, { validate(result) {
    assert.equal(result.state, "detail");
    if (result.state !== "detail") throw new Error("Expected detail");
    assert.equal(result.data.packet.current_authorization.policy, null); assert.equal(result.data.review_eligibility_id, null); invoked = true;
  } }, () => {});
  assert.equal(invoked, true); assert.equal(accepted.selection, null);
});

test("exception-only read has no packet, terminal fields or preparation IDs", async () => {
  const f = fixture(); f.summary.signing_state = "blocked"; f.summary.signing_reason = "evidence_limit_exceeded";
  const input = { version: new ExactJsonNumber("3"), state: "exception", data: { summary: f.summary } };
  const accepted = await verifyReviewDetail(f.request, input, { validate(result) {
    assert.equal(result.state, "exception"); assert.deepEqual(Object.keys(result.data), ["summary"]);
  } }, () => {});
  assert.equal(accepted.selection, null);
  f.summary.signing_state = "available"; f.summary.signing_reason = "none";
  await assert.rejects(verifyReviewDetail(f.request, input, stockFixtureAdmission, () => {}));
});

test("identity invalidation during admission rejects the result and frozen evidence cannot change", async () => {
  const f = fixture(), entered = deferred<void>(), release = deferred<void>(); let current = true;
  const pending = verifyReviewDetail(f.request, f.response, { async validate(result) {
    assert.ok(Object.isFrozen(result.data) && result.state === "detail" && Object.isFrozen(result.data.packet.event));
    entered.resolve(); await release.promise;
  } }, () => { if (!current) throw new Error("PRIVATE_OBSOLETE_IDENTITY"); });
  await entered.promise; current = false; release.resolve();
  await assert.rejects(pending, error => !String(error).includes("PRIVATE"));
});

test("terminal attribution is bound to the target and cannot create a new selection", async () => {
  const f = await terminalFixture();
  const accepted = await verifyReviewDetail(f.request, f.response, stockFixtureAdmission, () => {});
  assert.equal(accepted.selection, null); // Synthetic terminal DTO, not genuine retained history.
});

test("terminal names follow SQL non-multiline text and Unicode-edge rules", async () => {
  for (const name of ["\u00a0Reviewer", "Reviewer\ufeff", "Rev\niewer", "Rev\tiewer", "Rev\u007fiewer", "", "🐕".repeat(201)]) {
    const f = await terminalFixture(name);
    await assert.rejects(verifyReviewDetail(f.request, f.response, stockFixtureAdmission, () => {}));
  }
  for (const name of ["\u0085Reviewer\u0085", "A\u00a0B", "🐕".repeat(200)]) {
    const f = await terminalFixture(name), accepted = await verifyReviewDetail(f.request, f.response, stockFixtureAdmission, () => {});
    assert.equal(accepted.response.state === "detail" && accepted.response.data.terminal_review?.actor_name, name);
  }
});
