import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeExactJson } from "../../src/hub/features/controlled-drugs/record-review/exact-json.ts";
import { reviewEventKindSchema, reviewQueueRequestSchema, verifyReviewQueuePage } from "../../src/hub/features/controlled-drugs/record-review/queue-model.ts";
const actor = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", product = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const site = "cccccccc-cccc-4ccc-8ccc-cccccccccccc", event = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const scope = { actor_id: actor, product_id: product, site_id: site, event_kind: "receive_inventory", view: "site" };
const request = { ...scope, page_size: 50, cursor: null };
const cursor = { version: 3, ...scope, after_sequence: "9007199254740993", high_water: "9223372036854775807", read_eligibility_id: actor, read_authorization_hash: "a".repeat(64) };
const summary = { event_id: event, event_sequence: "9007199254740993", event_kind: "receive_inventory", site_basis: "event_transitions", site_id: site,
  observed_at: "2026-10-22T01:02:03.000001Z", recorded_at: "2026-10-23T01:02:03.000002Z", review_state: "awaiting_review",
  deadline_state: "overdue", deadline_basis: "configured", due_at: "2026-10-22T23:00:00.000000Z", unavailable_reason: null,
  signing_state: "available", signing_reason: "none" };
const page = { version: 3, state: "page", data: { items: [summary], next_cursor: cursor, high_water: cursor.high_water, examined: 100, coverage: "bounded_page" } };
const decode = (value: unknown) => decodeExactJson(new TextEncoder().encode(JSON.stringify(value)));

test("queue validates exact scope and preserves bigint positions beyond JS safe integers", () => {
  const parsed = verifyReviewQueuePage(request, decode(page));
  assert.equal(parsed.data.items[0].event_sequence, "9007199254740993");
  assert.equal(parsed.data.high_water, "9223372036854775807");
  assert.equal(parsed.data.examined, 100); assert.equal(reviewEventKindSchema.options.length, 22);
});
test("empty but continuing pages remain navigable without an automatic scan", () => {
  const parsed = verifyReviewQueuePage(request, decode({ ...page, data: { ...page.data, items: [] } }));
  assert.equal(parsed.data.items.length, 0); assert.ok(parsed.data.next_cursor);
  const nextRequest = { ...request, cursor };
  const next = { ...page, data: { ...page.data, items: [], next_cursor: { ...cursor, after_sequence: "9007199254740994" } } };
  assert.ok(verifyReviewQueuePage(nextRequest, decode(next)).data.next_cursor);
});
test("cursor scope, authorization version, order and bounds cannot drift", () => {
  for (const bad of [{ ...request, cursor: { ...cursor, actor_id: product } }, { ...request, view: "exceptions" }, { ...request, page_size: 101 }])
    assert.equal(reviewQueueRequestSchema.safeParse(bad).success, false);
  for (const data of [{ ...page.data, high_water: "9223372036854775808" }, { ...page.data, examined: 0 },
    { ...page.data, items: [summary, summary] }, { ...page.data, next_cursor: { ...cursor, actor_id: product } },
    { ...page.data, next_cursor: { ...cursor, after_sequence: "1" } }, { ...page.data, next_cursor: { ...cursor, high_water: "100" } },
    { ...page.data, items: [{ ...summary, event_sequence: Number("9007199254740993") }] },
    { ...page.data, items: [{ ...summary, site_id: product }] }, { ...page.data, items: [{ ...summary, event_kind: "adjust_inventory" }] }])
    assert.throws(() => verifyReviewQueuePage(request, decode({ ...page, data })));
  assert.throws(() => verifyReviewQueuePage({ ...request, cursor }, decode({ ...page, data: { ...page.data, items: [], next_cursor: { ...cursor, after_sequence: "9007199254740994", read_authorization_hash: "0".repeat(64) } } })));
});
test("review, deadline and signing states stay independent and internally consistent", () => {
  const validate = (changes: Record<string, unknown>) => verifyReviewQueuePage(request, decode({ ...page, data: { ...page.data, items: [{ ...summary, ...changes }] } }));
  assert.equal(validate({ signing_state: "blocked", signing_reason: "own_record" }).data.items[0].deadline_state, "overdue");
  const rejected = { review_state: "rejected", signing_state: "terminal", signing_reason: "terminal_outcome", deadline_state: "completed_late" };
  assert.equal(validate(rejected).data.items[0].review_state, "rejected");
  assert.equal(validate({ ...rejected, deadline_state: "completed_time_unassessable", deadline_basis: "historical_policy_unavailable", due_at: null, unavailable_reason: "no_policy_at_anchor" }).data.items[0].due_at, null);
  for (const changes of [{ review_state: "not_required" }, { signing_state: "terminal" }, { deadline_state: "completed_late" }, { due_at: null }, { signing_reason: "own_record" }])
    assert.throws(() => validate(changes));
  for (const changes of [{ ...rejected, deadline_state: "completed_on_time", deadline_basis: "not_configured", due_at: null, unavailable_reason: "kind_not_configured" },
    { deadline_basis: "not_configured", due_at: null, unavailable_reason: "kind_not_configured" },
    { ...rejected, deadline_state: "completed_time_unassessable" }]) assert.throws(() => validate(changes));
});
test("exception queues expose only site-unproven summaries and reject extra detail", () => {
  const exceptionRequest = { ...request, view: "exceptions", site_id: null, event_kind: null };
  const data = { ...page.data, next_cursor: null, items: [{ ...summary, site_id: null, site_basis: "unproven", signing_state: "blocked", signing_reason: "unsupported_provenance" }] };
  assert.equal(verifyReviewQueuePage(exceptionRequest, decode({ ...page, data })).data.items.length, 1);
  assert.throws(() => verifyReviewQueuePage(exceptionRequest, decode(page)));
  const unavailable = { ...summary, site_id: null, site_basis: "unproven", deadline_basis: "historical_policy_unavailable", deadline_state: "historical_policy_unavailable", due_at: null, unavailable_reason: "site_unproven" };
  assert.throws(() => verifyReviewQueuePage(exceptionRequest, decode({ ...page, data: { ...data, items: [unavailable] } })));
  assert.throws(() => verifyReviewQueuePage(exceptionRequest, decode({ ...page, data: { ...data, items: [{ ...unavailable, signing_state: "blocked", signing_reason: "unsupported_provenance", unavailable_reason: null }] } })));
  assert.throws(() => verifyReviewQueuePage(request, decode({ ...page, data: { ...page.data, items: [{ ...summary, patient_name: "should not appear" }] } })));
});
