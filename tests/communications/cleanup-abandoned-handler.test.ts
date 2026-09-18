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
test("uncertain errors do not expose private details", async () => {
  const handler = createAbandonedCleanupHandler(env, async () => { throw new Error("private/path secret-value"); });
  const response = await handler(request()); assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /private|secret-value/);
});
