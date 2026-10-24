import assert from "node:assert/strict";
import { test } from "node:test";
import { createReviewQueueReader } from "../../src/hub/features/controlled-drugs/record-review/queue-reader.ts";
import { decodeExactJson, type ExactJson } from "../../src/hub/features/controlled-drugs/record-review/exact-json.ts";
import type { ReviewReadRpc } from "../../src/hub/features/controlled-drugs/record-review/read-rpc.ts";
import { identity, actor, event, other, policy, deferred } from "./record-review-lifecycle-fixture.ts";

const request = { actor_id: actor, product_id: policy, site_id: other, event_kind: "receive_inventory", view: "site", page_size: 1, cursor: null };
const cursor = { version: 3, actor_id: actor, product_id: policy, site_id: other, event_kind: "receive_inventory", view: "site",
  after_sequence: "1", high_water: "2", read_eligibility_id: actor, read_authorization_hash: "a".repeat(64) };
const summary = { event_id: event, event_sequence: "1", event_kind: "receive_inventory", site_basis: "event_transitions", site_id: other,
  observed_at: "2026-10-22T01:02:03.000001Z", recorded_at: "2026-10-23T01:02:03.000002Z", review_state: "awaiting_review",
  deadline_state: "overdue", deadline_basis: "configured", due_at: "2026-10-22T23:00:00.000000Z", unavailable_reason: null,
  signing_state: "available", signing_reason: "none" };
const page = { version: 3, state: "page", data: { items: [summary], next_cursor: cursor, high_water: "2", examined: 1, coverage: "bounded_page" } };
const decode = (value: unknown) => decodeExactJson(new TextEncoder().encode(JSON.stringify(value)));
function setup(answer: (input: unknown) => Promise<ExactJson> = async () => decode(page)) {
  const calls: unknown[] = []; let current = true;
  const rpc: ReviewReadRpc = { async call(method, input) {
    assert.equal(method, "list_controlled_record_reviews_v3"); calls.push(structuredClone(input)); return answer(input);
  } };
  const model = createReviewQueueReader({ rpc, isCurrent: () => current });
  return { model, calls, invalidate: () => { current = false; } };
}

test("creation, subscription and identity installation perform no implicit read", () => {
  const { model, calls } = setup();
  assert.equal(model.getSnapshot().phase, "signed_out");
  let notified = 0; const unsubscribe = model.subscribe(() => { notified++; });
  model.setIdentity(identity); assert.equal(model.getSnapshot().phase, "idle");
  model.setIdentity({ ...identity }); assert.equal(notified, 1);
  unsubscribe(); model.clear(); assert.equal(notified, 1); assert.equal(calls.length, 0);
});

test("refresh and next page use only the verified continuation after explicit calls", async () => {
  let count = 0;
  const { model, calls } = setup(async () => decode(++count === 1 ? page : {
    ...page, data: { ...page.data, items: [{ ...summary, event_id: other, event_sequence: "2", observed_at: null }], next_cursor: null },
  }));
  model.setIdentity(identity); assert.equal(await model.refresh(request), true);
  assert.equal(calls.length, 1); assert.equal(model.getSnapshot().page?.data.items[0].event_sequence, "1");
  assert.equal(await model.nextPage(), true); assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], { ...request, cursor });
  assert.equal(model.getSnapshot().page?.data.items[0].observed_at, null);
  assert.equal(await model.nextPage(), false); assert.equal(calls.length, 2);
});

test("signed-out, cross-actor, malformed and supplied continuation refreshes never read", async () => {
  const { model, calls } = setup();
  assert.equal(await model.refresh(request), false);
  model.setIdentity(identity);
  for (const input of [{ ...request, actor_id: other }, { ...request, page_size: 101 }, { ...request, cursor }, { ...request, extra: true }]) {
    assert.equal(await model.refresh(input), false); assert.equal(model.getSnapshot().page, undefined);
  }
  assert.equal(calls.length, 0);
});

test("one pending read blocks duplicate clicks and clears the old page before reauthorization", async () => {
  const pending = deferred<ExactJson>(); let count = 0;
  const { model, calls } = setup(async () => ++count === 1 ? decode(page) : pending.promise);
  model.setIdentity(identity); await model.refresh(request);
  const loading = model.nextPage();
  assert.equal(model.getSnapshot().phase, "loading"); assert.equal(model.getSnapshot().page, undefined);
  assert.equal(await model.refresh(request), false); assert.equal(await model.nextPage(), false); assert.equal(calls.length, 2);
  pending.reject(new Error("PRIVATE_SERVER_TEXT")); assert.equal(await loading, false);
  assert.equal(model.getSnapshot().phase, "unavailable"); assert.equal(model.getSnapshot().page, undefined);
  assert.ok(!JSON.stringify(model.getSnapshot()).includes("PRIVATE"));
});

test("identity invalidation synchronously clears rows and discards an old response", async () => {
  const pending = deferred<ExactJson>(), { model } = setup(() => pending.promise);
  model.setIdentity(identity); const loading = model.refresh(request);
  model.setIdentity(null); assert.equal(model.getSnapshot().phase, "signed_out");
  assert.equal(model.getSnapshot().request, undefined); assert.equal(model.getSnapshot().page, undefined);
  pending.resolve(decode(page)); assert.equal(await loading, false); assert.equal(model.getSnapshot().phase, "signed_out");
});

test("late results and errors cannot overwrite a newer actor generation", async () => {
  const old = deferred<ExactJson>(); let count = 0;
  const { model } = setup(async () => ++count === 1 ? old.promise : decode(page));
  model.setIdentity(identity); const first = model.refresh(request);
  model.setIdentity({ ...identity, generation: identity.generation + 1 });
  assert.equal(await model.refresh(request), true); const accepted = model.getSnapshot();
  old.reject(new Error("PRIVATE_OLD_ERROR")); assert.equal(await first, false);
  assert.equal(model.getSnapshot(), accepted);
});

test("current broker invalidation clears cached rows even before setIdentity notification", async () => {
  const { model, calls, invalidate } = setup(); model.setIdentity(identity); await model.refresh(request);
  invalidate(); assert.equal(await model.refresh(request), false);
  assert.equal(model.getSnapshot().phase, "signed_out"); assert.equal(model.getSnapshot().page, undefined);
  assert.equal(model.getSnapshot().request, undefined); assert.equal(calls.length, 1);
});

test("snapshot masking is stable and final-page navigation evicts a stale broker identity", async () => {
  const { model, calls, invalidate } = setup(async () => decode({ ...page, data: {
    ...page.data, items: [{ ...summary, event_sequence: "2" }], next_cursor: null,
  } }));
  model.setIdentity(identity); await model.refresh(request);
  let notices = 0; model.subscribe(() => { notices++; }); invalidate();
  const masked = model.getSnapshot(); assert.equal(masked.phase, "signed_out");
  assert.equal(model.getSnapshot(), masked); assert.equal(masked.page, undefined); assert.equal(notices, 0);
  assert.equal(await model.nextPage(), false); assert.equal(model.getSnapshot().phase, "signed_out");
  assert.equal(model.getSnapshot().request, undefined); assert.equal(notices, 1); assert.equal(calls.length, 1);
});

test("input reentry cannot publish an old loading state over a new identity generation", async () => {
  const { model, calls } = setup(); model.setIdentity(identity);
  const input = { ...request, get product_id() {
    model.setIdentity({ ...identity, generation: identity.generation + 1 }); return policy;
  } };
  assert.equal(await model.refresh(input), false); assert.equal(model.getSnapshot().phase, "idle");
  assert.equal(model.getSnapshot().request, undefined); assert.equal(calls.length, 0);
  assert.equal(await model.refresh(request), true);
});

test("broker invalidation at outer RPC completion cannot commit a page", async () => {
  let current = true;
  const rpc: ReviewReadRpc = { async call() { queueMicrotask(() => { current = false; }); return decode(page); } };
  const model = createReviewQueueReader({ rpc, isCurrent: () => current }); model.setIdentity(identity);
  assert.equal(await model.refresh(request), false); assert.equal(model.getSnapshot().phase, "signed_out");
  assert.equal(model.getSnapshot().page, undefined);
});

test("clear discards a pending generation without touching recovery storage", async () => {
  const pending = deferred<ExactJson>(), { model, calls } = setup(() => pending.promise);
  model.setIdentity(identity); const loading = model.refresh(request); model.clear();
  pending.resolve(decode(page)); assert.equal(await loading, false);
  assert.equal(model.getSnapshot().phase, "idle"); assert.equal(model.getSnapshot().page, undefined); assert.equal(calls.length, 1);
});

test("request and parsed page snapshots are immutable and observer failures are isolated", async () => {
  const { model } = setup(); model.setIdentity(identity); model.subscribe(() => { throw new Error("observer only"); });
  const input = { ...request }; assert.equal(await model.refresh(input), true);
  input.product_id = other; assert.equal(model.getSnapshot().request?.product_id, policy);
  const snapshot = model.getSnapshot();
  assert.ok(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.request) && Object.isFrozen(snapshot.page?.data.items[0]));
  assert.throws(() => { snapshot.page!.data.items[0].event_sequence = "999"; });
});

test("malformed or hostile data is never published as an empty or successful page", async () => {
  for (const value of [{ ...page, data: { ...page.data, examined: 0 } }, { ...page, data: { ...page.data, items: [{ ...summary, patient_name: "PRIVATE" }] } }]) {
    const { model } = setup(async () => decode(value)); model.setIdentity(identity);
    assert.equal(await model.refresh(request), false); assert.equal(model.getSnapshot().phase, "unavailable");
    assert.equal(model.getSnapshot().page, undefined); assert.ok(!JSON.stringify(model.getSnapshot()).includes("PRIVATE"));
  }
});
