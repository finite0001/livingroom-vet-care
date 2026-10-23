import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { decodeExactJson, ExactJsonNumber, protocolInteger, readExactReviewResponse, reviewResponseByteLimit } from "../../src/hub/features/controlled-drugs/record-review/exact-json.ts";
import { frameReviewFields, recordReviewRequestSchema, reviewTransportDigest } from "../../src/hub/features/controlled-drugs/record-review/request.ts";
import { createReviewPointerStore, type ReviewPointerLocks, type ReviewPointerStorage } from "../../src/hub/features/controlled-drugs/record-review/recovery-pointer.ts";
import { verifyOwnedReviewOutcome } from "../../src/hub/features/controlled-drugs/record-review/owned-outcome.ts";
const actor = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", operation = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const event = "cccccccc-cccc-4ccc-8ccc-cccccccccccc", policy = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const request = { actor_id: actor, operation_id: operation, event_id: event, policy_id: policy, read_eligibility_id: actor,
  review_eligibility_id: policy, decision: "approve", reason: "Reviewed synthetic record" };
const pointer = { version: 3 as const, actor_id: actor, operation_id: operation, transport_digest: "a".repeat(64) };
const saved = { version: 3, state: "saved", data: { operation_id: operation, receipt: { ...pointer, decision: "approve", recorded_at: "2026-10-23T12:00:00.000000Z", receipt_hash: "b".repeat(64) } } };
const cancellation = (kind: "prepared" | "unprepared") => ({ version: 3, state: "cancelled", data: { operation_id: operation, actor_id: actor,
  cancellation_kind: kind, transport_digest: kind === "prepared" ? pointer.transport_digest : null, cancelled_at: "2026-10-23T12:00:00.000000Z" } });
const raw = (text: string) => new TextEncoder().encode(text);

test("raw historical numbers retain every digit and numeric identity", () => {
  const value = decodeExactJson(raw('{"sequence":9007199254740993,"quantity":0.123456789012345678901234567890,"exponent":1e999,"negative_zero":-0}'));
  assert.ok(value && typeof value === "object" && "sequence" in value);
  assert.equal(String(value.sequence), "9007199254740993");
  assert.equal(String(value.quantity), "0.123456789012345678901234567890");
  assert.equal(String(value.exponent), "1e999"); assert.equal(String(value.negative_zero), "-0");
  assert.ok(value.sequence instanceof ExactJsonNumber);
  assert.throws(() => JSON.stringify(value)); assert.ok(Object.isFrozen(value) && Object.isFrozen(value.sequence));
  assert.throws(() => Number(value.sequence));
});
test("duplicates, malformed grammar, Unicode and excess resources fail closed", () => {
  for (const text of ['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"nested":{"x":0,"x":1}}', '[1,]', '{"x":1,}',
    '01', '-01', '1.', '1e', '+1', 'NaN', 'Infinity', '{}{}', '"\\ud800"', '"\\udfff"', '"\\u0000"', '\ufeff{}',
    '['.repeat(66) + '0' + ']'.repeat(66), '1'.repeat(1025), '"' + 'a'.repeat(reviewResponseByteLimit) + '"'])
    assert.throws(() => decodeExactJson(raw(text)), undefined, text.slice(0, 80));
  assert.throws(() => decodeExactJson(new Uint8Array([0xff])));
  const value = decodeExactJson(raw('{"__proto__":{"polluted":true}}'));
  assert.equal(Object.getPrototypeOf(value), null); assert.equal(Object.hasOwn({}, "polluted"), false);
});
test("only explicit bounded protocol integers can become JS numbers", () => {
  assert.equal(protocolInteger(new ExactJsonNumber("3"), 3, 3), 3);
  for (const token of ["3.0", "3e0", "-0", "9007199254740993", "4"])
    assert.throws(() => protocolInteger(new ExactJsonNumber(token), 3, 3));
  assert.throws(() => protocolInteger(3, 3, 3));
});
test("stream decoder preserves split UTF-8 and hides HTTP error bodies", async () => {
  const bytes = raw('{"name":"é🐕","quantity":123.000000000000000001}');
  const body = new ReadableStream({ start(controller) {
    for (let i = 0; i < bytes.length; i += 2) controller.enqueue(bytes.slice(i, i + 2)); controller.close();
  } });
  const value = await readExactReviewResponse(new Response(body, { headers: { "content-type": "application/json; charset=utf-8" } }));
  assert.ok(value && typeof value === "object" && "name" in value);
  assert.equal(value.name, "é🐕"); assert.equal(String(value.quantity), "123.000000000000000001"); assert.equal(body.locked, false);
  await assert.rejects(readExactReviewResponse(new Response("private detail", { status: 403 })), /did not complete/);
  await assert.rejects(readExactReviewResponse(new Response("{}", { headers: { "content-type": "text/html" } })), /JSON review/);
});
test("oversized response is cancelled and unlocked", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(reviewResponseByteLimit + 1)); }, cancel() { cancelled = true; } });
  await assert.rejects(readExactReviewResponse(new Response(body, { headers: { "content-type": "application/json" } })), /size limit/);
  assert.equal(cancelled, true); assert.equal(body.locked, false);
});
test("a stalled response has one original deadline and does not await a hung cancellation", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; return new Promise(() => {}); } });
  const reading = readExactReviewResponse(new Response(body, { headers: { "content-type": "application/json" } }));
  const rejected = assert.rejects(reading, /outcome is unconfirmed/);
  context.mock.timers.tick(30000);
  await rejected; assert.equal(cancelled, true); assert.equal(body.locked, false);
});
test("empty response chunks do not become retained metadata or reset the deadline", async () => {
  let remaining = 100001;
  const body = new ReadableStream<Uint8Array>({ pull(controller) {
    if (remaining-- > 0) controller.enqueue(new Uint8Array());
    else { controller.enqueue(raw("{}")); controller.close(); }
  } });
  const value = await readExactReviewResponse(new Response(body, { headers: { "content-type": "application/json" } }));
  assert.equal(Object.keys(value!).length, 0); assert.equal(body.locked, false);
});
test("request digest uses exact UTF-8 framing with no normalization", async () => {
  const values = ["", "é", "e\u0301", "🐕", "a\nb", "a:b", "1234567890", "x"];
  assert.deepEqual(frameReviewFields(values), raw("lrv-record-review-request-v3\n0:2:é3:e\u03014:🐕3:a\nb3:a:b10:12345678901:x"));
  const fields = [actor, operation, event, policy, actor, policy, "approve", request.reason];
  const digest = createHash("sha256").update("lrv-record-review-request-v3\n");
  for (const field of fields) digest.update(`${Buffer.byteLength(field, "utf8")}:`).update(field, "utf8");
  assert.equal(await reviewTransportDigest(request), digest.digest("hex"));
  assert.notEqual(await reviewTransportDigest({ ...request, reason: "é" }), await reviewTransportDigest({ ...request, reason: "e\u0301" }));
  assert.notDeepEqual(frameReviewFields(["ab", "c", ...values.slice(2)]), frameReviewFields(["a", "bc", ...values.slice(2)]));
});
test("request validation rejects noncanonical IDs, controls and altered reason text", () => {
  for (const reason of ["", " ", " leading", "trailing ", "a\rb", "a\0b", "a\u007fb", "\ud800", "🐕".repeat(4001)])
    assert.equal(recordReviewRequestSchema.safeParse({ ...request, reason }).success, false);
  assert.equal(recordReviewRequestSchema.safeParse({ ...request, reason: "🐕".repeat(4000) }).success, true);
  assert.equal(recordReviewRequestSchema.safeParse({ ...request, reason: "a\n\tb" }).success, true);
  assert.equal(recordReviewRequestSchema.safeParse({ ...request, actor_id: actor.toUpperCase() }).success, false);
  assert.equal(recordReviewRequestSchema.safeParse({ ...request, extra: true }).success, false);
});
function storage(): ReviewPointerStorage {
  const values = new Map<string, string>();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } };
}
function exclusiveLocks(): ReviewPointerLocks {
  const queue = new Map<string, Promise<unknown>>();
  return { request(name, options, callback) {
    assert.equal(options.mode, "exclusive");
    const result = (queue.get(name) ?? Promise.resolve()).then(callback);
    queue.set(name, result.catch(() => {})); return result;
  } };
}
test("two callers reserve one UUID and must recover the winner", async () => {
  const backing = storage(), locks = exclusiveLocks();
  const first = createReviewPointerStore(backing, locks), second = createReviewPointerStore(backing, locks);
  const results = await Promise.all([first.reserve(pointer), second.reserve({ ...pointer, operation_id: event })]);
  assert.deepEqual(results.map(result => result.reserved), [true, false]); assert.deepEqual(results[1].pointer, pointer);
  assert.deepEqual(first.read(actor), pointer); assert.equal(JSON.stringify(pointer).includes(request.reason), false);
});
test("not_found never clears a crash-before-submit reservation", async () => {
  const store = createReviewPointerStore(storage(), exclusiveLocks()); await store.reserve(pointer);
  await assert.rejects(store.resolve(pointer, { version: 3, state: "not_found", data: { operation_id: operation } }));
  assert.deepEqual(store.read(actor), pointer);
  await store.resolve(pointer, cancellation("unprepared")); assert.equal(store.read(actor), null);
});
test("cleanup requires an exact saved or cancellation commitment, without a clinical packet", async () => {
  for (const outcome of [saved, cancellation("prepared"), cancellation("unprepared")]) {
    const store = createReviewPointerStore(storage(), exclusiveLocks()); await store.reserve(pointer);
    await store.resolve(pointer, outcome); assert.equal(store.read(actor), null);
  }
  assert.equal(verifyOwnedReviewOutcome(pointer, decodeExactJson(raw(JSON.stringify(saved)))).state, "saved");
  for (const outcome of [{ ...saved, data: { ...saved.data, operation_id: event } },
    { ...saved, data: { operation_id: operation, receipt: { ...saved.data.receipt, actor_id: event } } },
    { ...saved, data: { operation_id: operation, receipt: { ...saved.data.receipt, transport_digest: "0".repeat(64) } } },
    { ...cancellation("prepared"), data: { ...cancellation("prepared").data, transport_digest: null } },
    { ...cancellation("unprepared"), data: { ...cancellation("unprepared").data, transport_digest: pointer.transport_digest } }])
    assert.throws(() => verifyOwnedReviewOutcome(pointer, outcome));
});
test("tampering, unavailable locks and failed storage preserve recovery", async () => {
  assert.throws(() => createReviewPointerStore(storage(), null as unknown as ReviewPointerLocks));
  const backing = storage(), store = createReviewPointerStore(backing, exclusiveLocks()); await store.reserve(pointer);
  await assert.rejects(store.resolve({ ...pointer, operation_id: event }, cancellation("prepared"))); assert.deepEqual(store.read(actor), pointer);
  const key = `lrv:record-review:v3:${actor}`;
  for (const text of [JSON.stringify({ ...pointer, version: 9 }), JSON.stringify({ ...pointer, actor_id: event }),
    JSON.stringify(pointer).replace('"version":3', '"version":3,"version":3')]) {
    backing.setItem(key, text); assert.throws(() => store.read(actor)); assert.equal(backing.getItem(key), text);
  }
  const unavailable = createReviewPointerStore({ getItem: () => null, setItem() {}, removeItem() {} }, exclusiveLocks());
  await assert.rejects(unavailable.reserve(pointer), /could not be saved/);
});
