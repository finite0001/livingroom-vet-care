/** Genuine next-visit Auth/PostgREST, observed schedule locks and populated restore. */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parseOwnedRuntimeStatus } from "../estimates/owned-runtime-status.ts";
import {
  catalogEntrySchema,
  bindingSchema,
} from "../../src/hub/features/scheduling/catalog-model.ts";
const project = process.env.SCHEDULING_TEST_PROJECT;
assert.ok(
  project && process.env.SCHEDULING_RUN_SYNTHETIC_LOCAL === "true",
  "Explicit owned local opt-in required",
);
const identity = readFileSync(`${project}/supabase/config.toml`, "utf8").match(
  /^project_id\s*=\s*"([a-zA-Z0-9_-]+)"/m,
)?.[1];
assert.ok(identity?.startsWith("lrv-catalog-"));
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
function sql(query: string, db = "postgres") {
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
      db,
      "-v",
      "ON_ERROR_STOP=1",
    ],
    {
      input: query,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 20 * 1024 * 1024,
    },
  ).trim();
}
interface Actor {
  id: string;
  db: SupabaseClient;
  session: unknown;
}
const options = { auth: { persistSession: false, autoRefreshToken: false } },
  service = createClient(status.API_URL, status.SERVICE_ROLE_KEY, options);
const actors: Actor[] = [];
let checks = 0,
  observed = 0;
const check = (actual: unknown, expected: unknown) => {
  assert.deepEqual(actual, expected);
  checks++;
};
async function actor(role: string) {
  const email = `synthetic-catalog-${randomUUID()}@example.test`,
    password = randomUUID() + randomUUID();
  const created = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error) throw created.error;
  const id = created.data.user!.id,
    db = createClient(status.API_URL, status.ANON_KEY, options);
  sql(
    `update profiles set is_active=true,full_name='Synthetic catalog ${role}' where id='${id}';insert into user_roles(user_id,role) values('${id}','${role}') on conflict do nothing;`,
  );
  const login = await db.auth.signInWithPassword({ email, password });
  if (login.error) throw login.error;
  const value = { id, db, session: login.data.session };
  actors.push(value);
  return value;
}
async function rpc(
  db: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
) {
  const { data, error } = await db.rpc(name, args);
  if (error)
    throw Object.assign(new Error(`Synthetic ${name}: ${error.message}`), {
      code: error.code,
    });
  return data;
}
async function denied(
  db: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
  code: string,
) {
  const { error } = await db.rpc(name, args);
  check(error?.code, code);
}
async function waitUntil(predicate: () => boolean, description: string) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Did not observe " + description);
}
async function heldSchedule() {
  const marker = "owned_catalog_lock_" + randomUUID().replaceAll("-", "");
  const process = spawn(
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
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { stdio: ["pipe", "ignore", "ignore"] },
  );
  process.stdin.write(
    `set application_name='${marker}';begin;select pg_advisory_xact_lock(73260123);\n`,
  );
  await waitUntil(
    () =>
      sql(
        `select count(*) from pg_stat_activity where application_name='${marker}' and state='idle in transaction';`,
      ) === "1",
    "owned global lock holder",
  );
  return async () => {
    process.stdin.end("commit;\n");
    await new Promise<void>((resolve, reject) =>
      process.on("exit", (code) =>
        code === 0 ? resolve() : reject(new Error("Owned holder failed")),
      ),
    );
  };
}
async function waiters(number: number) {
  await waitUntil(
    () =>
      Number(
        sql(
          "select count(*) from pg_stat_activity where wait_event='advisory' and (query like '%appointment%' or query like '%next_visit%');",
        ),
      ) >= number,
    "schedule advisory waiters",
  );
  observed++;
}
import {
  nextVisitContextSchema,
  nextVisitCompletionReceiptSchema,
  nextVisitQueueSchema,
  futureVisitPageSchema,
  nextVisitDueCareSchema,
} from "../../src/hub/features/scheduling/next-visit-model.ts";
const staff = await actor("STAFF"),
  dvm = await actor("DVM");
try {
  const client = randomUUID(),
    pet = randomUUID();
  sql(
    `insert into clients(id,first_name,last_name,full_name,primary_phone,primary_email,preferred_channel) values('${client}','Synthetic','Next visit','Synthetic Next visit','+12025550196','synthetic-next-${randomUUID()}@example.test','EMAIL');insert into pets(id,client_id,name,species) values('${pet}','${client}','Synthetic Next Dog','Dog');`,
  );
  const base = {
    p_actor_id: staff.id,
    p_id: null,
    p_expected_version: null,
    p_client_id: client,
    p_pet_id: pet,
    p_scheduled_at: "2032-01-01T16:00:00Z",
    p_duration_minutes: 30,
    p_appointment_type: "Synthetic next source",
    p_status: "SCHEDULED",
    p_assigned_dvm_id: dvm.id,
    p_visit_type: "clinic",
    p_address_snapshot: "Synthetic",
    p_travel_before_minutes: 0,
    p_travel_after_minutes: 0,
    p_resource_name: null,
    p_notes: "Synthetic",
    p_reminder_offsets: [],
  };
  const source = await rpc(staff.db, "save_appointment", base);
  const completedArgs = {
    p_actor_id: staff.id,
    p_action_id: randomUUID(),
    p_id: source.id,
    p_expected_version: 1,
  };
  let release = await heldSchedule();
  const completing = staff.db
    .rpc("complete_appointment", completedArgs)
    .then((v) => v);
  await waiters(1);
  const replay = staff.db
    .rpc("complete_appointment", completedArgs)
    .then((v) => v);
  await waiters(2);
  await release();
  const completions = await Promise.all([completing, replay]);
  check(completions[0].error, null);
  check(completions[1].error, null);
  check(completions[0].data, completions[1].data);
  const completion = nextVisitCompletionReceiptSchema.parse(
      completions[0].data,
    ),
    occurrence = completion.context.occurrence.id;
  check(
    sql(
      `select count(*) from appointment_completion_occurrences where appointment_id='${source.id}';`,
    ),
    "1",
  );
  check(
    nextVisitQueueSchema
      .parse(await rpc(staff.db, "list_pending_next_visits", {}))
      .items.some((v) => v.occurrence.id === occurrence),
    true,
  );
  const custom = {
    client_id: client,
    pet_id: pet,
    scheduled_at: "2032-01-02T16:00:00Z",
    duration_minutes: 30,
    appointment_type: "Synthetic Next Followup",
    assigned_dvm_id: dvm.id,
    visit_type: "clinic",
    address_snapshot: "Synthetic",
    travel_before_minutes: 0,
    travel_after_minutes: 0,
    resource_name: null,
    notes: "Synthetic",
    reminder_offsets: [],
  };
  const values = {
    action: "book",
    note: "Synthetic reviewed time",
    followup_on: null,
    booking: { mode: "custom", values: custom },
    appointment_id: null,
    appointment_version: null,
  };
  const firstArgs = {
    p_actor_id: staff.id,
    p_action_id: randomUUID(),
    p_occurrence_id: occurrence,
    p_expected_version: 0,
    p_values: values,
  };
  release = await heldSchedule();
  const first = staff.db
    .rpc("save_next_visit_outcome", firstArgs)
    .then((v) => v);
  await waiters(1);
  const another = staff.db
    .rpc("save_next_visit_outcome", { ...firstArgs, p_action_id: randomUUID() })
    .then((v) => v);
  await waiters(2);
  await release();
  const decisions = await Promise.all([first, another]);
  check(decisions.filter((v) => !v.error).length, 1);
  check(decisions.find((v) => v.error)?.error?.code, "PT409");
  const saved = nextVisitContextSchema.parse(decisions[0].data);
  check(saved.decision?.kind, "booked");
  check(
    sql(
      `select count(*) from appointments where pet_id='${pet}' and appointment_type='Synthetic Next Followup';`,
    ),
    "1",
  );
  check(
    nextVisitContextSchema.parse(
      await rpc(staff.db, "save_next_visit_outcome", firstArgs),
    ),
    saved,
  );
  check(
    nextVisitContextSchema.parse(
      await rpc(staff.db, "recover_next_visit_action", {
        p_actor_id: staff.id,
        p_action_id: firstArgs.p_action_id,
        p_operation: "decide",
        p_request: { occurrence_id: occurrence, expected_version: 0, values },
      }),
    ),
    saved,
  );
  await denied(
    dvm.db,
    "recover_next_visit_action",
    {
      p_actor_id: dvm.id,
      p_action_id: firstArgs.p_action_id,
      p_operation: "decide",
      p_request: { occurrence_id: occurrence, expected_version: 0, values },
    },
    "23505",
  );
  const future = futureVisitPageSchema.parse(
    await rpc(staff.db, "list_next_visit_future_appointments", {
      p_occurrence_id: occurrence,
    }),
  );
  check(future.items.length, 1);
  check(future.items[0].id, saved.decision?.appointment_id);
  const secondSource = await rpc(staff.db, "save_appointment", {
    ...base,
    p_scheduled_at: "2032-01-03T16:00:00Z",
  });
  const secondCompletion = nextVisitCompletionReceiptSchema.parse(
    await rpc(staff.db, "complete_appointment", {
      ...completedArgs,
      p_action_id: randomUUID(),
      p_id: secondSource.id,
    }),
  );
  const secondOccurrence = secondCompletion.context.occurrence.id;
  const conflict = {
    ...firstArgs,
    p_action_id: randomUUID(),
    p_occurrence_id: secondOccurrence,
  };
  await denied(staff.db, "save_next_visit_outcome", conflict, "23P01");
  check(
    nextVisitContextSchema.parse(
      await rpc(staff.db, "read_next_visit_context", {
        p_occurrence_id: secondOccurrence,
      }),
    ).version,
    0,
  );
  check(
    await rpc(staff.db, "recover_next_visit_action", {
      p_actor_id: staff.id,
      p_action_id: conflict.p_action_id,
      p_operation: "decide",
      p_request: {
        occurrence_id: secondOccurrence,
        expected_version: 0,
        values,
      },
    }),
    null,
  );
  // Retired source binding survives completion; new follow-up uses current reviewed publication.
  const typeId = randomUUID(),
    definition = {
      name: "Synthetic Next Reviewed",
      category: "well",
      species: ["Dog"],
      visit_types: ["clinic"],
      duration_minutes: 30,
      travel_before_minutes: 0,
      travel_after_minutes: 0,
      resource_kind: null,
      staffing: "dvm",
      allow_override: false,
    };
  const catalog = (action: string, version: number | null) => ({
    p_actor_id: dvm.id,
    p_action_id: randomUUID(),
    p_id: typeId,
    p_expected_version: version,
    p_kind: "type",
    p_action: action,
    p_values: {
      definition,
      review_note: "Synthetic exact review",
      attest_review: action !== "draft",
    },
  });
  await rpc(dvm.db, "save_appointment_catalog", catalog("draft", null));
  const published = catalogEntrySchema.parse(
    await rpc(dvm.db, "save_appointment_catalog", catalog("publish", 1)),
  );
  const typedValues = {
    ...custom,
    type_version_id: published.published!.id,
    resource_version_id: null,
    status: "SCHEDULED",
    override_note: "",
  };
  delete (typedValues as Record<string, unknown>).appointment_type;
  delete (typedValues as Record<string, unknown>).resource_name;
  const typedArgs = {
    ...conflict,
    p_action_id: randomUUID(),
    p_values: {
      ...values,
      booking: {
        mode: "catalog",
        values: { ...typedValues, scheduled_at: "2032-01-04T16:00:00Z" },
      },
    },
  };
  const typed = nextVisitContextSchema.parse(
    await rpc(staff.db, "save_next_visit_outcome", typedArgs),
  );
  check(
    typed.decision?.booking_receipt?.binding?.type.id,
    published.published!.id,
  );
  const typedBooking = typed.decision!.booking_receipt!.appointment;
  await rpc(dvm.db, "save_appointment_catalog", catalog("retire", 2));
  const typedCompletion = nextVisitCompletionReceiptSchema.parse(
    await rpc(staff.db, "complete_appointment", {
      ...completedArgs,
      p_action_id: randomUUID(),
      p_id: typedBooking.id,
    }),
  );
  check(
    bindingSchema.parse(typedCompletion.context.occurrence.binding).type.id,
    published.published!.id,
  );
  check(
    nextVisitDueCareSchema.parse(
      await rpc(staff.db, "list_next_visit_due_care", {
        p_occurrence_id: typedCompletion.context.occurrence.id,
      }),
    ).items.length,
    0,
  );
  // Eligibility uses wall-clock time after a real scheduling-lock wait.
  const timedSource = await rpc(staff.db, "save_appointment", {
    ...base,
    p_scheduled_at: "2032-01-05T16:00:00Z",
  });
  const timedCompletion = nextVisitCompletionReceiptSchema.parse(
    await rpc(staff.db, "complete_appointment", {
      ...completedArgs,
      p_action_id: randomUUID(),
      p_id: timedSource.id,
    }),
  );
  const slot = new Date(Date.now() + 3000).toISOString();
  const expiring = await rpc(staff.db, "save_appointment", {
    ...base,
    p_scheduled_at: slot,
  });
  const expiredArgs = {
    ...firstArgs,
    p_action_id: randomUUID(),
    p_occurrence_id: timedCompletion.context.occurrence.id,
    p_values: {
      action: "existing",
      note: "Synthetic expiry",
      followup_on: null,
      booking: null,
      appointment_id: expiring.id,
      appointment_version: 1,
    },
  };
  release = await heldSchedule();
  const expired = staff.db
    .rpc("save_next_visit_outcome", expiredArgs)
    .then((v) => v);
  try {
    await waiters(1);
    check(
      sql(
        `select bool_and(query_start<'${slot}'::timestamptz) from pg_stat_activity where wait_event='advisory' and query like '%next_visit%';`,
      ),
      "t",
    );
    await waitUntil(
      () => sql(`select clock_timestamp()>='${slot}'::timestamptz;`) === "t",
      "owned future slot expires while request waits",
    );
  } finally {
    await release();
  }
  check((await expired).error?.code, "23514");
  check(
    nextVisitContextSchema.parse(
      await rpc(staff.db, "read_next_visit_context", {
        p_occurrence_id: timedCompletion.context.occurrence.id,
      }),
    ).version,
    0,
  );
  await rpc(staff.db, "cancel_appointment", {
    p_id: expiring.id,
    p_expected_version: 1,
  });
  // Freeze identity at completion even if a later unbound closed visit edit changes patient.
  const otherPet = randomUUID();
  sql(
    `insert into pets(id,client_id,name,species) values('${otherPet}','${client}','Synthetic Other','Dog');`,
  );
  await rpc(staff.db, "save_appointment", {
    ...base,
    p_id: source.id,
    p_expected_version: 2,
    p_pet_id: otherPet,
    p_status: "COMPLETED",
  });
  const historical = nextVisitContextSchema.parse(
    await rpc(staff.db, "read_next_visit_context", {
      p_occurrence_id: occurrence,
    }),
  );
  check(historical.current, false);
  check(historical.occurrence.pet_id, pet);
  await denied(
    staff.db,
    "complete_appointment",
    { ...completedArgs, p_action_id: randomUUID(), p_expected_version: 3 },
    "23514",
  );
  check(
    nextVisitContextSchema.parse(
      await rpc(staff.db, "save_next_visit_outcome", firstArgs),
    ),
    saved,
  );
  for (const table of [
    "appointment_completion_occurrences",
    "appointment_next_visit_heads",
    "appointment_next_visit_decisions",
    "appointment_next_visit_actions",
  ]) {
    const read = await service.from(table).select("*");
    check(read.error?.code, "42501");
  }
  sql(`update profiles set is_active=false where id='${staff.id}';`);
  await denied(
    staff.db,
    "recover_next_visit_action",
    {
      p_actor_id: staff.id,
      p_action_id: firstArgs.p_action_id,
      p_operation: "decide",
      p_request: { occurrence_id: occurrence, expected_version: 0, values },
    },
    "42501",
  );
  sql(`update profiles set is_active=true where id='${staff.id}';`);
  // Populated state is restored together with canonical functions and private privileges.
  const restored =
      "owned_next_restore_" + randomUUID().replaceAll("-", "").slice(0, 12),
    marker = randomUUID();
  sql(
    `create database "${restored}";comment on database "${restored}" is '${marker}';`,
  );
  const tables = [
    "appointment_completion_occurrences",
    "appointment_next_visit_heads",
    "appointment_next_visit_decisions",
    "appointment_next_visit_actions",
  ];
  const snapshot =
    "select jsonb_object_agg(name,rows) from (" +
    tables
      .map(
        (table) =>
          `select '${table}' name,coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) rows from ${table} t`,
      )
      .join(" union all ") +
    ") s;";
  try {
    const before = sql(snapshot);
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
        "select has_table_privilege('authenticated','appointment_next_visit_actions','SELECT');",
        restored,
      ),
      "f",
    );
    check(
      JSON.parse(
        sql(
          `set role authenticated;set request.jwt.claims='{"sub":"${staff.id}","role":"authenticated"}';select recover_next_visit_action('${staff.id}','${firstArgs.p_action_id}','decide','${JSON.stringify({ occurrence_id: occurrence, expected_version: 0, values })}'::jsonb);`,
          restored,
        ),
      ),
      saved,
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
  console.log(
    `Genuine local next-visit foundation passed: ${checks} checks; ${observed} observed lock queues; populated outcome restore; no provider requests.`,
  );
} finally {
  for (const person of actors) {
    sql(`update profiles set is_active=false where id='${person.id}';`);
    await person.db.auth.signOut();
  }
}
