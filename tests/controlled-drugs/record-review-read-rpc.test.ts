import assert from "node:assert/strict";
import { test } from "node:test";
import { createReviewReadRpc, ReviewReadTransportError } from "../../src/hub/features/controlled-drugs/record-review/read-rpc.ts";
import { ExactJsonNumber } from "../../src/hub/features/controlled-drugs/record-review/exact-json.ts";
import type { ReviewSessionSource } from "../../src/hub/features/controlled-drugs/record-review/raw-rpc.ts";
import { identity, actor, event, other, deferred } from "./record-review-lifecycle-fixture.ts";

const config = { projectRef: "abcdefghijklmnopqrst", url: "https://abcdefghijklmnopqrst.supabase.co", publishableKey: "sb_publishable_SYNTHETIC_TEST_ONLY" };
const session = { ...identity, accessToken: "synthetic.session.token" };
const detail = { actor_id: actor, event_id: event };
const queue = { actor_id: actor, product_id: event, site_id: other, event_kind: "receive_inventory", view: "site", page_size: 10, cursor: null };
const source = (): ReviewSessionSource => ({ current: async () => session, isCurrent: () => true });
const response = () => new Response('{"sequence":9007199254740993}', { headers: { "content-type": "application/json" } });

test("detail and queue each send one exact read POST with lossless decoding", async () => {
  const seen: string[] = [];
  const rpc = createReviewReadRpc(config, source(), async (url, options) => {
    const method = String(url).split("/").pop()!; seen.push(method);
    assert.equal(options?.method, "POST"); assert.equal(options?.redirect, "error");
    assert.equal(options?.credentials, "omit"); assert.equal(options?.cache, "no-store");
    assert.deepEqual(JSON.parse(options?.body as string), { p_request: method.startsWith("get_") ? detail : queue });
    const headers = new Headers(options?.headers);
    assert.equal(headers.get("authorization"), "Bearer synthetic.session.token"); assert.equal(headers.get("apikey"), config.publishableKey);
    const value = response(); value.json = async () => { throw new Error("SDK decoding forbidden"); }; return value;
  });
  for (const [method, request] of [["get_controlled_record_review_event_v3", detail], ["list_controlled_record_reviews_v3", queue]] as const) {
    const value = await rpc.call(method, request, identity, () => {});
    assert.ok(value && typeof value === "object" && "sequence" in value && value.sequence instanceof ExactJsonNumber);
    assert.equal(String(value.sequence), "9007199254740993");
  }
  assert.deepEqual(seen, ["get_controlled_record_review_event_v3", "list_controlled_record_reviews_v3"]);
});

test("read allowlist refuses every owned mutation or unrelated method before HTTP", async () => {
  let calls = 0; const rpc = createReviewReadRpc(config, source(), async () => { calls++; return response(); });
  for (const method of ["prepare_controlled_record_review_v3", "execute_controlled_record_review_v3", "cancel_controlled_record_review_v3",
    "read_controlled_record_review_v3", "publish_controlled_review_configuration_v3", "../execute_controlled_record_review_v3"]) {
    await assert.rejects(rpc.call(method as never, detail, identity, () => {}), ReviewReadTransportError);
  }
  assert.equal(calls, 0);
});

test("invalid public configuration, exact request fields and cross-actor reads refuse", async () => {
  for (const changed of [{ ...config, publishableKey: "sb_secret_PRIVATE" }, { ...config, url: "http://127.0.0.1:64661" },
    { ...config, url: `${config.url}/path` }, { ...config, url: "https://attacker.example" }])
    assert.throws(() => createReviewReadRpc(changed, source()), error => !String(error).includes("PRIVATE"));
  let calls = 0; const rpc = createReviewReadRpc(config, source(), async () => { calls++; return response(); });
  for (const request of [{ ...detail, operation_id: other }, { actor_id: actor }, { ...detail, actor_id: other }])
    await assert.rejects(rpc.call("get_controlled_record_review_event_v3", request, identity, () => {}));
  await assert.rejects(rpc.call("list_controlled_record_reviews_v3", { ...queue, page_size: 101 }, identity, () => {}));
  assert.equal(calls, 0);
});

test("cursor positions above the safe integer range remain exact on the wire", async () => {
  const cursor = { version: 3, actor_id: actor, product_id: event, site_id: other, event_kind: "receive_inventory", view: "site",
    after_sequence: "9007199254740993", high_water: "9223372036854775807", read_eligibility_id: actor, read_authorization_hash: "a".repeat(64) };
  const request = { ...queue, cursor }; let calls = 0;
  const rpc = createReviewReadRpc(config, source(), async (_url, options) => {
    calls++; assert.deepEqual(JSON.parse(options?.body as string), { p_request: request }); return response();
  });
  await rpc.call("list_controlled_record_reviews_v3", request, identity, () => {}); assert.equal(calls, 1);
});

test("throwing input accessors and broker errors never expose private text", async () => {
  const failure = () => { throw new Error("PRIVATE_SENTINEL"); };
  assert.throws(() => createReviewReadRpc({ ...config, get url() { return failure(); } }, source()), error => !String(error).includes("PRIVATE"));
  let calls = 0; const rpc = createReviewReadRpc(config, source(), async () => { calls++; return response(); });
  await assert.rejects(rpc.call("get_controlled_record_review_event_v3", { actor_id: actor, get event_id() { return failure(); } }, identity, () => {}),
    error => error instanceof ReviewReadTransportError && !String(error).includes("PRIVATE"));
  const modified = new ReviewReadTransportError("identity_changed"); modified.message = "PRIVATE_SENTINEL";
  const failed = createReviewReadRpc(config, { current: async () => { throw modified; }, isCurrent: () => true });
  await assert.rejects(failed.call("get_controlled_record_review_event_v3", detail, identity, () => {}),
    error => error instanceof ReviewReadTransportError && error.kind === "identity_changed" && !String(error).includes("PRIVATE"));
  const hostile = new Proxy({}, { getPrototypeOf: failure });
  const proxyFailure = createReviewReadRpc(config, { current: async () => { throw hostile; }, isCurrent: () => true });
  await assert.rejects(proxyFailure.call("get_controlled_record_review_event_v3", detail, identity, () => {}),
    error => error instanceof ReviewReadTransportError && !String(error).includes("PRIVATE"));
  assert.equal(calls, 0);
});

test("session acquisition invalidation cannot start a read", async () => {
  const acquired = deferred<typeof session | null>(); let current = true, calls = 0;
  const rpc = createReviewReadRpc(config, { current: () => acquired.promise, isCurrent: () => current }, async () => { calls++; return response(); });
  const pending = rpc.call("get_controlled_record_review_event_v3", detail, identity, () => {});
  current = false; acquired.resolve(session);
  await assert.rejects(pending, error => error instanceof ReviewReadTransportError && error.kind === "identity_changed");
  assert.equal(calls, 0);
});

test("identity invalidation after fetch and during body decode discards read data", async () => {
  let current = true, calls = 0;
  const network = deferred<Response>(), started = deferred<void>();
  const rpc = createReviewReadRpc(config, { ...source(), isCurrent: () => current }, async () => { calls++; started.resolve(); return network.promise; });
  const pending = rpc.call("get_controlled_record_review_event_v3", detail, identity, () => {});
  await started.promise; current = false; network.resolve(response());
  await assert.rejects(pending, error => error instanceof ReviewReadTransportError && error.kind === "identity_changed");
  const reading = deferred<void>(); let controller: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start(value) { controller = value; }, pull() { reading.resolve(); } }, { highWaterMark: 0 });
  current = true;
  const second = createReviewReadRpc(config, { ...source(), isCurrent: () => current }, async () => {
    calls++; return new Response(stream, { headers: { "content-type": "application/json" } });
  });
  const next = second.call("list_controlled_record_reviews_v3", queue, identity, () => {});
  await reading.promise; current = false; controller!.enqueue(new TextEncoder().encode('{"ok":true}')); controller!.close();
  await assert.rejects(next, error => error instanceof ReviewReadTransportError && error.kind === "identity_changed");
  assert.equal(calls, 2);
});

test("invalidation queued at inner completion is rechecked after the outer promise race", async () => {
  let current = true, checks = 0;
  const rpc = createReviewReadRpc(config, { ...source(), isCurrent: () => current }, async () => response());
  await assert.rejects(rpc.call("get_controlled_record_review_event_v3", detail, identity, () => {
    if (++checks === 4) queueMicrotask(() => { current = false; });
  }), error => error instanceof ReviewReadTransportError && error.kind === "identity_changed");
  assert.equal(checks, 5);
});

test("one original deadline includes Auth and late Auth cannot start a request", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const acquired = deferred<typeof session | null>(); let calls = 0;
  const rpc = createReviewReadRpc(config, { current: () => acquired.promise, isCurrent: () => true }, async () => { calls++; return response(); });
  const pending = rpc.call("get_controlled_record_review_event_v3", detail, identity, () => {});
  const rejected = assert.rejects(pending, ReviewReadTransportError); context.mock.timers.tick(30000); await rejected;
  acquired.resolve(session); await Promise.resolve(); await Promise.resolve(); assert.equal(calls, 0);
});

test("monotonic deadline refuses a late read before a delayed timer callback", async context => {
  let clock = 0, calls = 0; context.mock.method(performance, "now", () => clock);
  const acquired = deferred<typeof session | null>();
  const rpc = createReviewReadRpc(config, { current: () => acquired.promise, isCurrent: () => true }, async () => { calls++; return response(); });
  const pending = rpc.call("get_controlled_record_review_event_v3", detail, identity, () => {});
  clock = 30001; acquired.resolve(session); await assert.rejects(pending, ReviewReadTransportError); assert.equal(calls, 0);
});

test("read failure aborts once without retry or private error disclosure", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0, signal: AbortSignal | undefined; const started = deferred<void>();
  const rpc = createReviewReadRpc(config, source(), async (_url, options) => {
    calls++; signal = options?.signal as AbortSignal; started.resolve(); return new Promise(() => {});
  });
  const pending = rpc.call("get_controlled_record_review_event_v3", detail, identity, () => {});
  await started.promise; const rejected = assert.rejects(pending, ReviewReadTransportError); context.mock.timers.tick(30000); await rejected;
  assert.equal(signal?.aborted, true); assert.equal(calls, 1);
  for (const value of [new Response("PRIVATE_CLINICAL_TOKEN", { status: 403 }),
    new Response('{"private":"PRIVATE_CLINICAL_TOKEN","private":1}', { headers: { "content-type": "application/json" } })]) {
    const failed = createReviewReadRpc(config, source(), async () => value);
    await assert.rejects(failed.call("get_controlled_record_review_event_v3", detail, identity, () => {}), error =>
      error instanceof ReviewReadTransportError && error.kind === "unavailable" && !String(error).includes("PRIVATE"));
  }
});
