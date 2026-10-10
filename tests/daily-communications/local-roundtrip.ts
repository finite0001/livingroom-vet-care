/** Genuine Auth/PostgREST acceptance against an explicitly selected owned LOCAL stack. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import {
  pageSchema,
  detailSchema,
} from "../../src/hub/features/daily-communications/model.ts";
const project = process.env.DAILY_TEST_PROJECT;
assert.ok(project, "Explicit owned local project required");
const projectId = readFileSync(`${project}/supabase/config.toml`, "utf8").match(
  /^project_id\s*=\s*"([a-zA-Z0-9_-]+)"/m,
)?.[1];
assert.ok(projectId);
const container = `supabase_db_${projectId}`;
const labels = JSON.parse(
  execFileSync("docker", ["inspect", container], { encoding: "utf8" }),
)[0].Config.Labels;
assert.equal(labels["com.supabase.cli.project"], projectId);
assert.equal(labels["com.supabase.cli.workdir"], project);
const status = JSON.parse(
  execFileSync(
    "supabase",
    ["status", "--workdir", project, "--output", "json"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ),
);
assert.match(status.API_URL, /^http:\/\/127\.0\.0\.1:\d+$/);
const sql = (query: string) =>
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      container,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-X",
      "-qAt",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { input: query, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  ).trim();
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(status.API_URL, status.SERVICE_ROLE_KEY, options);
const email = `daily-${randomUUID()}@example.test`,
  password = randomUUID() + randomUUID();
const created = await service.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});
if (created.error) throw created.error;
const actor = created.data.user!.id;
const fixture = readFileSync(
  new URL(
    "../../supabase/tests/daily_communications.test.sql",
    import.meta.url,
  ),
  "utf8",
)
  .split("insert into data values('page'")[0]
  .replace(/create extension[^;]+;/, "")
  .replace("select no_plan();", "")
  .replace(/insert into auth.users[^;]+;/, "")
  .replaceAll("a5520000-0000-4000-8000-000000000001", actor)
  .replaceAll("+12025550139", "+12025550140")
  .replaceAll("daily-client@example.test", email)
  .replaceAll("Daily household", `Daily ${actor}`)
  .replaceAll("daily-duplicate", `daily-duplicate-${actor}`)
  .replaceAll("daily-independent", `daily-independent-${actor}`);
const ids = JSON.parse(
  sql(fixture + "select jsonb_object_agg(k,id) from fx;commit;")
    .split("\n")
    .at(-1)!,
);
const staff = createClient(status.API_URL, status.ANON_KEY, options);
const logged = await staff.auth.signInWithPassword({ email, password });
if (logged.error) throw logged.error;
async function rpc(name: string, args: Record<string, unknown> = {}) {
  const r = await staff.rpc(name, args);
  if (r.error) throw r.error;
  return r.data;
}
let checks = 0;
const args = { p_from: "2026-03-08", p_to: "2026-03-08", p_search: actor };
const page = pageSchema.parse(await rpc("list_daily_communications", args));
assert.equal(page.rows.length, 2);
checks++;
assert.equal(page.rows[0].status, "accepted");
checks++;
assert.equal(page.rows[0].attempt_count, 2);
checks++;
assert.ok(!JSON.stringify(page).includes("PRIVATE"));
checks++;
assert.equal(
  pageSchema.parse(
    await rpc("list_daily_communications", { ...args, p_channel: "EMAIL" }),
  ).rows.length,
  1,
);
checks++;
const first = pageSchema.parse(
  await rpc("list_daily_communications", { ...args, p_limit: 1 }),
);
assert.ok(first.next);
const second = pageSchema.parse(
  await rpc("list_daily_communications", {
    ...args,
    p_before: first.next,
    p_limit: 1,
  }),
);
assert.notEqual(first.rows[0].id, second.rows[0].id);
assert.equal(second.next, null);
checks += 2;
const detail = detailSchema.parse(
  await rpc("read_daily_communication", {
    p_source: "outbox",
    p_id: ids.outbox,
  }),
);
assert.equal(detail.attempts.length, 2);
checks++;
assert.ok(!JSON.stringify(detail).includes("PRIVATE"));
checks++;
assert.equal(
  await rpc("read_daily_communication", {
    p_source: "outbox",
    p_id: randomUUID(),
  }),
  null,
);
checks++;
const anon = createClient(status.API_URL, status.ANON_KEY, options);
assert.equal(
  (await anon.rpc("list_daily_communications", args)).error!.code,
  "42501",
);
checks++;
assert.equal(
  (await staff.rpc("daily_communication_rows_internal")).error!.code,
  "42501",
);
checks++;
sql(`update profiles set is_active=false where id='${actor}';`);
assert.equal(
  (await staff.rpc("list_daily_communications", args)).error!.code,
  "42501",
);
checks++;
assert.equal(
  (
    await staff.rpc("read_daily_communication", {
      p_source: "outbox",
      p_id: ids.outbox,
    })
  ).error!.code,
  "42501",
);
checks++;
console.log(
  JSON.stringify({
    project: projectId,
    synthetic_only: true,
    real_auth_postgrest: true,
    checks,
    provider_requests: 0,
  }),
);
