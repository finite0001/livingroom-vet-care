import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { authenticateWorker } from "../../supabase/functions/_shared/worker-auth.ts";
import { createReminderSchedulerHandler } from "../../supabase/functions/_shared/reminder-scheduler.ts";
const secret = "sb_secret_synthetic_named_key";
const env = {
  SUPABASE_SECRET_KEYS: JSON.stringify({
    default: "sb_secret_synthetic_default",
    workers: secret,
  }),
  SUPABASE_SERVICE_ROLE_KEY: "synthetic-legacy",
};
const req = (headers: Record<string, string> = {}) =>
  new Request("https://synthetic.test", { method: "POST", headers });
test("worker credentials accept exact managed named keys and explicit legacy only", () => {
  assert.equal(authenticateWorker(req({ apikey: secret }), env), secret);
  assert.equal(
    authenticateWorker(req({ apikey: "sb_secret_synthetic_default" }), env),
    "sb_secret_synthetic_default",
  );
  assert.equal(
    authenticateWorker(req({ Authorization: "Bearer synthetic-legacy" }), env),
    "synthetic-legacy",
  );
  for (const headers of [
    {},
    {
      Authorization:
        "Bearer eyJhbGciOiJub25lIn0.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.",
    },
    { Authorization: `Bearer ${secret}` },
    { apikey: "sb_publishable_synthetic" },
    { apikey: "sb_secret_unknown" },
    { apikey: "" },
    { apikey: "bad", Authorization: "Bearer synthetic-legacy" },
  ])
    assert.equal(authenticateWorker(req(headers), env), null);
  assert.equal(authenticateWorker(req({ apikey: secret }), {}), null);
});
test("malformed managed secret maps fail closed in their entirety", () => {
  for (const map of [
    "{",
    "null",
    "[]",
    '"secret"',
    "{}",
    JSON.stringify({ a: secret, b: null }),
    JSON.stringify({ a: secret, b: 42 }),
    JSON.stringify({ a: secret, b: "" }),
    JSON.stringify({ a: secret, b: "sb_publishable_bad" }),
    JSON.stringify({ a: secret, b: [] }),
  ])
    assert.equal(
      authenticateWorker(
        req({ apikey: secret, Authorization: "Bearer synthetic-legacy" }),
        { ...env, SUPABASE_SECRET_KEYS: map },
      ),
      null,
    );
});
function endpoint(name: string) {
  let handler: ((request: Request) => Promise<Response>) | undefined;
  const calls: string[] = [];
  const source = readFileSync(
    new URL(`../../supabase/functions/${name}/index.ts`, import.meta.url),
    "utf8",
  ).replace(/^import[\s\S]*?;\n/gm, "");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
    },
  }).outputText;
  runInNewContext(compiled, {
    authenticateWorker,
    createReminderSchedulerHandler,
    serve: (fn: typeof handler) => {
      handler = fn;
    },
    createClient: (_url: string, key: string) => {
      calls.push(key);
      return { rpc: async () => ({ data: [], error: null }) };
    },
    dispatchOne: async () => {
      calls.push("dispatch");
      return { processed: false };
    },
    processOneInbound: async () => {
      calls.push("inbound");
      return { processed: false };
    },
    Deno: {
      env: {
        get: (key: string) =>
          ({
            ...env,
            SUPABASE_URL: "https://synthetic.test",
            APP_ENV: "staging",
            OUTBOUND_DELIVERY_MODE: "disabled",
          })[key],
      },
    },
    Response,
    Request,
  });
  assert.ok(handler);
  return { handler, calls };
}
test("all three actual worker entrypoints deny unauthenticated callers before database or work", async () => {
  for (const name of [
    "dispatch-outbox",
    "process-inbound",
    "queue-reminders",
  ]) {
    const f = endpoint(name);
    for (const headers of [
      {},
      { apikey: "sb_publishable_synthetic" },
      { apikey: "sb_secret_unknown" },
      { apikey: "", Authorization: "Bearer synthetic-legacy" },
      { Authorization: "Bearer anon-jwt" },
    ])
      assert.equal((await f.handler(req(headers))).status, 401);
    assert.deepEqual(f.calls, []);
    assert.equal((await f.handler(req({ apikey: secret }))).status, 200);
    if (name === "queue-reminders") assert.deepEqual(f.calls, []);
    else
      assert.deepEqual(f.calls, [
        secret,
        name === "dispatch-outbox" ? "dispatch" : "inbound",
      ]);
  }
});
test("enabled scheduler uses the authenticated secret for its database connection", async () => {
  let used = "";
  const handler = createReminderSchedulerHandler(
    { ...env, APP_ENV: "staging", REMINDER_SCHEDULER_ENABLED: "true" },
    (key) => {
      used = key;
      return { rpc: async () => ({ data: [], error: null }) };
    },
  );
  assert.equal((await handler(req({ apikey: secret }))).status, 200);
  assert.equal(used, secret);
});
