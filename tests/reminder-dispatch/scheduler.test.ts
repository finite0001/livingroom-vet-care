import test from "node:test";
import assert from "node:assert/strict";
import { createReminderSchedulerHandler } from "../../supabase/functions/_shared/reminder-scheduler.ts";
const request = (body = "", token = "synthetic-service") =>
  new Request("https://synthetic.test/queue-reminders", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body,
  });
test("scheduler is disabled by default and never initializes database or sends", async () => {
  let initialized = 0;
  const handler = createReminderSchedulerHandler(
    { SUPABASE_SERVICE_ROLE_KEY: "synthetic-service" },
    () => {
      initialized++;
      throw new Error("must not initialize");
    },
  );
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    disabled: true,
    queued: 0,
    dispatched: false,
  });
  assert.equal(initialized, 0);
});
test("scheduler blocks unauthorized and unconfigured requests before database work", async () => {
  const handler = createReminderSchedulerHandler(
    {
      SUPABASE_SERVICE_ROLE_KEY: "synthetic-service",
      REMINDER_SCHEDULER_ENABLED: "true",
    },
    () => {
      throw new Error("no database");
    },
  );
  assert.equal((await handler(request("", "wrong"))).status, 401);
  assert.equal((await handler(request())).status, 503);
  assert.equal(
    (await handler(new Request("https://synthetic.test"))).status,
    405,
  );
});
test("enabled scheduler passes only bounded work count to durable SQL queue, never provider payload", async () => {
  const calls: unknown[] = [];
  const handler = createReminderSchedulerHandler(
    {
      SUPABASE_SERVICE_ROLE_KEY: "synthetic-service",
      REMINDER_SCHEDULER_ENABLED: "true",
      APP_ENV: "staging",
    },
    () => ({
      rpc: async (name, args) => {
        calls.push({ name, args });
        return {
          data: { queued: 2, blocked: 1, dispatched: false },
          error: null,
        };
      },
    }),
  );
  const result = await handler(request('{"limit":3}'));
  assert.equal(result.status, 200);
  assert.deepEqual(calls, [
    { name: "queue_due_reminders", args: { p_limit: 3 } },
  ]);
  assert.equal((await result.json()).dispatched, false);
  for (const body of [
    '{"limit":0}',
    '{"limit":101}',
    '{"limit":1.5}',
    '{"actor_id":"forged"}',
    "[]",
    "invalid",
  ])
    assert.equal((await handler(request(body))).status, 400);
  assert.equal(calls.length, 1);
});
test("uncertain persistence exposes no credentials or internal payload and does not replay", async () => {
  let calls = 0;
  const handler = createReminderSchedulerHandler(
    {
      SUPABASE_SERVICE_ROLE_KEY: "synthetic-service",
      REMINDER_SCHEDULER_ENABLED: "true",
      APP_ENV: "production",
    },
    () => ({
      rpc: async () => {
        calls++;
        return {
          data: null,
          error: new Error("secret synthetic-service patient contents"),
        };
      },
    }),
  );
  const response = await handler(request());
  assert.equal(response.status, 500);
  assert.equal(calls, 1);
  const text = await response.text();
  assert.doesNotMatch(text, /synthetic-service|patient contents/);
  assert.match(text, /reconcile/);
});
