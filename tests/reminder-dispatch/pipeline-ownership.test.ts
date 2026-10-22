import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const root = new URL("../../", import.meta.url).pathname;
const read = (path: string) => readFileSync(join(root, path), "utf8");
// The unmodified upstream splitter uses parameter properties, which Node's
// strip-only test runner cannot execute. Transpile this dependency in memory.
const splitter = ts.transpileModule(
  read("tests/controlled-drugs/engine/candidate/vendor/supabase-cli-2.118.0/sql-split.ts"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } },
).outputText;
const { splitAndTrim } = await import(`data:text/javascript;base64,${Buffer.from(splitter).toString("base64")}`) as {
  splitAndTrim: (sql: string) => string[];
};
const migrations = readdirSync(join(root, "supabase/migrations"))
  .filter((name) => name.endsWith(".sql"))
  .sort();
const withoutComments = (sql: string) =>
  sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
/** Strip only leading comments; preserve literals and the complete function body. */
function statementStart(statement: string): string {
  let sql = statement.trimStart();
  while (sql.startsWith("--") || sql.startsWith("/*")) {
    if (sql.startsWith("--")) {
      const end = sql.indexOf("\n");
      sql = end < 0 ? "" : sql.slice(end + 1).trimStart();
    } else {
      let depth = 1;
      let offset = 2;
      while (offset < sql.length && depth > 0) {
        if (sql.startsWith("/*", offset)) { depth++; offset += 2; }
        else if (sql.startsWith("*/", offset)) { depth--; offset += 2; }
        else offset++;
      }
      assert.equal(depth, 0, "unterminated leading SQL comment");
      sql = sql.slice(offset).trimStart();
    }
  }
  return sql;
}
function executableStatements(sql: string): string[] {
  return splitAndTrim(sql).map(statementStart).filter(Boolean);
}
function functionDefinition(statements: string[], pattern: RegExp): string | undefined {
  const flags = pattern.flags.replace(/[gy]/g, "");
  const declaration = new RegExp(`^create\\s+(?:or\\s+replace\\s+)?${pattern.source}`, flags.includes("i") ? flags : `${flags}i`);
  return [...statements].reverse().find((statement) => declaration.test(statement));
}
const statementCache = new Map<string, string[]>();
/** Quoted historical SQL is evidence, not an executable redefinition. */
function latestDefinition(pattern: RegExp): { definition: string; statements: string[] } {
  for (const name of [...migrations].reverse()) {
    let statements = statementCache.get(name);
    if (!statements) {
      statements = executableStatements(read(`supabase/migrations/${name}`));
      statementCache.set(name, statements);
    }
    const definition = functionDefinition(statements, pattern);
    if (definition) return { definition, statements };
  }
  assert.fail(`no executable migration definition matches ${pattern}`);
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
  const { definition, statements } = latestDefinition(
    /function public\.enqueue_due_appointment_reminders\(/,
  );
  const sql = statements.map((statement) => `${statement};`).join("\n");
  assert.match(definition, /raise exception 'Deprecated: appointment reminders/);
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
  // The catalog wrapper delegates reminder creation to the retained canonical core.
  const { definition: wrapper } = latestDefinition(/function public\.save_appointment\(p_actor_id uuid/);
  assert.match(wrapper, /return public\.save_appointment_before_catalog\(/);
  const sql = read("supabase/migrations/20260928190000_no_retryable_sqlstate_for_permanent_conditions.sql");
  const start = sql.toLowerCase().indexOf("function public.save_appointment(p_actor_id");
  const end = sql.indexOf("end $function$;", start);
  assert.ok(start >= 0 && end > start, "Canonical reminder core must be present");
  const body = sql.slice(start, end);
  assert.match(body, /public\.appointment_reminder_channel\(c\.id\)/);
  assert.doesNotMatch(
    body,
    /remind_at,channel,status\)\s*values\([^;]*'SMS'\s*,\s*case/,
  );
  const { definition: resolver } = latestDefinition(
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
    const { definition: body } = latestDefinition(fn);
    assert.match(body, /l\.reminders_enabled/, String(fn));
  }
});

test("effective definitions ignore historical SQL in literals, comments and DO bodies", () => {
  const pattern = /function public\.example\(/;
  const historical = "create function public.example() returns text language sql as $$select 'old'$$;";
  const quoted = historical.replaceAll("'", "''");
  const evidence = `select '${quoted}'; select $history$${historical}$history$;
    do $verify$ begin perform '${quoted}'; end $verify$;`;
  const first = "create function public.example() returns text language sql as $$select 'first'$$";
  const last = "create or replace function public.example() returns text language sql as $$select 'last;still body'$$";
  assert.equal(functionDefinition(executableStatements(evidence), pattern), undefined);
  for (const sql of [
    `${evidence} -- ${historical}\n /* outer /* nested */ comment */ ${last};`,
    `${first}; ${last}; ${evidence}`,
  ]) {
    assert.equal(functionDefinition(executableStatements(sql), pattern), last);
  }
  // An actual later redefinition must still replace the prior one.
  assert.equal(functionDefinition(executableStatements(`${last}; ${first};`), pattern), first);
  const uppercase = last.replace("create or replace function", "CREATE OR REPLACE FUNCTION");
  assert.equal(functionDefinition(executableStatements(`${first}; ${uppercase};`), pattern), uppercase);
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
