import test from "node:test";
import assert from "node:assert/strict";
import { createHealthHandler } from "../../supabase/functions/_shared/health-ping.ts";

const at = () => new Date("2026-09-22T00:00:00.000Z");
const handler = (ping: () => Promise<void>) =>
  createHealthHandler({ pingDatabase: ping, now: at });
const call = (method = "GET") =>
  new Request("https://synthetic.test/functions/v1/health", { method });

test("a database that answers reports healthy and says nothing else", async () => {
  const response = await handler(async () => {})(call());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), {
    status: "ok",
    checked_at: "2026-09-22T00:00:00.000Z",
  });
});

test("a database that fails reports unavailable without leaking the reason", async () => {
  const response = await handler(async () => {
    throw new Error("password authentication failed for user \"postgres\"");
  })(call());
  assert.equal(response.status, 503);
  const body = await response.text();
  // The error text of a public endpoint is reconnaissance; none of it may appear.
  assert.ok(!body.includes("password"));
  assert.ok(!body.includes("postgres"));
  assert.deepEqual(JSON.parse(body), {
    status: "unavailable",
    checked_at: "2026-09-22T00:00:00.000Z",
  });
});

test("HEAD is answered without a body, because monitors use it", async () => {
  const response = await handler(async () => {})(call("HEAD"));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "");
});

test("a failing database is still 503 for HEAD", async () => {
  const response = await handler(async () => {
    throw new Error("connection refused");
  })(call("HEAD"));
  assert.equal(response.status, 503);
});

test("other methods are refused and say which are allowed", async () => {
  const response = await handler(async () => {})(call("POST"));
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("Allow"), "GET, HEAD");
});

test("the probe carries no credential requirement and no version", async () => {
  // Nothing about the deployment may be readable from an anonymous call.
  const body = await (await handler(async () => {})(call())).text();
  for (const leak of ["version", "commit", "supabase", "env", "table"])
    assert.ok(!body.toLowerCase().includes(leak), leak);
});
