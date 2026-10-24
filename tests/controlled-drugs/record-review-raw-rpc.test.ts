import assert from "node:assert/strict";
import { test } from "node:test";
import { createReviewRawRpc, type ReviewSessionSource } from "../../src/hub/features/controlled-drugs/record-review/raw-rpc.ts";
import { ExactJsonNumber } from "../../src/hub/features/controlled-drugs/record-review/exact-json.ts";
import { identity, actor, operation, other, request, deferred } from "./record-review-lifecycle-fixture.ts";
const config = { projectRef: "abcdefghijklmnopqrst", url: "https://abcdefghijklmnopqrst.supabase.co", publishableKey: "sb_publishable_SYNTHETIC_TEST_ONLY" };
const session = { ...identity, accessToken: "synthetic.session.token" };
const source = (): ReviewSessionSource => ({ current: async () => session, isCurrent: () => true });
const response = () => new Response('{"sequence":9007199254740993}', { headers: { "content-type": "application/json" } });
test("one raw POST sends public config and current user token; response numbers are never SDK-decoded", async () => {
  let calls = 0;
  const rpc = createReviewRawRpc(config, source(), async (url, options) => {
    calls++; assert.equal(url, `${config.url}/rest/v1/rpc/prepare_controlled_record_review_v3`);
    assert.equal(options?.method, "POST"); assert.equal(options?.redirect, "error"); assert.equal(options?.credentials, "omit");
    assert.equal(options?.cache, "no-store"); assert.deepEqual(JSON.parse(options?.body as string), { p_request: request });
    assert.equal(options?.headers["Authorization"], "Bearer synthetic.session.token"); assert.equal(options?.headers["apikey"], config.publishableKey);
    const value = response(); value.json = async () => { throw new Error("SDK parsing forbidden"); }; return value;
  });
  const value = await rpc.call("prepare_controlled_record_review_v3", request, identity, () => {});
  assert.equal(calls, 1); assert.ok(value && typeof value === "object" && "sequence" in value);
  assert.ok(value.sequence instanceof ExactJsonNumber); assert.equal(String(value.sequence), "9007199254740993");
});
test("secret keys, changed project URL, malformed request and cross-actor calls fail before HTTP", async () => {
  for (const changed of [{ ...config, publishableKey: "sb_secret_PRIVATE" }, { ...config, url: `${config.url}/different` },
    { ...config, url: "https://attacker.example" }, { ...config, url: "http://abcdefghijklmnopqrst.supabase.co" }])
    assert.throws(() => createReviewRawRpc(changed, source()));
  let calls = 0; const rpc = createReviewRawRpc(config, source(), async () => { calls++; return response(); });
  await assert.rejects(rpc.call("execute_controlled_record_review_v3", { actor_id: other, operation_id: operation }, identity, () => {}));
  await assert.rejects(rpc.call("execute_controlled_record_review_v3", { ...request }, identity, () => {})); assert.equal(calls, 0);
});
test("session acquisition and HTTP completion both recheck actor/session generation", async () => {
  const acquired = deferred<typeof session | null>(); let current = true, calls = 0;
  const rpc = createReviewRawRpc(config, { current: () => acquired.promise, isCurrent: () => current }, async () => { calls++; return response(); });
  const pending = rpc.call("read_controlled_record_review_v3", { actor_id: actor, operation_id: operation }, identity, () => {});
  current = false; acquired.resolve(session); await assert.rejects(pending, /session changed/); assert.equal(calls, 0);
  const network = deferred<Response>(), started = deferred<void>(); current = true;
  const second = createReviewRawRpc(config, { ...source(), isCurrent: () => current }, async () => { calls++; started.resolve(); return network.promise; });
  const p = second.call("read_controlled_record_review_v3", { actor_id: actor, operation_id: operation }, identity, () => {});
  await started.promise; current = false; network.resolve(response()); await assert.rejects(p, /session changed/); assert.equal(calls, 1);
});
test("one original deadline includes stalled Auth; late Auth completion cannot start HTTP", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const auth = deferred<typeof session | null>(); let calls = 0;
  const rpc = createReviewRawRpc(config, { current: () => auth.promise, isCurrent: () => true }, async () => { calls++; return response(); });
  const p = rpc.call("execute_controlled_record_review_v3", { actor_id: actor, operation_id: operation }, identity, () => {});
  const rejected = assert.rejects(p, /unconfirmed/); context.mock.timers.tick(30000); await rejected;
  auth.resolve(session); await Promise.resolve(); await Promise.resolve(); assert.equal(calls, 0);
});
test("elapsed original deadline refuses HTTP even when the timer callback has not run", async context => {
  let clock = 0, calls = 0;
  context.mock.method(performance, "now", () => clock);
  const auth = deferred<typeof session | null>();
  const rpc = createReviewRawRpc(config, { current: () => auth.promise, isCurrent: () => true }, async () => { calls++; return response(); });
  const pending = rpc.call("execute_controlled_record_review_v3", { actor_id: actor, operation_id: operation }, identity, () => {});
  clock = 30001; auth.resolve(session); await assert.rejects(pending, /unconfirmed/); assert.equal(calls, 0);
});
test("one original deadline aborts stalled fetch, never retries, and hides private error bodies", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0, signal: AbortSignal | undefined; const started = deferred<void>();
  const rpc = createReviewRawRpc(config, source(), async (_url, options) => {
    calls++; signal = options?.signal as AbortSignal; started.resolve(); return new Promise(() => {});
  });
  const p = rpc.call("cancel_controlled_record_review_v3", { actor_id: actor, operation_id: operation }, identity, () => {});
  await started.promise; const rejected = assert.rejects(p, /unconfirmed/); context.mock.timers.tick(30000); await rejected;
  assert.equal(signal?.aborted, true); assert.equal(calls, 1);
  const bad = createReviewRawRpc(config, source(), async () => new Response("PRIVATE_TOKEN_AND_CLINICAL_PACKET", { status: 403 }));
  await assert.rejects(bad.call("read_controlled_record_review_v3", { actor_id: actor, operation_id: operation }, identity, () => {}), error =>
    !String(error).includes("PRIVATE") && /unconfirmed/.test(String(error)));
});
