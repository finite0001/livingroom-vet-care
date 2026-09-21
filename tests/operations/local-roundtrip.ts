/** Actual localhost scheduler/Auth/PostgREST; no provider transport is present. */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createClient } from "@supabase/supabase-js";
import { createReminderSchedulerHandler } from "../../supabase/functions/_shared/reminder-scheduler.ts";
let project = process.env.PAYMENT_TEST_PROJECT ||
  "/tmp/livingroom-vet-foundation";
let temporaryProject = "";
// The existing containers may outlive their /tmp configuration. This config is
// used for status only; this runner never starts, resets, or stops Supabase.
if (
  !process.env.PAYMENT_TEST_PROJECT &&
  !existsSync(`${project}/supabase/config.toml`)
) {
  temporaryProject = mkdtempSync(join(tmpdir(), "lrv-payment-local-"));
  project = temporaryProject;
  mkdirSync(join(project, "supabase"));
  writeFileSync(
    join(project, "supabase/config.toml"),
    'project_id = "livingroom-vet-foundation"\n[api]\nport = 56321\n[db]\nport = 56322\nshadow_port = 56320\n',
  );
  process.once(
    "exit",
    () => rmSync(temporaryProject, { recursive: true, force: true }),
  );
}
const projectId = readFileSync(`${project}/supabase/config.toml`, "utf8").match(
  /^project_id\s*=\s*"([a-zA-Z0-9_-]+)"/m,
)?.[1];
assert.ok(projectId, "Explicit local project required");
const local = JSON.parse(
  execFileSync(
    "supabase",
    ["status", "--workdir", project, "--output", "json"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ),
);
assert.match(local.API_URL, /^http:\/\/127\.0\.0\.1:\d+$/);
const sql = (query: string) =>
  execFileSync("docker", [
    "exec",
    "-i",
    `supabase_db_${projectId}`,
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-X",
    "-q",
    "-t",
    "-A",
    "-v",
    "ON_ERROR_STOP=1",
  ], { input: query, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] })
    .trim();
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;

const ids: string[] = [];
let actor = "", client = "";
let assertions = 0;
const failures: unknown[] = [];
const check = (value: unknown, message: string) => {
  assert.ok(value, message);
  assertions++;
};
const serviceHeaders = {
  apikey: local.ANON_KEY,
  Authorization: `Bearer ${local.SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
};
let staffHeaders: Record<string, string> = {};
async function api(path: string, args: unknown, headers = serviceHeaders) {
  const response = await fetch(local.API_URL + path, {
    method: "POST",
    headers,
    body: JSON.stringify(args),
  });
  if (!response.ok) {
    const failure = await response.json().catch(() => null);
    const code =
      typeof failure?.code === "string" && /^[A-Z0-9]{5}$/.test(failure.code)
        ? failure.code
        : "unknown";
    throw new Error(
      `Local fixture ${path} failed: HTTP ${response.status}, SQL ${code}`,
    );
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
const rpc = (name: string, args: Record<string, unknown>, staff = false) =>
  api("/rest/v1/rpc/" + name, args, staff ? staffHeaders : serviceHeaders);

const service = createClient(local.API_URL, local.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const env = {
  SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY,
  REMINDER_SCHEDULER_ENABLED: "true",
  APP_ENV: "staging",
};
let mode = "normal", dbCalls = 0;
const calls: string[] = [];
const runIds: string[] = [];
const handler = () =>
  createReminderSchedulerHandler({
    ...env,
    REMINDER_SCHEDULER_ENABLED: mode === "disabled" ? "false" : "true",
  }, () => ({
    rpc: async (name, args) => {
      dbCalls++;
      calls.push(name);
      if (name === "start_reminder_scheduler_run") {
        runIds.push(String(args.p_run_id));
      }
      const result = await service.rpc(name, args);
      if (result.error) return result;
      if (
        (mode === "lost-start" && name.startsWith("start_")) ||
        (mode === "lost-execute" && name.startsWith("execute_"))
      ) throw new Error("Synthetic lost response after real commit");
      if (mode === "malformed-execute" && name.startsWith("execute_")) {
        return { data: { outcome: "completed" }, error: null };
      }
      return result;
    },
  }));
const server = createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (value) {
        headers.set(name, Array.isArray(value) ? value.join(",") : value);
      }
    }
    const response = await handler()(
      new Request("http://127.0.0.1/queue-reminders", {
        method: req.method,
        headers,
        ...(req.method === "POST" ? { body: Buffer.concat(chunks) } : {}),
      }),
    );
    res.writeHead(response.status, Object.fromEntries(response.headers)).end(
      await response.text(),
    );
  } catch {
    res.writeHead(500).end();
  }
});
let listening = false;
try {
  check(
    sql(
      "select count(*) from public.reminder_automation_policies where enabled;",
    ) === "0",
    "No existing enabled automation policy may consume unrelated work",
  );
  const email = `operations-${randomUUID()}@example.test`,
    password = `Synthetic-${randomUUID()}-Aa1!`;
  actor = (await api("/auth/v1/admin/users", {
    email,
    password,
    email_confirm: true,
  })).id;
  // A1 (#164): handle_new_user no longer activates a new auth user, so a fixture
  // that needs an active synthetic staff member must activate it explicitly.
  sql(`insert into public.user_roles(user_id,role) values(${quote(actor)},'STAFF') on conflict do nothing; update public.profiles set is_active=true where id=${quote(actor)};`);
  ids.push(actor);
  const auth = await api("/auth/v1/token?grant_type=password", {
    email,
    password,
  }, { apikey: local.ANON_KEY, "Content-Type": "application/json" });
  staffHeaders = {
    apikey: local.ANON_KEY,
    Authorization: `Bearer ${auth.access_token}`,
    "Content-Type": "application/json",
  };
  await assert.rejects(rpc("operations_overview", {}, true), /HTTP 403/);
  check(true, "Non-admin cannot read operations overview");
  sql(
    `insert into public.user_roles(user_id,role) values(${
      quote(actor)
    },'ADMIN') on conflict do nothing;`,
  );
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  listening = true;
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const endpoint = `http://127.0.0.1:${address.port}/queue-reminders`;
  const post = (body = "{}", token = local.SERVICE_ROLE_KEY) =>
    fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body,
    });
  check(
    (await post("{}", auth.access_token)).status === 401,
    "Real staff JWT cannot invoke service scheduler",
  );
  mode = "disabled";
  check(
    (await (await post()).json()).disabled === true && dbCalls === 0,
    "Disabled actual HTTP handler performs zero database work",
  );
  mode = "normal";
  check(
    (await post('{"limit":101}')).status === 400 && dbCalls === 0,
    "Unbounded limit denied before database initialization",
  );
  const template = randomUUID(), source = randomUUID(), policy = randomUUID();
  ids.push(template, source, policy);
  const fixture = sql(
    `begin;set local role authenticated;select set_config('request.jwt.claims',${
      quote(JSON.stringify({ sub: actor, role: "authenticated" }))
    },true);
 create temp table owned(kind text,id uuid);
 insert into owned select 'client',id from public.save_client(auth.uid(),null,null,'Synthetic','Operations',null,${
      quote(email)
    },'EMAIL',null,null);
 insert into owned select 'pet',id from public.save_patient(null,(select id from owned where kind='client'),null,'Synthetic Patient','Dog',null,null,'unknown',null,'unknown','unknown',null,null,null);
 select public.save_care_message_template(${
      quote(template)
    },null,'Synthetic reviewed reminder','email',0,'{{patient_name}}: {{care_name}} due {{due_date}}',true,'Synthetic review');
 select public.save_patient_lab_order(${
      quote(source)
    },(select id from owned where kind='pet'),null,jsonb_build_object('test_name','Synthetic lab','status','planned','due_date',(now() at time zone 'America/Denver')::date),'');
 select public.save_reminder_automation_policy(${
      quote(policy)
    },null,'lab','EMAIL',${
      quote(template)
    },1,'Synthetic reviewed reminder',true,'Synthetic explicit enable');
 select json_object_agg(kind,id) from owned;commit;`,
  );
  const owned = JSON.parse(
    fixture.split("\n").find((line) => line.includes('"client" :'))!,
  );
  client = owned.client;
  ids.push(client, owned.pet);
  const candidates = await rpc("operations_reminder_candidates", {}, true);
  check(
    candidates.items.length === 1 && candidates.items[0].source_id === source &&
      candidates.items[0].job_id === null && !candidates.has_more,
    "Discovery sees exactly the owned due source before any job exists",
  );
  check(
    Object.keys(candidates.items[0]).sort().join(",") ===
      "channel,cursor_key,eligible_at,job_id,job_kind,pet_id,policy_id,source_id,source_kind,source_version,template_id,template_version",
    "Candidate PostgREST shape matches bounded safe UI contract",
  );
  mode = "lost-start";
  const lostStart = await post();
  const unresolved = await lostStart.json();
  check(
    lostStart.status === 202 && unresolved.outcome === "started" &&
      unresolved.counts === null,
    "Lost start ACK recovers actual unresolved receipt without invented zero counts",
  );
  check(
    calls.join(",") ===
      "start_reminder_scheduler_run,recover_reminder_scheduler_run",
    "Lost start ACK cannot invoke queue execution",
  );
  check(
    sql(
      `select count(*) from public.care_reminder_jobs where source_id=${
        quote(source)
      };`,
    ) === "0",
    "Unresolved start creates no reminder job",
  );
  mode = "lost-execute";
  calls.length = 0;
  const response = await post();
  const result = await response.json();
  check(
    response.status === 200 && result.outcome === "completed" &&
      result.counts.queued === 1 && result.dispatched === false,
    "Lost execute ACK recovers actual committed one-job outcome",
  );
  check(
    calls.join(",") ===
      "start_reminder_scheduler_run,execute_reminder_scheduler_run,recover_reminder_scheduler_run",
    "Uncertain execute performs read-only receipt recovery only",
  );
  const handoff = JSON.parse(
    sql(
      `select row_to_json(h) from public.reminder_outbox_links h where policy_id=${
        quote(policy)
      };`,
    ),
  );
  ids.push(handoff.job_id, handoff.outbox_id);
  check(
    handoff.state === "queued" && Boolean(handoff.outbox_id),
    "Actual scheduler atomically creates one frozen handoff",
  );
  check(
    sql(
      `select state||':'||attempt_count from public.communication_outbox where id=${
        quote(handoff.outbox_id)
      };`,
    ) === "pending:0",
    "Queued reminder has no provider attempt or acceptance claim",
  );
  const replay = await rpc("execute_reminder_scheduler_run", {
    p_run_id: result.run_id,
  });
  check(
    replay.counts.queued === 1 &&
      sql(
          `select count(*) from public.reminder_outbox_links where policy_id=${
            quote(policy)
          };`,
        ) === "1",
    "Terminal SQL replay recovers original counts without a duplicate handoff",
  );
  await assert.rejects(
    rpc("start_reminder_scheduler_run", {
      p_run_id: result.run_id,
      p_limit: 2,
    }),
    /SQL 23505/,
  );
  check(true, "Changed immutable run limit rejected by actual SQL");
  mode = "malformed-execute";
  calls.length = 0;
  const repaired = await (await post()).json();
  check(
    repaired.outcome === "completed" && repaired.counts.queued === 0 &&
      calls.at(-1) === "recover_reminder_scheduler_run",
    "Malformed execute projection recovers authoritative receipt without replay",
  );
  const runs = await rpc("operations_scheduler_runs", { p_limit: 100 }, true);
  check(
    Array.isArray(runs.items) && typeof runs.has_more === "boolean" &&
      runs.items.some((r: { run_id: string; outcome: string }) =>
        r.run_id === unresolved.run_id && r.outcome === "started"
      ),
    "Real ADMIN run discovery retains unresolved and terminal evidence",
  );
  check(
    Object.keys(
      runs.items.find((r: { run_id: string }) => r.run_id === result.run_id),
    ).sort().join(",") ===
      "counts,failure_code,finished_at,outcome,requested_limit,run_id,started_at",
    "Run UI discovery exposes only safe exact envelope fields",
  );
  const overview = await rpc("operations_overview", {}, true);
  check(
    overview.reminders.candidate_count === 0 &&
      overview.reminders.unresolved_runs >= 1 &&
      overview.reminders.last_run.run_id === repaired.run_id,
    "Overview distinguishes drained candidates from unresolved scheduler evidence",
  );
  const outbox = await rpc("operations_outbox", {
    p_filter: "pending",
    p_limit: 100,
  }, true);
  const item = outbox.items.find((r: { id: string }) =>
    r.id === handoff.outbox_id
  );
  check(
    item && item.state === "pending" && item.attempt_count === 0 &&
      !("body" in item) && !("recipient" in item),
    "Outbox discovery returns safe operational state without message or recipient payload",
  );
  for (
    const name of ["operations_reminder_blocks", "read_stripe_event_queue_page"]
  ) {
    const page = await rpc(name, { p_limit: 2 }, true);
    check(
      Array.isArray(page.items) && typeof page.has_more === "boolean",
      `${name} actual ADMIN response uses bounded page envelope`,
    );
  }
  await assert.rejects(
    rpc("recover_reminder_scheduler_run", { p_run_id: result.run_id }, true),
    /HTTP 403/,
  );
  check(
    true,
    "Admin discovery permission does not grant service run RPC access",
  );
} catch (error) {
  failures.push(error);
} finally {
  if (listening) {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve())
    );
  }
  try {
    ids.push(...runIds);
    if (client) {
      ids.push(
        ...JSON.parse(
          sql(
            `select coalesce(json_agg(id),'[]'::json) from (select id from public.conversations where client_id=${
              quote(client)
            } union select m.id from public.messages m join public.conversations c on c.id=m.conversation_id where c.client_id=${
              quote(client)
            } union select id from public.care_reminder_jobs where client_id=${
              quote(client)
            } union select id from public.communication_outbox where client_id=${
              quote(client)
            }) owned;`,
          ),
        ),
      );
    }
    if (ids.length) {
      const patterns = ids.filter(Boolean).map((value) => quote(`%${value}%`))
        .join(",");
      sql(
        `begin;set local session_replication_role=replica;do $cleanup$ declare t record;begin for t in select schemaname,tablename from pg_tables where schemaname='public' loop execute format('delete from %I.%I r where to_jsonb(r)::text like any ($1)',t.schemaname,t.tablename) using array[${patterns}];end loop;end $cleanup$;commit;`,
      );
      sql(
        `do $verify$ declare t record;n bigint;begin for t in select schemaname,tablename from pg_tables where schemaname='public' loop execute format('select count(*) from %I.%I r where to_jsonb(r)::text like any ($1)',t.schemaname,t.tablename) into n using array[${patterns}];if n<>0 then raise exception 'Synthetic fixture cleanup incomplete';end if;end loop;end $verify$;`,
      );
      check(true, "Owned synthetic application records cleaned and verified");
    }
    if (actor) {
      check(
        (await fetch(local.API_URL + "/auth/v1/admin/users/" + actor, {
          method: "DELETE",
          headers: serviceHeaders,
        })).ok,
        "Synthetic Auth identity cleaned",
      );
    }
  } catch (error) {
    failures.push(error);
  }
}
if (failures.length) {
  throw new AggregateError(
    failures,
    "Local scheduler workflow or cleanup failed",
  );
}
console.log(
  `Local scheduler HTTP/Auth/PostgREST: ${assertions} checks passed. No provider transport or sends.`,
);
