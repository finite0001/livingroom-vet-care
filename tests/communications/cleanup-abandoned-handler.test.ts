import test from "node:test";
import assert from "node:assert/strict";
import { createAbandonedCleanupHandler } from "../../supabase/functions/_shared/cleanup-abandoned-handler.ts";
const id = "11111111-1111-4111-8111-111111111111";
const env = { SUPABASE_SERVICE_ROLE_KEY: "synthetic-worker", ATTACHMENT_CLEANUP_ENABLED: "true", ATTACHMENT_CLEANUP_GRACE_HOURS: "168" };
const request = (body: unknown = { upload_id: id }, token = "synthetic-worker") => new Request("http://localhost/cleanup", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
test("requires worker credentials before touching cleanup", async () => {
  let calls = 0; const handler = createAbandonedCleanupHandler(env, async () => { calls++; return { status: "empty" }; });
  assert.equal((await handler(request(undefined, "staff-token"))).status, 401); assert.equal(calls, 0);
});
test("disabled or unconfigured worker performs no operation", async () => {
  for (const patch of [{ ATTACHMENT_CLEANUP_ENABLED: "false" }, { ATTACHMENT_CLEANUP_GRACE_HOURS: "" }, { ATTACHMENT_CLEANUP_GRACE_HOURS: "1" }]) {
    let calls = 0; const handler = createAbandonedCleanupHandler({ ...env, ...patch }, async () => { calls++; return { status: "empty" }; });
    assert.equal((await handler(request())).status, 503); assert.equal(calls, 0);
  }
});
test("rejects arbitrary paths and caller-controlled grace", async () => {
  for (const body of [{ upload_id: id, path: "arbitrary" }, { upload_id: id, grace_hours: 0 }, { upload_id: "invalid" }]) {
    const handler = createAbandonedCleanupHandler(env, async () => { throw new Error("Must not run"); });
    assert.equal((await handler(request(body))).status, 400);
  }
});
test("passes one identity and server grace with authenticated worker credential", async () => {
  const handler = createAbandonedCleanupHandler(env, async (upload, grace, credential) => {
    assert.equal(upload, id); assert.equal(grace, 168); assert.equal(credential, env.SUPABASE_SERVICE_ROLE_KEY); return { id, status: "complete" };
  });
  const response = await handler(request()); assert.deepEqual(await response.json(), { id, status: "complete" }); assert.equal(response.headers.get("Cache-Control"), "no-store");
});
const ids = [1, 2, 3].map(n => `11111111-1111-4111-8111-11111111111${n}`);
test("empty scheduler body discovers with server grace and attempts each candidate", async () => {
  const attempted: string[] = [];
  const handler = createAbandonedCleanupHandler(env, async (upload, grace, credential) => {
    assert.equal(grace, 168); assert.equal(credential, env.SUPABASE_SERVICE_ROLE_KEY); attempted.push(upload);
    return upload === ids[1] ? { status: "empty" } : { id: upload, status: "complete" };
  }, async (grace, limit, credential) => {
    assert.equal(grace, 168); assert.equal(limit, 25); assert.equal(credential, env.SUPABASE_SERVICE_ROLE_KEY); return ids;
  });
  const response = await handler(request({}));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual({ ...body, elapsed_ms: 0 }, { mode: "batch", candidates: 3, complete: 2, empty: 1, stopped: "empty", elapsed_ms: 0 });
  assert.deepEqual(attempted, ids);
});
test("batch mode with nothing eligible performs no cleanup", async () => {
  let calls = 0;
  const handler = createAbandonedCleanupHandler(env, async () => { calls++; return { status: "empty" }; }, async () => []);
  const response = await handler(request({}));
  assert.equal(response.status, 200); assert.equal((await response.json()).candidates, 0); assert.equal(calls, 0);
});
test("batch mode stops at the first unconfirmed cleanup and names only that upload", async () => {
  const attempted: string[] = [];
  const handler = createAbandonedCleanupHandler(env, async upload => {
    attempted.push(upload); if (upload === ids[1]) throw new Error("private/path secret-value"); return { id: upload, status: "complete" };
  }, async () => ids);
  const response = await handler(request({}));
  assert.equal(response.status, 503);
  const text = await response.text();
  assert.doesNotMatch(text, /private|secret-value/);
  assert.equal(JSON.parse(text).upload_id, ids[1]);
  assert.deepEqual(attempted, ids.slice(0, 2));
});
test("batch mode refuses malformed or failed discovery without attempting cleanup", async () => {
  for (const discover of [async () => { throw new Error("secret"); }, async () => ["not-a-uuid"], async () => Array(26).fill(id)]) {
    const handler = createAbandonedCleanupHandler(env, async () => { throw new Error("Must not run"); }, discover);
    const response = await handler(request({}));
    assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /secret/);
  }
});
test("batch mode still requires worker credentials and the enabled gate", async () => {
  let discovered = 0;
  const discover = async () => { discovered++; return ids; };
  assert.equal((await createAbandonedCleanupHandler(env, async () => ({ status: "empty" }), discover)(request({}, "staff-token"))).status, 401);
  assert.equal((await createAbandonedCleanupHandler({ ...env, ATTACHMENT_CLEANUP_ENABLED: "false" }, async () => ({ status: "empty" }), discover)(request({}))).status, 503);
  assert.equal(discovered, 0);
});
test("without a discovery dependency an empty body is still rejected", async () => {
  const handler = createAbandonedCleanupHandler(env, async () => { throw new Error("Must not run"); });
  assert.equal((await handler(request({}))).status, 400);
});
test("uncertain errors do not expose private details", async () => {
  const handler = createAbandonedCleanupHandler(env, async () => { throw new Error("private/path secret-value"); });
  const response = await handler(request()); assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /private|secret-value/);
});
