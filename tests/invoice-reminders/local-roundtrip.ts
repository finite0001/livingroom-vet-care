/** Genuine local Auth, PostgREST, invoice browser and observed-wait proof. */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import {
  createClient,
  type SupabaseClient,
  type Session,
} from "@supabase/supabase-js";
import { chromium } from "playwright";
import { parseOwnedRuntimeStatus } from "../estimates/owned-runtime-status.ts";
import {
  defaultPolicy,
  detailSchema,
  practicePolicySchema,
} from "../../src/hub/features/billing/reminders/model.ts";
import { provePracticeSettings } from "./practice-settings-browser.ts";
const project = process.env.INVOICE_REMINDER_TEST_PROJECT;
assert.ok(
  project && process.env.INVOICE_REMINDER_RUN_SYNTHETIC_LOCAL === "true",
);
const identity = readFileSync(project + "/supabase/config.toml", "utf8").match(
  /^project_id = "(lrv-invoice-reminders-[a-f0-9]+)"/m,
)?.[1];
assert.ok(identity);
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
function sql(query: string) {
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
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { input: query, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  ).trim();
}
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(status.API_URL, status.SERVICE_ROLE_KEY, options),
  anon = createClient(status.API_URL, status.ANON_KEY, options);
interface Actor {
  id: string;
  db: SupabaseClient;
  session: Session;
}
const actors: Actor[] = [];
let checks = 0,
  browserChecks = 0,
  observedQueues = 0;
const check = (actual: unknown, expected: unknown) => {
  assert.deepEqual(actual, expected);
  checks++;
};
async function rpc(
  db: SupabaseClient,
  name: string,
  args: Record<string, unknown> = {},
) {
  const { data, error } = await db.rpc(name, args);
  if (error)
    throw Object.assign(new Error(name + ": " + error.message), {
      code: error.code,
    });
  return data;
}
async function actor(role: string) {
  const email = "synthetic-invoice-" + randomUUID() + "@example.test",
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
    `update profiles set is_active=true,full_name='Synthetic invoice ${role}'where id='${id}';insert into user_roles(user_id,role)values('${id}','${role}')on conflict do nothing;`,
  );
  const login = await db.auth.signInWithPassword({ email, password });
  if (login.error) throw login.error;
  const a = { id, db, session: login.data.session! };
  actors.push(a);
  return a;
}
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(test: () => boolean | Promise<boolean>, label: string) {
  for (let n = 0; n < 200; n++) {
    if (await test()) return;
    await pause(25);
  }
  throw new Error("Did not observe " + label);
}
let cleanupFailure: unknown = null;
let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null,
  vite: ReturnType<typeof spawn> | null = null;
try {
  check(
    sql("select count(*)from supabase_migrations.schema_migrations;"),
    "204",
  );
  const admin = await actor("ADMIN"),
    staff = await actor("STAFF");
  const practiceArgs = { p_actor_id: admin.id };
  check(
    (await anon.rpc("read_invoice_reminder_practice", practiceArgs)).error
      ?.code,
    "42501",
  );
  check(
    (await service.rpc("read_invoice_reminder_practice", practiceArgs)).error
      ?.code,
    "42501",
  );
  check(
    (
      await staff.db.rpc("read_invoice_reminder_practice", {
        p_actor_id: staff.id,
      })
    ).error?.code,
    "42501",
  );
  check(
    (
      await admin.db.rpc("read_invoice_reminder_practice", {
        p_actor_id: staff.id,
      })
    ).error?.code,
    "42501",
  );
  check(
    practicePolicySchema.parse(
      await rpc(admin.db, "read_invoice_reminder_practice", practiceArgs),
    ).policy,
    null,
  );
  check(sql("select count(*)from billing_invoices;"), "0");
  // Local fixture role only: exercise the existing clinical-policy draft guard
  // without reviewing/saving that policy, then retire this extra role.
  sql(`insert into user_roles(user_id,role)values('${admin.id}','DVM');`);
  let practiceBrowser: Awaited<ReturnType<typeof provePracticeSettings>>;
  try {
    practiceBrowser = await provePracticeSettings({
      apiUrl: status.API_URL,
      anonKey: status.ANON_KEY,
      actorId: admin.id,
      session: admin.session,
      db: admin.db,
    });
  } finally {
    sql(`delete from user_roles where user_id='${admin.id}'and role='DVM';`);
  }
  browserChecks += practiceBrowser.browserChecks;
  check(sql("select count(*)from billing_invoices;"), "0");
  check(sql("select count(*)from invoice_reminder_policies;"), "2");
  check(
    (
      await anon.rpc("read_invoice_reminders", {
        p_actor_id: admin.id,
        p_invoice_id: randomUUID(),
        p_client_id: randomUUID(),
      })
    ).error?.code,
    "42501",
  );
  for (const table of [
    "invoice_reminder_policies",
    "invoice_reminder_terms",
    "invoice_reminder_jobs",
    "invoice_reminder_actions",
    "invoice_reminder_runs",
  ]) {
    check((await staff.db.from(table).select("*")).error?.code, "42501");
    check((await service.from(table).select("*")).error?.code, "42501");
  }
  const policyId = randomUUID(),
    definition = { ...defaultPolicy, enabled: true };
  const policyArgs = {
    p_actor_id: admin.id,
    p_id: policyId,
    p_expected_version: practiceBrowser.policyVersion,
    p_definition: definition,
  };
  const savedPolicy = await rpc(
    admin.db,
    "save_invoice_reminder_policy",
    policyArgs,
  );
  check(
    await rpc(admin.db, "save_invoice_reminder_policy", policyArgs),
    savedPolicy,
  );
  check(
    (
      await staff.db.rpc("save_invoice_reminder_policy", {
        ...policyArgs,
        p_actor_id: staff.id,
        p_id: randomUUID(),
      })
    ).error?.code,
    "42501",
  );
  check(
    (
      await staff.db.rpc("save_invoice_reminder_policy", {
        ...policyArgs,
        p_id: randomUUID(),
      })
    ).error?.code,
    "42501",
  );
  const client = (
    await rpc(admin.db, "save_client", {
      p_actor_id: admin.id,
      p_client_id: null,
      p_expected_version: null,
      p_first_name: "Synthetic",
      p_last_name: "Invoice Reminder",
      p_primary_phone: "+13035555903",
      p_primary_email: "synthetic-invoice-browser@example.test",
      p_preferred_channel: "EMAIL",
      p_housecall_address: null,
      p_mailing_address: null,
    })
  ).id;
  const product = (
    await rpc(admin.db, "save_catalog_product", {
      p_id: null,
      p_expected_version: null,
      p_name: "Synthetic reminder service",
      p_kind: "service",
      p_manufacturer: "",
      p_unit: "visit",
      p_unit_price_cents: 10000,
      p_active: true,
    })
  ).id;
  async function invoice() {
    const id = randomUUID();
    await rpc(admin.db, "create_billing_invoice", {
      p_id: id,
      p_client_id: client,
    });
    await rpc(admin.db, "add_invoice_service", {
      p_id: randomUUID(),
      p_invoice_id: id,
      p_pet_id: null,
      p_product_id: product,
      p_quantity: 1,
    });
    const r = await admin.db
      .from("billing_invoices")
      .select("version")
      .eq("id", id)
      .single();
    if (r.error) throw r.error;
    await rpc(admin.db, "issue_billing_invoice", {
      p_id: id,
      p_expected_version: r.data.version,
    });
    return id;
  }
  const invoiceId = await invoice(),
    due = sql(
      "select((statement_timestamp()at time zone 'America/Denver')::date-8)::text;",
    );
  const values = {
    due_on: due,
    enabled: true,
    channel: "EMAIL",
    hold_kind: "none",
    hold_reason: "",
  };
  const termArgs = {
    p_actor_id: staff.id,
    p_id: randomUUID(),
    p_invoice_id: invoiceId,
    p_client_id: client,
    p_expected_version: 0,
    p_values: values,
  };
  const savedTerms = await rpc(
    staff.db,
    "save_invoice_reminder_terms",
    termArgs,
  );
  check(
    await rpc(staff.db, "save_invoice_reminder_terms", termArgs),
    savedTerms,
  );
  check(
    (
      await admin.db.rpc("save_invoice_reminder_terms", {
        ...termArgs,
        p_actor_id: staff.id,
        p_id: randomUUID(),
      })
    ).error?.code,
    "42501",
  );
  const read = () =>
    rpc(admin.db, "read_invoice_reminders", {
      p_actor_id: admin.id,
      p_invoice_id: invoiceId,
      p_client_id: client,
    }).then((d) => detailSchema.parse(d));
  check((await read()).context.amount_cents, "10000");
  check((await read()).context.offset_days, 7);
  const runArgs = { p_run_id: randomUUID(), p_limit: 25 };
  const queued = await rpc(service, "execute_invoice_reminder_run", runArgs);
  check(queued.queued, 1);
  check(await rpc(service, "execute_invoice_reminder_run", runArgs), queued);
  check(
    (
      await rpc(service, "execute_invoice_reminder_run", {
        ...runArgs,
        p_run_id: randomUUID(),
      })
    ).queued,
    0,
  );
  const claim = await rpc(service, "claim_communication");
  check(claim.body.includes("$100.00"), true);
  // Hold the real invoice lock; a genuine worker HTTP attempt must actually wait.
  const held = spawn(
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
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  let output = "",
    failure = "";
  held.stdout!.on("data", (b) => {
    output += b.toString();
  });
  held.stderr!.on("data", (b) => {
    failure += b.toString();
  });
  let heldClosed = false;
  const heldExit = new Promise<void>((resolve, reject) =>
    held.once("exit", (code) => {
      heldClosed = true;
      if (code === 0) resolve();
      else reject(new Error("Owned invoice blocker failed; details withheld"));
    }),
  );
  try {
    held.stdin!.write(
      `begin;select pg_backend_pid();select id from billing_invoices where id='${invoiceId}'for update;select 'LOCK_READY';\n`,
    );
    await until(() => output.includes("LOCK_READY"), "invoice lock");
    const pid = output.split("\n").find((line) => /^\d+$/.test(line))!;
    let settled = false;
    const attempt = rpc(service, "start_communication_attempt", {
      p_id: claim.id,
      p_lease_token: claim.lease_token,
      p_provider_config: {
        from: "The Living Room Vet <care@thelivingroom.vet>",
        reply_to: "admin@thelivingroom.vet",
      },
    }).finally(() => {
      settled = true;
    });
    await until(
      () =>
        sql(
          `select exists(select 1 from pg_stat_activity a where ${Number(pid)}=any(pg_blocking_pids(a.pid))and a.wait_event_type='Lock');`,
        ) === "t",
      "actual worker invoice wait",
    );
    assert.equal(settled, false);
    observedQueues++;
    // This competitor is the canonical SQL credit in the owned held transaction,
    // not claimed as a second genuine Auth request.
    held.stdin!.write(
      `select set_config('request.jwt.claims','{"role":"authenticated","sub":"${admin.id}"}',true);set local role authenticated;select credit_billing_invoice('${randomUUID()}','${invoiceId}',2500,'Synthetic committed balance change');commit;\\q\n`,
    );
    await heldExit;
    assert.equal(failure, "");
    check((await attempt).state, "failed");
  } finally {
    if (!heldClosed) {
      held.stdin!.end("rollback;\\q\n");
      await heldExit;
    }
  }
  check((await read()).history[0].attempt_count, 0);
  check(
    (
      await rpc(service, "execute_invoice_reminder_run", {
        p_run_id: randomUUID(),
        p_limit: 25,
      })
    ).queued,
    1,
  );
  check((await read()).history[0].amount_cents, "7500");
  const current = await rpc(service, "claim_communication");
  check(current.body.includes("$75.00"), true);
  // Reproduce the existing care retry's care-gate -> same-outbox order.
  // The actual worker HTTP request must wait at care, before owning invoice,
  // reminder-gate or outbox locks. The SQL competitor is not an Auth request.
  const careHeld = spawn(
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
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  let careOutput = "",
    careFailure = "",
    careClosed = false;
  careHeld.stdout!.on("data", (b) => {
    careOutput += b.toString();
  });
  careHeld.stderr!.on("data", (b) => {
    careFailure += b.toString();
  });
  const careExit = new Promise<void>((resolve, reject) =>
    careHeld.once("exit", (code) => {
      careClosed = true;
      if (code === 0) resolve();
      else
        reject(new Error("Owned care-gate blocker failed; details withheld"));
    }),
  );
  // Attach immediately so an expected test failure is collected during cleanup.
  void careExit.catch(() => undefined);
  let careAttempt: Promise<Record<string, unknown>> | null = null;
  try {
    careHeld.stdin!.write(
      "begin;select pg_backend_pid();select public.care_eligibility_lock();select 'CARE_READY';\n",
    );
    await until(
      () => careOutput.includes("CARE_READY"),
      "care eligibility gate",
    );
    const carePid = Number(
      careOutput.split("\n").find((line) => /^\d+$/.test(line)),
    );
    assert.ok(Number.isSafeInteger(carePid) && carePid > 0);
    let settled = false;
    careAttempt = rpc(service, "start_communication_attempt", {
      p_id: current.id,
      p_lease_token: current.lease_token,
      p_provider_config: {
        from: "The Living Room Vet <care@thelivingroom.vet>",
        reply_to: "admin@thelivingroom.vet",
      },
    }).finally(() => {
      settled = true;
    });
    void careAttempt.catch(() => undefined);
    await until(
      () =>
        sql(`select exists(select 1 from pg_stat_activity a join pg_locks l on l.pid=a.pid
        where ${carePid}=any(pg_blocking_pids(a.pid)) and a.wait_event_type='Lock'
        and a.query like '%start_communication_attempt%' and l.locktype='advisory'
        and l.classid=1869440354 and l.objid=1128354373 and l.objsubid=2 and not l.granted);`) ===
        "t",
      "actual worker care-gate wait",
    );
    check(settled, false);
    observedQueues++;
    // Fails on the old inversion: the worker would already own this outbox.
    // The canonical hold takes care reentrantly, then reminder/invoice locks.
    const hold = {
      ...values,
      hold_kind: "bereavement",
      hold_reason: "Synthetic family hold",
    };
    const staffSessionId = sql(
      `select id from auth.sessions where user_id='${staff.id}'order by created_at desc limit 1;`,
    );
    assert.match(staffSessionId, /^[0-9a-f-]{36}$/);
    const claims = JSON.stringify({
      role: "authenticated",
      sub: staff.id,
      session_id: staffSessionId,
    });
    careHeld.stdin!.write(
      `set local lock_timeout='1500ms';select id from communication_outbox where id='${current.id}' for update;select 'CARE_OUTBOX_READY';
       select set_config('request.jwt.claims','${claims}',true);
       set local role authenticated;select save_invoice_reminder_terms('${staff.id}','${randomUUID()}','${invoiceId}','${client}',1,'${JSON.stringify(hold)}'::jsonb);commit;\\q\n`,
    );
    await careExit;
    check(careFailure, "");
    check(careOutput.includes("CARE_OUTBOX_READY"), true);
    check((await careAttempt).state, "failed");
  } finally {
    if (!careClosed) {
      careHeld.stdin!.end("rollback;\\q\n");
      await careExit;
    }
    if (careAttempt) await careAttempt.catch(() => undefined);
  }
  check((await read()).context.reason, "bereavement");
  // Real UI, live local RPCs, no mocked network results or external traffic.
  const origin = "http://127.0.0.1:64781";
  vite = spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "--host",
      "127.0.0.1",
      "--port",
      "64781",
      "--strictPort",
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        VITE_SUPABASE_URL: status.API_URL,
        VITE_SUPABASE_PUBLISHABLE_KEY: status.ANON_KEY,
      },
      stdio: "ignore",
    },
  );
  await until(async () => {
    try {
      return (await fetch(origin)).ok;
    } catch {
      return false;
    }
  }, "owned UI server");
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1000 },
  });
  await context.addInitScript((session) => {
    if (!localStorage.getItem("synthetic:invoice-bootstrap")) {
      localStorage.setItem("sb-127-auth-token", JSON.stringify(session));
      localStorage.setItem("synthetic:invoice-bootstrap", "true");
    }
  }, admin.session);
  await context.route("**/*", (route) =>
    [origin, status.API_URL].includes(new URL(route.request().url()).origin)
      ? route.continue()
      : route.abort(),
  );
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin + "/hub/client/" + client + "?tab=billing");
  await page
    .getByRole("button", { name: new RegExp(invoiceId.slice(0, 8)) })
    .click();
  const panel = page.getByRole("region", { name: "Unpaid invoice reminders" });
  await panel.getByLabel("Invoice due date (Denver)").waitFor();
  browserChecks++;
  await panel.getByText("Bereavement hold", { exact: false }).first().waitFor();
  browserChecks++;
  await panel
    .getByLabel("Reminder hold", { exact: true })
    .selectOption("paused");
  await panel
    .getByLabel("Hold reason", { exact: true })
    .fill("Synthetic UI pause");
  browserChecks++;
  await page.getByRole("tab", { name: "Overview", exact: true }).click();
  await page.getByRole("tab", { name: /^Billing/ }).click();
  assert.equal(
    await panel.getByLabel("Hold reason", { exact: true }).inputValue(),
    "Synthetic UI pause",
  );
  browserChecks++;
  await page.getByRole("button", { name: "Clients", exact: true }).click();
  await page
    .getByRole("button", { name: "Stay and reconcile", exact: true })
    .click();
  browserChecks++;
  await panel
    .getByRole("button", {
      name: "Save invoice reminder settings",
      exact: true,
    })
    .click();
  await panel.getByText("Reminder settings saved.", { exact: true }).waitFor();
  browserChecks++;
  check((await read()).context.reason, "paused");
  await page.reload();
  await page
    .getByRole("button", { name: new RegExp(invoiceId.slice(0, 8)) })
    .click();
  await panel.getByLabel("Hold reason", { exact: true }).waitFor();
  assert.equal(
    await panel.getByLabel("Hold reason", { exact: true }).inputValue(),
    "Synthetic UI pause",
  );
  browserChecks++;
  await panel.locator("summary").click();
  await panel
    .getByLabel("Reminder days after due date", { exact: true })
    .fill("7, 7");
  await panel
    .getByRole("button", { name: "Save practice reminder policy", exact: true })
    .click();
  await panel.getByRole("alert").filter({ hasText: "ascending" }).waitFor();
  browserChecks++;
  await panel
    .getByRole("button", {
      name: "Discard edits and reload saved settings",
      exact: true,
    })
    .click();
  browserChecks++;
  await page.setViewportSize({ width: 390, height: 844 });
  await panel.getByLabel("Invoice due date (Denver)").scrollIntoViewIfNeeded();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  );
  browserChecks++;
  mkdirSync("tmp/invoice-reminder-browser", { recursive: true });
  await page.screenshot({
    path: "tmp/invoice-reminder-browser/mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.screenshot({
    path: "tmp/invoice-reminder-browser/desktop.png",
    fullPage: true,
  });
  check(errors, []);
  browserChecks++;
  await context.close();
  // An eligible attempt is persisted once; uncertainty is never automatically retried.
  const uncertainInvoice = await invoice();
  await rpc(staff.db, "save_invoice_reminder_terms", {
    ...termArgs,
    p_id: randomUUID(),
    p_invoice_id: uncertainInvoice,
    p_expected_version: 0,
  });
  check(
    (
      await rpc(service, "execute_invoice_reminder_run", {
        p_run_id: randomUUID(),
        p_limit: 25,
      })
    ).queued,
    1,
  );
  const uncertainClaim = await rpc(service, "claim_communication");
  check(
    (
      await rpc(service, "start_communication_attempt", {
        p_id: uncertainClaim.id,
        p_lease_token: uncertainClaim.lease_token,
        p_provider_config: {
          from: "The Living Room Vet <care@thelivingroom.vet>",
          reply_to: "admin@thelivingroom.vet",
        },
      })
    ).attempt_count,
    1,
  );
  await rpc(service, "finish_communication_attempt", {
    p_id: uncertainClaim.id,
    p_lease_token: uncertainClaim.lease_token,
    p_outcome: "uncertain",
    p_provider_message_id: null,
    p_error_code: "synthetic_transport_unknown",
  });
  check(
    (
      await rpc(service, "execute_invoice_reminder_run", {
        p_run_id: randomUUID(),
        p_limit: 25,
      })
    ).queued,
    0,
  );
  const uncertainHistory = detailSchema.parse(
    await rpc(admin.db, "read_invoice_reminders", {
      p_actor_id: admin.id,
      p_invoice_id: uncertainInvoice,
      p_client_id: client,
    }),
  );
  check(uncertainHistory.history[0].state, "uncertain");
  // Two SQL-only isolation probes, separate from real Auth/API checks.
  for (const isolation of ["repeatable read", "serializable"]) {
    check(
      sql(
        `begin isolation level ${isolation};select set_config('request.jwt.claims','{"role":"service_role"}',true);do $$begin perform execute_invoice_reminder_run('${randomUUID()}',25);raise exception 'Unsupported isolation was accepted';exception when check_violation then if sqlerrm<>'Invoice reminders require READ COMMITTED' then raise;end if;end$$;rollback;select 'isolation_rejected';`,
      )
        .split("\n")
        .at(-1),
      "isolation_rejected",
    );
  }
  // Populated public/auth/storage/extensions restore in a marked local clone.
  const snapshotQuery = `set timezone='UTC';create temp table invoice_snapshot(name text,value jsonb);do $$declare r record;v jsonb;begin for r in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','auth','storage','extensions')and c.relkind in('r','p')order by 1,2 loop execute format('select jsonb_build_object(''count'',count(*),''hash'',md5(coalesce(string_agg(to_jsonb(t)::text,''|''order by to_jsonb(t)::text),'''')))from %I.%I t',r.nspname,r.relname)into v;insert into invoice_snapshot values(r.nspname||'.'||r.relname,v);end loop;end$$;select jsonb_object_agg(name,value)from invoice_snapshot;`;
  function dbSql(query: string, db = "postgres") {
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
        maxBuffer: 64 * 1024 * 1024,
      },
    ).trim();
  }
  const before = JSON.parse(dbSql(snapshotQuery));
  let dump = execFileSync(
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
    {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  dump = dump
    .split("\n")
    .filter((line) => !line.startsWith("ALTER DEFAULT PRIVILEGES"))
    .join("\n")
    .replace(
      "CREATE SCHEMA extensions;",
      "CREATE SCHEMA IF NOT EXISTS extensions;",
    );
  const clone =
      "owned_invoice_restore_" + randomUUID().replaceAll("-", "").slice(0, 10),
    marker = randomUUID();
  dbSql(
    `create database ${clone};comment on database ${clone} is '${marker}';`,
  );
  try {
    dbSql(
      'drop schema public;create schema extensions;create extension pgcrypto with schema extensions;create extension "uuid-ossp"with schema extensions;',
      clone,
    );
    dbSql(dump, clone);
    check(JSON.parse(dbSql(snapshotQuery, clone)), before);
    check(JSON.parse(dbSql(snapshotQuery)), before);
    check(
      dbSql("select count(*)from invoice_reminder_jobs;", clone),
      dbSql("select count(*)from invoice_reminder_jobs;"),
    );
    const sid = sql(
      `select id from auth.sessions where user_id='${admin.id}'order by created_at desc limit 1;`,
    );
    check(
      dbSql(
        `begin;select set_config('request.jwt.claims','{"role":"authenticated","sub":"${admin.id}","session_id":"${sid}"}',true);set local role authenticated;select read_invoice_reminders('${admin.id}','${invoiceId}','${client}')#>>'{context,reason}';rollback;`,
        clone,
      )
        .split("\n")
        .at(-1),
      "paused",
    );
    check(
      dbSql(
        `begin;select set_config('request.jwt.claims','{"role":"authenticated","sub":"${admin.id}","session_id":"${sid}"}',true);set local role authenticated;select read_invoice_reminder_practice('${admin.id}')#>>'{policy,id}';rollback;`,
        clone,
      )
        .split("\n")
        .at(-1),
      policyId,
    );
  } finally {
    assert.equal(
      dbSql(
        `select shobj_description(oid,'pg_database')from pg_database where datname='${clone}';`,
      ),
      marker,
    );
    dbSql(`drop database ${clone} with(force);`);
    check(
      dbSql(`select count(*)from pg_database where datname='${clone}';`),
      "0",
    );
  }
  writeFileSync(
    "tmp/invoice-reminder-restore-proof.json",
    JSON.stringify(
      {
        exactRelationFingerprints: Object.keys(before).length,
        reminderFamilies: 5,
        populated: true,
        cloneRemoved: true,
        practicePolicyRead: true,
        providerRequests: 0,
      },
      null,
      2,
    ),
  );

  // Offboarding must invalidate a still-signed-in user's reminder authority.
  sql(`update profiles set is_active=false where id='${staff.id}';`);
  check(
    (
      await staff.db.rpc("read_invoice_reminders", {
        p_actor_id: staff.id,
        p_invoice_id: invoiceId,
        p_client_id: client,
      })
    ).error?.code,
    "42501",
  );
  sql(`update profiles set is_active=false where id='${admin.id}';`);
  check(
    (await admin.db.rpc("read_invoice_reminder_practice", practiceArgs)).error
      ?.code,
    "42501",
  );
  writeFileSync(
    "tmp/invoice-reminder-auth-proof.json",
    JSON.stringify(
      {
        checks,
        checkScope:
          "Combined Auth/API, SQL isolation and restore assertions; not all genuine HTTP",
        browserChecks,
        observedQueues,
        observedInvoiceWaits: 1,
        observedCareGateWaits: 1,
        practiceSettings: practiceBrowser,
        sqlOnlyIsolationChecks: 2,
        providerRequests: 0,
      },
      null,
      2,
    ),
  );
  console.log(
    `Invoice reminder combined Auth/API/SQL/restore: ${checks} checks; ${browserChecks} browser checks; ${observedQueues} observed invoice/care-gate queues; no provider requests.`,
  );
} catch (failure) {
  if (browser) {
    const page = browser.contexts()[0]?.pages()[0];
    if (page) {
      mkdirSync("tmp/invoice-reminder-browser", { recursive: true });
      await page
        .screenshot({
          path: "tmp/invoice-reminder-browser/failure.png",
          fullPage: true,
        })
        .catch(() => {});
      console.error(
        "Synthetic UI alerts:",
        await page
          .getByRole("alert")
          .allTextContents()
          .catch(() => []),
      );
    }
  }
  throw failure;
} finally {
  if (browser) await browser.close();
  if (vite) {
    vite.kill("SIGTERM");
    await new Promise<void>((resolve) => vite!.once("exit", () => resolve()));
  }
  for (const a of actors) {
    await a.db.auth.signOut();
    sql(
      `update profiles set is_active=false where id='${a.id}';delete from auth.refresh_tokens where user_id='${a.id}';delete from auth.sessions where user_id='${a.id}';`,
    );
    const r = await service.auth.admin.updateUserById(a.id, {
      ban_duration: "87600h",
    });
    if (r.error) cleanupFailure = r.error;
  }
}
if (cleanupFailure) throw cleanupFailure;
