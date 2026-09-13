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
const env = {
  SUPABASE_SERVICE_ROLE_KEY: "synthetic-service",
  REMINDER_SCHEDULER_ENABLED: "true",
  APP_ENV: "staging",
};
const started = (id: unknown, limit = 25) => ({
  run_id: id,
  requested_limit: limit,
  started_at: "2026-09-12T12:00:00Z",
  outcome: "started",
  finished_at: null,
  counts: null,
  failure_code: null,
});
const completed = (id: unknown, limit = 25) => ({
  ...started(id, limit),
  outcome: "completed",
  finished_at: "2026-09-12T12:00:01Z",
  counts: { queued: 2, blocked: 1, skipped: 0, dispatched: false },
});

test("confirmed start precedes atomic execution with one stable ID and bounded input", async () => {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const handler = createReminderSchedulerHandler(
    env,
    () => ({
      rpc: async (name, args) => {
        calls.push({ name, args });
        return {
          data: name.startsWith("start_")
            ? started(args.p_run_id, 3)
            : completed(args.p_run_id, 3),
          error: null,
        };
      },
    }),
  );
  const response = await handler(request('{"limit":3}'));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.outcome, "completed");
  assert.equal(body.dispatched, false);
  assert.match(body.run_id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(calls, [
    {
      name: "start_reminder_scheduler_run",
      args: { p_run_id: body.run_id, p_limit: 3 },
    },
    { name: "execute_reminder_scheduler_run", args: { p_run_id: body.run_id } },
  ]);
  assert.equal(response.headers.get("cache-control"), "no-store");
  for (
    const body of [
      '{"limit":0}',
      '{"limit":101}',
      '{"limit":1.5}',
      '{"run_id":"forged"}',
      "[]",
      "invalid",
    ]
  ) {
    assert.equal((await handler(request(body))).status, 400);
  }
  assert.equal((await handler(request(" ".repeat(1025)))).status, 413);
  assert.equal((await handler(request("é".repeat(600)))).status, 413);
  assert.equal(calls.length, 2);
});
for (const phase of ["start", "execute"] as const) {
  test(`lost ${phase} ACK only recovers durable receipt without replay`, async () => {
    const calls: string[] = [];
    const handler = createReminderSchedulerHandler(
      env,
      () => ({
        rpc: async (name, args) => {
          calls.push(name);
          if (name === `${phase}_reminder_scheduler_run`) {
            throw new Error("secret patient internal data");
          }
          return {
            data: name.startsWith("recover_")
              ? (phase === "start"
                ? started(args.p_run_id)
                : completed(args.p_run_id))
              : started(args.p_run_id),
            error: null,
          };
        },
      }),
    );
    const response = await handler(request());
    assert.equal(response.status, phase === "start" ? 202 : 200);
    assert.deepEqual(
      calls,
      phase === "start"
        ? ["start_reminder_scheduler_run", "recover_reminder_scheduler_run"]
        : [
          "start_reminder_scheduler_run",
          "execute_reminder_scheduler_run",
          "recover_reminder_scheduler_run",
        ],
    );
    const body = await response.json();
    assert.equal(body.outcome, phase === "start" ? "started" : "completed");
    assert.equal(body.dispatched, false);
    assert.doesNotMatch(JSON.stringify(body), /secret|patient|internal/);
  });
}
test("durable rollback is reported without invented zero counts or queue replay", async () => {
  const calls: string[] = [];
  const handler = createReminderSchedulerHandler(
    env,
    () => ({
      rpc: async (name, args) => {
        calls.push(name);
        return {
          data: name.startsWith("start_") ? started(args.p_run_id) : {
            ...started(args.p_run_id),
            outcome: "failed",
            finished_at: "2026-09-12T12:00:01Z",
            failure_code: "queue_transaction_rolled_back",
          },
          error: null,
        };
      },
    }),
  );
  const response = await handler(request());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.outcome, "failed");
  assert.equal(body.counts, null);
  assert.equal(calls.length, 2);
});
for (const bad of [null, [], {}, { outcome: "completed" }]) {
  test(`invalid or absent recovery is unknown (${JSON.stringify(bad)})`, async () => {
    const calls: string[] = [];
    const handler = createReminderSchedulerHandler(
      env,
      () => ({
        rpc: async (name) => {
          calls.push(name);
          return { data: bad, error: null };
        },
      }),
    );
    const response = await handler(request());
    assert.equal(response.status, 202);
    const body = await response.json();
    assert.deepEqual(Object.keys(body).sort(), [
      "dispatched",
      "outcome",
      "run_id",
    ]);
    assert.equal(body.outcome, "unknown");
    assert.deepEqual(calls, [
      "start_reminder_scheduler_run",
      "recover_reminder_scheduler_run",
    ]);
  });
}
test("receipt identity, counts, terminal timestamps and safe projection are validated", async () => {
  for (
    const mutate of [
      (r: Record<string, unknown>) => ({ ...r, run_id: crypto.randomUUID() }),
      (r: Record<string, unknown>) => ({ ...r, requested_limit: 99 }),
      (r: Record<string, unknown>) => ({
        ...r,
        counts: { queued: 26, blocked: 0, skipped: 0, dispatched: false },
      }),
      (r: Record<string, unknown>) => ({
        ...r,
        counts: { queued: -1, blocked: 0, skipped: 0, dispatched: false },
      }),
      (r: Record<string, unknown>) => ({
        ...r,
        finished_at: "2025-01-01T00:00:00Z",
      }),
    ]
  ) {
    const handler = createReminderSchedulerHandler(
      env,
      () => ({
        rpc: async (_name, args) => ({
          data: mutate(completed(args.p_run_id)),
          error: null,
        }),
      }),
    );
    assert.equal((await (await handler(request())).json()).outcome, "unknown");
  }
  const handler = createReminderSchedulerHandler(
    env,
    () => ({
      rpc: async (_name, args) => ({
        data: { ...completed(args.p_run_id), raw_secret: "private" },
        error: null,
      }),
    }),
  );
  assert.doesNotMatch(
    await (await handler(request())).text(),
    /private|raw_secret/,
  );
});
test("database initialization failure stays unknown with a correlation ID", async () => {
  const handler = createReminderSchedulerHandler(env, () => {
    throw new Error("private");
  });
  const response = await handler(request());
  assert.equal(response.status, 202);
  assert.equal((await response.json()).outcome, "unknown");
});
