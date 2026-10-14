/** Real Auth/PostgREST task contracts in an explicitly owned local runtime. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { createClient, type Session } from "@supabase/supabase-js";
import { parseOwnedRuntimeStatus } from "../estimates/owned-runtime-status.ts";
import { catalogEntrySchema } from "../../src/hub/features/scheduling/catalog-model.ts";
import {
  operationalTemplateSchema,
  operationalUseSchema,
  operationalTaskSchema,
  operationalPolicySchema,
  taskDefinitionSchema,
  type TaskDefinition,
} from "../../src/hub/features/daily-tasks/task-model.ts";
const project = process.env.SCHEDULING_TEST_PROJECT;
assert.ok(project && process.env.SCHEDULING_RUN_SYNTHETIC_LOCAL === "true");
const identity = readFileSync(`${project}/supabase/config.toml`, "utf8").match(
  /^project_id\s*=\s*"([a-zA-Z0-9_-]+)"/m,
)?.[1];
assert.ok(
  identity &&
    (identity.startsWith("lrv-tasks-") || identity.startsWith("lrv-catalog-")),
);
const container = "supabase_db_" + identity;
const labels = JSON.parse(
  execFileSync("docker", ["inspect", container], { encoding: "utf8" }),
)[0].Config.Labels;
assert.equal(labels["com.supabase.cli.project"], identity);
assert.equal(
  realpathSync(labels["com.supabase.cli.workdir"]),
  realpathSync(project),
);
const status = parseOwnedRuntimeStatus(
  execFileSync(
    "supabase",
    ["status", "--workdir", project, "--output", "json", "--agent", "no"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ),
);
function sql(query: string, database = "postgres") {
  return execFileSync(
    "docker",
    [
      "exec",
      "-i",
      container,
      "psql",
      "-X",
      "-qAt",
      "-U",
      "postgres",
      "-d",
      database,
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { input: query, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  ).trim();
}
const options = { auth: { persistSession: false, autoRefreshToken: false } },
  service = createClient(status.API_URL, status.SERVICE_ROLE_KEY, options);
const actors: {
  id: string;
  db: ReturnType<typeof createClient>;
  session: Session | null;
  email: string;
  password: string;
}[] = [];
let checks = 0,
  observedLocks = 0,
  dropNext = false,
  dropped = false;
function check(actual: unknown, expected: unknown) {
  assert.deepEqual(actual, expected);
  checks++;
}
async function actor(role: string) {
  const email = `synthetic-task-${randomUUID()}@example.test`,
    password = randomUUID() + randomUUID();
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  const id = data.user!.id;
  sql(
    `update profiles set is_active=true,full_name='Synthetic task ${role}' where id='${id}';insert into user_roles(user_id,role) values('${id}','${role}') on conflict do nothing;`,
  );
  const db = createClient(status.API_URL, status.ANON_KEY, {
    ...options,
    global: {
      fetch: async (input, init) => {
        const result = await fetch(input, init);
        if (
          dropNext &&
          String(input).endsWith("/rpc/execute_operational_review") &&
          result.ok
        ) {
          dropNext = false;
          await result.arrayBuffer();
          dropped = true;
          throw new TypeError(
            "Synthetic successful acknowledgment intentionally dropped",
          );
        }
        return result;
      },
    },
  });
  actors.push({ id, db, session: null, email, password });
  const login = await db.auth.signInWithPassword({ email, password });
  if (login.error) throw login.error;
  actors[actors.length - 1].session = login.data.session;
  return actors[actors.length - 1];
}
async function rpc(
  a: (typeof actors)[number],
  name: string,
  args: Record<string, unknown>,
) {
  const { data, error } = await a.db.rpc(name, args);
  if (error)
    throw Object.assign(new Error(`${name}: ${error.message}`), {
      code: error.code,
    });
  return data;
}
async function denied(
  a: (typeof actors)[number],
  name: string,
  args: Record<string, unknown>,
  code: string,
) {
  const { error } = await a.db.rpc(name, args);
  check(error?.code, code);
}
async function op(
  a: (typeof actors)[number],
  operation: string,
  request: unknown,
  id = randomUUID(),
) {
  await rpc(a, "prepare_operational_review", {
    p_actor_id: a.id,
    p_action_id: id,
    p_operation: operation,
    p_request: request,
  });
  return rpc(a, "execute_operational_review", {
    p_actor_id: a.id,
    p_action_id: id,
  });
}
async function lockProof(
  a: (typeof actors)[number],
  actionId: string,
  care: boolean,
) {
  const tag = "lrv_task_lock_" + randomUUID().replaceAll("-", "");
  const holder = spawn(
    "docker",
    [
      "exec",
      "-i",
      container,
      "psql",
      "-X",
      "-qAt",
      "-U",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  let output = "",
    error = "";
  holder.stdout.on("data", (bytes) => (output += bytes));
  holder.stderr.on("data", (bytes) => (error += bytes));
  async function until(predicate: () => boolean) {
    for (let n = 0; n < 200; n++) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error("Owned lock condition not observed");
  }
  try {
    holder.stdin.write(
      `begin;set application_name='${tag}';select ${care ? "public.care_eligibility_lock()" : "pg_advisory_xact_lock(73260123)"};select '${tag}_ready';\n`,
    );
    await until(() => output.includes(tag + "_ready"));
    const pending = rpc(a, "execute_operational_review", {
      p_actor_id: a.id,
      p_action_id: actionId,
    });
    await until(
      () =>
        sql(
          `select count(*) from pg_stat_activity where datname='postgres' and wait_event_type='Lock' and query like '%execute_operational_review%';`,
        ) !== "0",
    );
    observedLocks++;
    holder.stdin.end("commit;\n\\q\n");
    const result = await pending;
    await new Promise<void>((resolve, reject) => {
      if (holder.exitCode !== null)
        return holder.exitCode === 0 ? resolve() : reject(new Error(error));
      holder.once("exit", (code) =>
        code === 0 ? resolve() : reject(new Error(error)),
      );
    });
    return result;
  } finally {
    if (holder.exitCode === null) holder.kill("SIGTERM");
  }
}
let failed = false;
let failure: unknown;
try {
  const admin = await actor("ADMIN"),
    staff = await actor("STAFF"),
    other = await actor("STAFF"),
    tech = await actor("TECH");
  sql(
    `delete from user_roles where user_id='${tech.id}';insert into user_roles(user_id,role) values('${tech.id}','TECH');update profiles set role='TECH' where id='${tech.id}';`,
  );
  sql(
    `insert into user_roles(user_id,role) values('${admin.id}','DVM') on conflict do nothing;`,
  );
  check(
    JSON.parse(
      sql(
        "select jsonb_build_object('count',count(*),'latest',max(version)) from supabase_migrations.schema_migrations;",
      ),
    ),
    { count: 184, latest: "20261014022511" },
  );
  const household = randomUUID(),
    pet = randomUUID();
  const phone = sql(
    "select candidate from (select '+120255501'||lpad(n::text,2,'0') candidate from generate_series(0,99)n)s where not exists(select 1 from clients where primary_phone=s.candidate) limit 1;",
  );
  sql(
    `insert into clients(id,first_name,last_name,full_name,primary_phone,primary_email,preferred_channel) values('${household}','Synthetic','Task household','Synthetic Task household','${phone}','synthetic-task-${randomUUID()}@example.test','EMAIL');insert into pets(id,client_id,name,species) values('${pet}','${household}','Synthetic Task Dog','Dog');`,
  );
  async function catalog(kind: string, definition: unknown) {
    const id = randomUUID();
    const base = {
      p_actor_id: admin.id,
      p_id: id,
      p_kind: kind,
      p_values: {
        definition,
        review_note: "Synthetic exact catalog review",
        attest_review: true,
      },
    };
    await rpc(admin, "save_appointment_catalog", {
      ...base,
      p_action_id: randomUUID(),
      p_expected_version: null,
      p_action: "draft",
    });
    return catalogEntrySchema.parse(
      await rpc(admin, "save_appointment_catalog", {
        ...base,
        p_action_id: randomUUID(),
        p_expected_version: 1,
        p_action: "publish",
      }),
    );
  }
  const room = await catalog("resource", {
    name: "Synthetic task room " + randomUUID().slice(0, 8),
    resource_kind: "procedure",
    visit_types: ["clinic"],
    aliases: [],
  });
  const type = await catalog("type", {
    name: "Synthetic reviewed surgery " + randomUUID().slice(0, 8),
    category: "procedure",
    species: ["Dog"],
    visit_types: ["clinic"],
    duration_minutes: 30,
    travel_before_minutes: 0,
    travel_after_minutes: 0,
    resource_kind: "procedure",
    staffing: "staff",
    allow_override: false,
  });
  const item = randomUUID();
  function definition(trigger: TaskDefinition["trigger"]): TaskDefinition {
    return taskDefinitionSchema.parse({
      name: "Synthetic operational " + trigger,
      category:
        trigger === "before_visit"
          ? "preparation"
          : trigger === "after_use"
            ? "turnover"
            : "restock",
      trigger,
      selectors: {
        types:
          trigger === "before_visit"
            ? [{ entry_id: type.id, version_id: type.published!.id }]
            : [],
        resources: [{ entry_id: room.id, version_id: room.published!.id }],
      },
      due: {
        offset_minutes: trigger === "resource_day" ? 0 : 15,
        local_time: trigger === "resource_day" ? "18:00" : null,
        dst_resolution: "reject",
      },
      eligible_roles: ["STAFF", "DVM", "ADMIN"],
      assignment: "unassigned",
      assignee_id: null,
      checklist: [
        { id: item, label: "Synthetic approved SOP task", required: true },
      ],
      sop_reference: "Synthetic approved SOP",
    });
  }
  const templates = [];
  for (const trigger of [
    "before_visit",
    "after_use",
    "resource_day",
  ] as const) {
    const id = randomUUID(),
      request = {
        id,
        expected_version: null,
        action: "draft",
        definition: definition(trigger),
        review_note: "Synthetic reviewed template",
        attest_review: true,
      };
    operationalTemplateSchema.parse(await op(admin, "template", request));
    const actionId = randomUUID();
    await rpc(admin, "prepare_operational_review", {
      p_actor_id: admin.id,
      p_action_id: actionId,
      p_operation: "template",
      p_request: { ...request, expected_version: 1, action: "publish" },
    });
    const published =
      trigger === "before_visit"
        ? await lockProof(admin, actionId, false)
        : trigger === "after_use"
          ? await lockProof(admin, actionId, true)
          : await rpc(admin, "execute_operational_review", {
              p_actor_id: admin.id,
              p_action_id: actionId,
            });
    templates.push(operationalTemplateSchema.parse(published));
    check(templates.at(-1)!.published!.state, "published");
    await denied(
      other,
      "read_operational_review",
      { p_actor_id: other.id, p_action_id: actionId },
      "42501",
    );
  }
  check(await rpc(staff, "read_operational_generation_policy", {}), null);
  operationalPolicySchema.parse(
    await op(admin, "policy", {
      expected_version: null,
      enabled: true,
      effective_from: new Date(Date.now() - 86400000).toISOString(),
      effective_until: new Date(Date.now() + 86400000).toISOString(),
      review_note: "Synthetic bounded generation",
      attest_review: true,
    }),
  );
  const booking = await rpc(staff, "save_catalog_appointment", {
    p_actor_id: staff.id,
    p_action_id: randomUUID(),
    p_id: null,
    p_expected_version: null,
    p_values: {
      type_version_id: type.published!.id,
      resource_version_id: room.published!.id,
      client_id: household,
      pet_id: pet,
      scheduled_at: new Date(Date.now() + 3600000).toISOString(),
      duration_minutes: 30,
      status: "SCHEDULED",
      assigned_dvm_id: staff.id,
      visit_type: "clinic",
      address_snapshot: "Synthetic",
      travel_before_minutes: 0,
      travel_after_minutes: 0,
      notes: "Synthetic",
      reminder_offsets: [],
      override_note: "",
    },
  });
  const prepId = sql(
    `select id from operational_tasks where appointment_id='${booking.appointment.id}';`,
  );
  check(
    operationalTaskSchema.parse(
      JSON.parse(sql(`select operational_task_view('${prepId}');`)),
    ).current.state,
    "pending",
  );
  const useRequest = {
    id: randomUUID(),
    expected_version: null,
    action: "start",
    appointment_id: booking.appointment.id,
    appointment_version: 1,
    resource_version_id: room.published!.id,
    started_at: new Date(Date.now() - 60000).toISOString(),
    ended_at: null,
    reason: "Synthetic staff actual-use assertion",
    allow_overlap: false,
    attest_closed_source: false,
  };
  const started = operationalUseSchema.parse(
    await op(staff, "use", useRequest),
  );
  check(started.current.facts.state, "open");
  await rpc(staff, "cancel_appointment", {
    p_id: booking.appointment.id,
    p_expected_version: 1,
  });
  check(
    operationalTaskSchema.parse(
      JSON.parse(sql(`select operational_task_view('${prepId}');`)),
    ).current.state,
    "needs_review",
  );
  const ended = operationalUseSchema.parse(
    await op(staff, "use", {
      ...useRequest,
      expected_version: 1,
      appointment_version: 2,
      action: "end",
      ended_at: new Date(sql("select clock_timestamp();")).toISOString(),
      reason: "Synthetic explicit end after cancellation",
    }),
  );
  check(ended.version, 2);
  const cleanupId = sql(
      `select id from operational_tasks where use_id='${started.id}';`,
    ),
    restockId = sql(
      `select id from operational_tasks where resource_id='${room.id}' and day_key is not null;`,
    );
  const inventoryBefore = sql(
    "select jsonb_build_object('lots',(select coalesce(jsonb_agg(to_jsonb(l) order by l.id),'[]') from inventory_lots l),'movements',(select coalesce(jsonb_agg(to_jsonb(m) order by m.id),'[]') from inventory_movements m));",
  );
  let savedActionId = "";
  for (const id of [cleanupId, restockId]) {
    const task = operationalTaskSchema.parse(
        JSON.parse(sql(`select operational_task_view('${id}');`)),
      ),
      actionId = randomUUID();
    const request = {
      id,
      expected_version: task.version,
      context_hash: task.context_hash,
      action: "complete",
      assignee_id: null,
      checked_ids: [item],
      note: "Synthetic required checklist attestation",
      due_at: null,
      template_version_id: null,
    };
    await rpc(staff, "prepare_operational_review", {
      p_actor_id: staff.id,
      p_action_id: actionId,
      p_operation: "task",
      p_request: request,
    });
    savedActionId = actionId;
    dropNext = true;
    const uncertain = await staff.db.rpc("execute_operational_review", {
      p_actor_id: staff.id,
      p_action_id: actionId,
    });
    assert.ok(uncertain.error);
    check(dropped, true);
    dropped = false;
    const recovered = await rpc(staff, "read_operational_review", {
      p_actor_id: staff.id,
      p_action_id: actionId,
    });
    check(recovered.state, "saved");
    check(
      operationalTaskSchema.parse(recovered.receipt).current.state,
      "completed",
    );
    check(
      await rpc(staff, "execute_operational_review", {
        p_actor_id: staff.id,
        p_action_id: actionId,
      }),
      recovered.receipt,
    );
  }
  const completed = sql(
    `select jsonb_agg(to_jsonb(r) order by r.id) from operational_tasks t join operational_task_revisions r on r.id=t.head_id where t.id in('${cleanupId}','${restockId}');`,
  );
  operationalPolicySchema.parse(
    await op(admin, "policy", {
      expected_version: 1,
      enabled: false,
      effective_from: null,
      effective_until: null,
      review_note: "Synthetic generation pause",
      attest_review: true,
    }),
  );
  operationalUseSchema.parse(
    await op(admin, "use", {
      ...useRequest,
      expected_version: 2,
      appointment_version: 2,
      action: "correct",
      ended_at: new Date(sql("select clock_timestamp();")).toISOString(),
      reason: "Synthetic corrected use while generation paused",
    }),
  );
  check(
    sql(
      `select jsonb_agg(to_jsonb(r) order by r.id) from operational_tasks t join operational_task_revisions r on r.id=t.head_id where t.id in('${cleanupId}','${restockId}');`,
    ),
    completed,
  );
  check(
    sql(
      `select count(*) from operational_tasks t join operational_task_revisions r on r.id=t.head_id where t.resource_id='${room.id}' and r.state='needs_review';`,
    ),
    "3",
  );
  check(sql("select count(*) from communication_outbox;"), "0");
  check(
    sql(
      "select jsonb_build_object('lots',(select coalesce(jsonb_agg(to_jsonb(l) order by l.id),'[]') from inventory_lots l),'movements',(select coalesce(jsonb_agg(to_jsonb(m) order by m.id),'[]') from inventory_movements m));",
    ),
    inventoryBefore,
  );
  const { operationalBrowserProof } =
    await import("./operational-tasks-browser.ts");
  const browserChecks = await operationalBrowserProof({
    status,
    admin,
    staff,
    other,
    tech,
    client: household,
    pet,
    room: room as unknown as {
      id: string;
      published: { id: string; definition: { name: string } };
    },
    type: type as unknown as { published: { id: string } },
    sql,
    rpc,
  });
  const cancelledId = randomUUID();
  await rpc(staff, "cancel_operational_review", {
    p_actor_id: staff.id,
    p_action_id: cancelledId,
  });
  const pendingId = randomUUID();
  await rpc(admin, "prepare_operational_review", {
    p_actor_id: admin.id,
    p_action_id: pendingId,
    p_operation: "template",
    p_request: {
      id: templates[0].id,
      expected_version: 2,
      action: "draft",
      definition: definition("before_visit"),
      review_note: "Synthetic pending review for restore",
      attest_review: true,
    },
  });
  const tables = [
    "operational_task_templates",
    "operational_task_template_versions",
    "operational_resource_uses",
    "operational_resource_use_events",
    "operational_task_enrollments",
    "operational_tasks",
    "operational_task_revisions",
    "operational_task_use_coverage",
    "operational_task_generation_policy",
    "operational_task_actions",
    "operational_task_reviews",
    "operational_task_review_cancellations",
  ];
  for (const table of tables) {
    const staffRead = await staff.db.from(table).select("*");
    check(staffRead.error?.code, "42501");
    const serviceRead = await service.from(table).select("*");
    check(serviceRead.error?.code, "42501");
  }
  const snapshot =
    "select jsonb_object_agg(name,rows) from (" +
    tables
      .map(
        (table) =>
          `select '${table}' name,coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) rows from ${table} t`,
      )
      .join(" union all ") +
    ") s;";
  const before = sql(snapshot),
    restored =
      "owned_task_restore_" + randomUUID().replaceAll("-", "").slice(0, 12),
    marker = randomUUID();
  sql(
    `create database "${restored}";comment on database "${restored}" is '${marker}';`,
  );
  try {
    sql(
      'drop schema public;create schema extensions;create extension pgcrypto with schema extensions;create extension "uuid-ossp" with schema extensions;',
      restored,
    );
    const dump = execFileSync(
      "docker",
      [
        "exec",
        container,
        "pg_dump",
        "-U",
        "postgres",
        "--no-owner",
        "--schema=public",
        "--schema=auth",
        "--schema=storage",
        "--schema=extensions",
        "postgres",
      ],
      { maxBuffer: 50 * 1024 * 1024 },
    );
    execFileSync(
      "docker",
      [
        "exec",
        "-i",
        container,
        "psql",
        "-X",
        "-q",
        "-U",
        "postgres",
        "-d",
        restored,
        "-v",
        "ON_ERROR_STOP=1",
      ],
      {
        input: dump
          .toString()
          .replace(
            "CREATE SCHEMA extensions;",
            "CREATE SCHEMA IF NOT EXISTS extensions;",
          )
          .split("\n")
          .filter((line) => !line.startsWith("ALTER DEFAULT PRIVILEGES"))
          .join("\n"),
        stdio: ["pipe", "ignore", "pipe"],
        maxBuffer: 50 * 1024 * 1024,
      },
    );
    check(sql(snapshot, restored), before);
    check(
      sql(
        "select has_table_privilege('authenticated','operational_task_reviews','SELECT');",
        restored,
      ),
      "f",
    );
    function claims(a: (typeof actors)[number]) {
      return a.db.auth.getSession().then(({ data, error }) => {
        if (error) throw error;
        return JSON.stringify({
          sub: a.id,
          role: "authenticated",
          session_id: JSON.parse(
            Buffer.from(
              data.session!.access_token.split(".")[1],
              "base64url",
            ).toString(),
          ).session_id,
        });
      });
    }
    check(
      sql(
        `set role authenticated;set request.jwt.claims='${await claims(staff)}';select read_operational_review('${staff.id}','${savedActionId}')->>'state';`,
        restored,
      ),
      "saved",
    );
    check(
      sql(
        `set role authenticated;set request.jwt.claims='${await claims(admin)}';select read_operational_review('${admin.id}','${pendingId}')->>'state';`,
        restored,
      ),
      "prepared",
    );
  } finally {
    check(
      sql(
        `select shobj_description(oid,'pg_database') from pg_database where datname='${restored}';`,
      ),
      marker,
    );
    sql(`drop database "${restored}";`);
  }
  check(observedLocks, 2);
  console.log(
    `Genuine local operational tasks passed: ${checks} checks; ${observedLocks} observed lock queues; ${browserChecks} browser checks; populated task restore; no provider requests.`,
  );
} catch (cause) {
  failed = true;
  failure = cause;
} finally {
  for (const a of actors) {
    try {
      sql(
        `update profiles set is_active=false where id='${a.id}';update auth.sessions set not_after=clock_timestamp() where user_id='${a.id}';delete from auth.refresh_tokens where user_id='${a.id}';`,
      );
      const result = await a.db.auth.signOut();
      assert.ifError(result.error);
    } catch (cause) {
      if (!failed) {
        failed = true;
        failure = cause;
      }
    }
  }
}
if (failed) throw failure;
