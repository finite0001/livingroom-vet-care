import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../../", import.meta.url).pathname;
const read = (path: string) => readFileSync(join(root, path), "utf8");
const migrations = readdirSync(join(root, "supabase/migrations"))
  .filter((name) => name.endsWith(".sql"))
  .sort();
const withoutComments = (sql: string) =>
  sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
/** The newest migration that (re)defines a function is the effective definition. */
function latestDefinition(pattern: RegExp): string {
  const file = [...migrations]
    .reverse()
    .find((name) => pattern.test(read(`supabase/migrations/${name}`)));
  assert.ok(file, `no migration matches ${pattern}`);
  return read(`supabase/migrations/${file}`);
}
function sourceFiles(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((name) => {
    const path = `${dir}/${name}`;
    return statSync(join(root, path)).isDirectory()
      ? sourceFiles(path)
      : name.endsWith(".ts")
        ? [path]
        : [];
  });
}

test("no Edge worker calls the retired appointment reminder path", () => {
  for (const file of sourceFiles("supabase/functions")) {
    const source = read(file);
    assert.doesNotMatch(source, /enqueue_due_appointment_reminders/, file);
    assert.doesNotMatch(source, /process_due_reminders/, file);
  }
  assert.match(
    read("supabase/functions/_shared/reminder-scheduler.ts"),
    /execute_reminder_scheduler_run/,
  );
});

test("the retired enqueue is inert and closed to every client role", () => {
  const sql = latestDefinition(
    /function public\.enqueue_due_appointment_reminders\(/,
  );
  assert.match(sql, /raise exception 'Deprecated: appointment reminders/);
  assert.match(
    sql,
    /revoke all on function public\.enqueue_due_appointment_reminders\(integer, timestamptz\) from public, anon, authenticated, service_role;/,
  );
  assert.doesNotMatch(
    withoutComments(sql),
    /grant execute on function public\.enqueue_due_appointment_reminders/,
  );
  // Data-bearing history is retained.
  assert.doesNotMatch(
    withoutComments(sql),
    /drop table|drop column|delete from public\.(outbound_deliveries|appointment_reminders)/i,
  );
});

test("the scheduler runs the canonical reminder and outbox workers only", () => {
  const scheduler = read(
    "supabase/migrations/20260922120000_b1_scheduler.sql",
  );
  assert.match(
    scheduler,
    /cron\.schedule\('queue-reminders', '\*\/15 \* \* \* \*'/,
  );
  assert.match(scheduler, /cron\.schedule\('dispatch-outbox', '\* \* \* \* \*'/);
  assert.doesNotMatch(scheduler, /cron\.schedule\('dispatch-outbound-deliveries'/);
});

test("appointment reminders choose their channel instead of hard-coding SMS", () => {
  const sql = latestDefinition(
    /function public\.save_appointment\(p_actor_id uuid/,
  );
  const body = sql.slice(sql.indexOf("function public.save_appointment(p_actor_id"));
  assert.match(body, /public\.appointment_reminder_channel\(c\.id\)/);
  assert.doesNotMatch(
    body.slice(0, body.indexOf("end $$;")),
    /remind_at,channel,status\)\s*values\([^;]*'SMS'\s*,\s*case/,
  );
  const resolver = latestDefinition(
    /function public\.appointment_reminder_channel\(/,
  );
  assert.match(resolver, /communication_is_suppressed\('SMS'/);
  assert.match(resolver, /communication_is_suppressed\('EMAIL'/);
});

test("every lab reminder gate honours the per-order switch", () => {
  for (const fn of [
    /function public\.reminder_scheduler_candidates_internal\(/,
    /function public\.list_care_reminder_candidates\(/,
    /function public\.enqueue_care_reminder\(/,
    /function public\.reminder_delivery_context\(/,
  ]) {
    const sql = latestDefinition(fn);
    const start = sql.search(fn);
    const body = sql.slice(start, sql.indexOf("$$;", start));
    assert.match(body, /l\.reminders_enabled/, String(fn));
  }
});

test("scheduler scripts keep secrets out of the repository and verify read-only", () => {
  const commission = read("scripts/scheduler/commission-vault-secrets.sql");
  const verify = read("scripts/scheduler/verify-scheduler.sql");
  for (const text of [commission, verify, read("docs/scheduler.md")]) {
    // Only the pattern and placeholders may mention the key prefix.
    for (const hit of text.match(/sb_secret_[A-Za-z0-9_-]{4,}/g) ?? [])
      assert.fail(`possible key literal: ${hit.slice(0, 14)}…`);
  }
  assert.match(commission, /\\getenv lrv_worker_key LRV_SCHEDULER_WORKER_KEY/);
  assert.match(commission, /vault\.update_secret/);
  assert.match(commission, /rollback;/);
  assert.match(verify, /^begin transaction read only;$/m);
  assert.match(verify, /^rollback;$/m);
  assert.doesNotMatch(
    withoutComments(verify),
    /\b(insert|update|delete|create|drop|alter|grant|vault\.create_secret|vault\.update_secret)\b/i,
  );
  assert.doesNotMatch(withoutComments(verify), /decrypted_secret/);
});

test("launch evidence no longer names the retired queue as canonical", () => {
  const progress = read(
    "docs/launch-evidence/2026-09-25-repair-progress.md",
  );
  const row = progress
    .split("\n")
    .find((line) => line.startsWith("| Appointment reminders |"));
  assert.ok(row);
  assert.match(row, /communication_outbox/);
  assert.doesNotMatch(row, /outbound_deliveries/);
});
