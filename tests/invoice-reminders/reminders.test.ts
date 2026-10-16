import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultPolicy,
  policySchema,
  policyFromDraft,
  practicePolicySchema,
  proposedDueDate,
  termsSchema,
} from "../../src/hub/features/billing/reminders/model.ts";
import { createInvoiceReminderHandler } from "../../supabase/functions/_shared/invoice-reminder-handler.ts";
const key = "sb_secret_synthetic_invoice_reminder_worker",
  id = "01010101-0101-4000-8000-010101010101";
const env = {
  SUPABASE_SECRET_KEYS: JSON.stringify({ worker: key }),
  INVOICE_REMINDERS_ENABLED: "true",
  APP_ENV: "staging",
};
const request = (body = "{}", authenticated = true) =>
  new Request("https://local.test/worker", {
    method: "POST",
    headers: authenticated ? { apikey: key } : {},
    body,
  });
test("accepted billing defaults are explicit and automation is not implicitly enabled", () => {
  assert.equal(defaultPolicy.default_due_days, 0);
  assert.deepEqual(defaultPolicy.offset_days, [7, 14, 30]);
  assert.equal(defaultPolicy.enabled, false);
  assert.ok(policySchema.safeParse(defaultPolicy).success);
  for (const offset_days of [[7, 7], [14, 7], [0], [-1], [366], []])
    assert.equal(
      policySchema.safeParse({ ...defaultPolicy, offset_days }).success,
      false,
    );
});
test("reminder placeholders and subjects cannot smuggle unsupported substitutions", () => {
  assert.equal(
    policySchema.safeParse({
      ...defaultPolicy,
      email_body: "Pay {{client_private_notes}}",
    }).success,
    false,
  );
  assert.equal(
    policySchema.safeParse({
      ...defaultPolicy,
      email_subject: "Invoice\nBCC: recipient",
    }).success,
    false,
  );
  assert.equal(
    policySchema.safeParse({
      ...defaultPolicy,
      practice_contact: "{{amount_due}}",
    }).success,
    false,
  );
});
test("due dates use Denver issue date, including UTC rollover and leap years", () => {
  assert.equal(proposedDueDate("2026-10-16T01:30:00Z", 0), "2026-10-15");
  assert.equal(proposedDueDate("2024-02-28T18:00:00Z", 1), "2024-02-29");
});
test("both policy editors validate the same cadence draft and practice response", () => {
  assert.deepEqual(
    policyFromDraft(defaultPolicy, " 7,14, 30 ").offset_days,
    [7, 14, 30],
  );
  for (const days of ["", "7,", "7.5", "7,7", "14,7", "0", "366", "1e2"])
    assert.throws(() => policyFromDraft(defaultPolicy, days));
  assert.ok(
    practicePolicySchema.safeParse({
      actor_id: id,
      policy: null,
      scheduler: { cron_active: false, last_run: null },
    }).success,
  );
  assert.equal(
    practicePolicySchema.safeParse({
      actor_id: id,
      policy: { id, version: 0, actor_id: id, definition: defaultPolicy },
      scheduler: { cron_active: false, last_run: null },
    }).success,
    false,
  );
});
test("hold reasons and actual calendar dates are validated", () => {
  const t = {
    due_on: "2026-10-15",
    enabled: true,
    channel: "EMAIL",
    hold_kind: "none",
    hold_reason: "",
  };
  assert.ok(termsSchema.safeParse(t).success);
  assert.equal(
    termsSchema.safeParse({ ...t, due_on: "2026-02-30" }).success,
    false,
  );
  assert.equal(
    termsSchema.safeParse({ ...t, hold_kind: "disputed" }).success,
    false,
  );
  assert.equal(
    termsSchema.safeParse({ ...t, hold_reason: "Old hold" }).success,
    false,
  );
  assert.ok(
    termsSchema.safeParse({
      ...t,
      hold_kind: "bereavement",
      hold_reason: "Family requested pause",
    }).success,
  );
});
test("disabled or unauthenticated worker makes no database client", async () => {
  let calls = 0;
  const handler = createInvoiceReminderHandler(
    { ...env, INVOICE_REMINDERS_ENABLED: "false" },
    () => {
      calls++;
      throw new Error("Unexpected client");
    },
  );
  assert.equal((await handler(request("{}", false))).status, 401);
  assert.deepEqual(await (await handler(request())).json(), {
    disabled: true,
    queued: 0,
    dispatched: false,
  });
  assert.equal(calls, 0);
});
test("unknown environment and malformed/unbounded requests do not execute", async () => {
  let calls = 0;
  const db = () => {
    calls++;
    throw new Error("Unexpected client");
  };
  assert.equal(
    (await createInvoiceReminderHandler({ ...env, APP_ENV: "" }, db)(request()))
      .status,
    503,
  );
  const h = createInvoiceReminderHandler(env, db);
  for (const body of [
    '{"limit":0}',
    '{"limit":101}',
    '{"limit":1.5}',
    '{"limit":"25"}',
    '{"recipient":"bad@example.test"}',
    "[]",
    "{",
  ])
    assert.equal((await h(request(body))).status, 400);
  assert.equal((await h(request(" ".repeat(1025)))).status, 413);
  assert.equal(calls, 0);
});
test("successful queue receipt is bound to exact original run and batch", async () => {
  const calls: string[] = [];
  const handler = createInvoiceReminderHandler(env, () => ({
    rpc: async (name, args) => {
      calls.push(name);
      assert.equal(args.p_run_id, id);
      return {
        data: { run_id: id, requested_limit: 25, queued: 2, dispatched: false },
        error: null,
      };
    },
  }));
  assert.deepEqual(
    await (await handler(request(JSON.stringify({ run_id: id })))).json(),
    { run_id: id, requested_limit: 25, queued: 2, dispatched: false },
  );
  assert.deepEqual(calls, ["execute_invoice_reminder_run"]);
});
test("lost queue acknowledgement recovers without executing a second time", async () => {
  const calls: string[] = [];
  const handler = createInvoiceReminderHandler(env, () => ({
    rpc: async (name) => {
      calls.push(name);
      return name === "execute_invoice_reminder_run"
        ? { data: null, error: new Error("Lost acknowledgement") }
        : {
            data: {
              run_id: id,
              requested_limit: 25,
              queued: 1,
              dispatched: false,
            },
            error: null,
          };
    },
  }));
  assert.equal(
    (await (await handler(request(JSON.stringify({ run_id: id })))).json())
      .queued,
    1,
  );
  assert.deepEqual(calls, [
    "execute_invoice_reminder_run",
    "recover_invoice_reminder_run",
  ]);
});
test("wrong receipt or missing read-only recovery remains explicitly uncertain", async () => {
  const handler = createInvoiceReminderHandler(env, () => ({
    rpc: async (name) => ({
      data:
        name === "execute_invoice_reminder_run"
          ? {
              run_id: crypto.randomUUID(),
              requested_limit: 25,
              queued: 1,
              dispatched: false,
            }
          : null,
      error: null,
    }),
  }));
  const response = await handler(request(JSON.stringify({ run_id: id })));
  assert.equal(response.status, 202);
  assert.equal((await response.json()).outcome, "unknown");
});
