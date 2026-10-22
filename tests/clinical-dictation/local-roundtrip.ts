/** Owned synthetic Auth/PostgREST/browser/restore proof. No external provider requests. */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import {
  createClient,
  type SupabaseClient,
  type Session,
} from "@supabase/supabase-js";
import { chromium, type Page } from "playwright";
import { parseOwnedRuntimeStatus } from "../estimates/owned-runtime-status.ts";
import {
  emptySections,
  readSchema,
  verifyReceipt,
  type DictationAction,
} from "../../src/hub/features/clinical/dictation/model.ts";

const project = process.env.DICTATION_TEST_PROJECT;
assert.ok(project && process.env.DICTATION_RUN_SYNTHETIC_LOCAL === "true");
const identity = readFileSync(project + "/supabase/config.toml", "utf8").match(
  /^project_id = "(lrv-clinical-dictation-[a-f0-9]+)"/m,
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
assert.equal(status.API_URL, "http://127.0.0.1:64821");
function sql(query: string, database = "postgres") {
  try {
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
      {
        input: query,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
        maxBuffer: 64 * 1024 * 1024,
      },
    ).trim();
  } catch {
    throw new Error("Owned SQL operation failed; private output withheld.");
  }
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
let apiChecks = 0,
  browserChecks = 0,
  sqlChecks = 0,
  observedWaits = 0;
const apiCheck = (actual: unknown, expected: unknown) => {
  assert.deepEqual(actual, expected);
  apiChecks++;
};
const browserCheck = (actual: unknown, expected: unknown) => {
  assert.deepEqual(actual, expected);
  browserChecks++;
};
const sqlCheck = (actual: unknown, expected: unknown) => {
  assert.deepEqual(actual, expected);
  sqlChecks++;
};
async function rpc(
  db: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
) {
  const { data, error } = await db.rpc(name, args);
  if (error)
    throw Object.assign(new Error(name + ": " + error.message), {
      code: error.code,
    });
  return data;
}
async function actor(name: string) {
  const email = "synthetic-dictation-" + randomUUID() + "@example.test",
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
    `update profiles set is_active=true,full_name='Synthetic dictation ${name}'where id='${id}';insert into user_roles(user_id,role)values('${id}','STAFF')on conflict do nothing;`,
  );
  const signed = await db.auth.signInWithPassword({ email, password });
  if (signed.error) throw signed.error;
  const result = { id, db, session: signed.data.session! };
  actors.push(result);
  return result;
}
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(test: () => boolean | Promise<boolean>, label: string) {
  for (let i = 0; i < 300; i++) {
    if (await test()) return;
    await pause(25);
  }
  throw new Error("Did not observe " + label);
}
function args(a: DictationAction) {
  return {
    p_actor_id: a.actor,
    p_id: a.id,
    p_kind: a.kind,
    p_request: a.request,
  };
}
function importAction(
  a: Actor,
  pet: string,
  encounter: string,
  expected = 1,
): DictationAction {
  const sections = emptySections();
  sections.subjective = {
    text: "Cough for two days.",
    quote: "cough for two days",
  };
  return {
    id: randomUUID(),
    actor: a.id,
    kind: "submit",
    request: {
      pet_id: pet,
      encounter_id: encounter,
      expected_version: expected,
      transcript: "Owner reports cough for two days. No exam was dictated.",
      source_note: "Synthetic authorized staff transcript",
      attest_authorized: true,
      sections,
    },
  };
}
function reviewAction(
  a: Actor,
  source: DictationAction,
  decision = "accepted",
): DictationAction {
  return {
    id: randomUUID(),
    actor: a.id,
    kind: "review",
    request: {
      pet_id: source.request.pet_id,
      encounter_id: source.request.encounter_id,
      expected_version: source.request.expected_version,
      proposal_id: source.id,
      decision,
      accepted_sections:
        decision === "accepted"
          ? { subjective: "Reviewed cough history." }
          : {},
      review_note:
        decision === "accepted"
          ? ""
          : "Synthetic rejection: later note supersedes this draft.",
      attest_reviewed: true,
    },
  };
}
let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null,
  vite: ReturnType<typeof spawn> | null = null,
  page: Page | null = null;
let cleanupFailure: unknown = null;
mkdirSync("tmp/clinical-dictation-browser", { recursive: true, mode: 0o700 });
try {
  sqlCheck(
    sql("select count(*)from supabase_migrations.schema_migrations;"),
    "206",
  );
  sqlCheck(sql("select max(version)from supabase_migrations.schema_migrations;"), "20261022010000");
  const first = await actor("First"),
    second = await actor("Colleague");
  const client = (
    await rpc(first.db, "save_client", {
      p_actor_id: first.id,
      p_client_id: null,
      p_expected_version: null,
      p_first_name: "Synthetic",
      p_last_name: "Dictation",
      p_primary_phone: "+13035555352",
      p_primary_email: "synthetic-dictation@example.test",
      p_preferred_channel: "EMAIL",
      p_housecall_address: null,
      p_mailing_address: null,
    })
  ).id;
  async function pet(name: string) {
    return (
      await rpc(first.db, "save_patient", {
        p_id: null,
        p_client_id: client,
        p_expected_version: null,
        p_name: name,
        p_species: "Dog",
        p_breed: "Mixed",
        p_dob: null,
        p_birth_date_precision: "unknown",
        p_color: "",
        p_sex: "unknown",
        p_neuter_status: "unknown",
        p_microchip_id: null,
        p_archived_at: null,
        p_deceased_at: null,
      })
    ).id as string;
  }
  const petId = await pet("Synthetic API Dictation"),
    uiPet = await pet("Synthetic Browser Dictation");
  async function encounter(pet_id: string) {
    return await rpc(first.db, "save_clinical_encounter", {
      p_id: null,
      p_pet_id: pet_id,
      p_expected_version: null,
      p_visit_at: new Date().toISOString(),
      p_visit_type: "clinic",
      p_location: "Synthetic local clinic",
      p_subjective: "Original history",
      p_objective: "Original exam",
      p_assessment: "Original assessment",
      p_plan: "Original plan",
    });
  }
  const initial = await encounter(petId),
    uiEncounter = await encounter(uiPet);
  const readArgs = {
    p_actor_id: first.id,
    p_pet_id: petId,
    p_encounter_id: initial.id,
  };
  apiCheck(
    (await anon.rpc("read_clinical_dictation", readArgs)).error?.code,
    "42501",
  );
  apiCheck(
    (await service.rpc("read_clinical_dictation", readArgs)).error?.code,
    "42501",
  );
  apiCheck(
    (await second.db.rpc("read_clinical_dictation", readArgs)).error?.code,
    "42501",
  );
  apiCheck(
    (
      await first.db.rpc("read_clinical_dictation", {
        ...readArgs,
        p_pet_id: uiPet,
      })
    ).error?.code,
    "23514",
  );
  for (const table of [
    "clinical_dictation_proposals",
    "clinical_dictation_reviews",
    "clinical_dictation_actions",
  ]) {
    apiCheck((await first.db.from(table).select("*")).error?.code, "42501");
    apiCheck((await service.from(table).select("*")).error?.code, "42501");
  }
  const imported = importAction(first, petId, initial.id),
    importArgs = args(imported);
  const submitted = verifyReceipt(
    await rpc(first.db, "save_clinical_dictation_action", importArgs),
    imported,
  );
  apiCheck(
    await rpc(first.db, "save_clinical_dictation_action", importArgs),
    submitted,
  );
  apiCheck(
    await rpc(first.db, "recover_clinical_dictation_action", importArgs),
    submitted,
  );
  apiCheck(
    (
      await second.db.rpc("recover_clinical_dictation_action", {
        ...importArgs,
        p_actor_id: second.id,
      })
    ).error?.code,
    "42501",
  );
  apiCheck(
    (
      await first.db.rpc("save_clinical_dictation_action", {
        ...importArgs,
        p_request: {
          ...imported.request,
          source_note: "Different immutable input",
        },
      })
    ).error?.code,
    "23505",
  );
  const value = readSchema.parse(
    await rpc(first.db, "read_clinical_dictation", readArgs),
  );
  apiCheck(value.items.length, 1);
  apiCheck(value.items[0].review, null);
  const acceptedAction = reviewAction(second, imported);
  const accepted = verifyReceipt(
    await rpc(
      second.db,
      "save_clinical_dictation_action",
      args(acceptedAction),
    ),
    acceptedAction,
  );
  apiCheck(accepted.encounter?.subjective, "Reviewed cough history.");
  apiCheck(accepted.encounter?.objective, "Original exam");
  apiCheck(accepted.encounter?.status, "draft");
  apiCheck(accepted.encounter?.version, 2);
  apiCheck(
    await rpc(
      second.db,
      "save_clinical_dictation_action",
      args(acceptedAction),
    ),
    accepted,
  );
  apiCheck(
    (
      await first.db.rpc(
        "save_clinical_dictation_action",
        args(reviewAction(first, imported)),
      )
    ).error?.code,
    "PT409",
  );
  // A real saved encounter update and review wait on the same held row. The earlier edit wins; review must reject its stale version.
  const race = await encounter(petId),
    raceSource = importAction(first, petId, race.id);
  await rpc(first.db, "save_clinical_dictation_action", args(raceSource));
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
  let heldOutput = "",
    closed = false;
  held.stdout.on("data", (b) => {
    heldOutput += b.toString();
  });
  const heldExit = new Promise<void>((resolve, reject) => {
    held.once("error", reject);
    held.once("exit", (code) => {
      closed = true;
      if (code === 0) resolve();
      else reject(new Error("Owned lock holder failed"));
    });
  });
  let edit: Promise<unknown> | undefined,
    attempt: ReturnType<SupabaseClient["rpc"]> | undefined;
  try {
    held.stdin.write(
      `begin;select pg_backend_pid();select id from clinical_encounters where id='${race.id}'for update;select 'DICTATION_HELD';\n`,
    );
    await until(() => heldOutput.includes("DICTATION_HELD"), "owned row lock");
    const pid = Number(heldOutput.match(/^([0-9]+)$/m)?.[1]);
    assert.ok(Number.isSafeInteger(pid) && pid > 0);
    edit = rpc(second.db, "save_clinical_encounter", {
      p_id: race.id,
      p_pet_id: petId,
      p_expected_version: 1,
      p_visit_at: race.visit_at,
      p_visit_type: "clinic",
      p_location: race.location,
      p_subjective: "Other clinician saved history",
      p_objective: race.objective,
      p_assessment: race.assessment,
      p_plan: race.plan,
    });
    void edit.catch(() => undefined);
    let editorPid = 0;
    await until(() => {
      const observed = sql(
        `select pid from pg_stat_activity where ${pid}=any(pg_blocking_pids(pid))and query like '%save_clinical_encounter%' limit 1;`,
      );
      if (/^[0-9]+$/.test(observed)) editorPid = Number(observed);
      return editorPid > 0;
    }, "genuine HTTP saved edit waiting");
    observedWaits++;
    attempt = first.db.rpc(
      "save_clinical_dictation_action",
      args(reviewAction(first, raceSource)),
    );
    const resultPromise = Promise.resolve(attempt);
    await until(
      () =>
        sql(
          `select exists(select 1 from pg_stat_activity where (${pid}=any(pg_blocking_pids(pid))or ${editorPid}=any(pg_blocking_pids(pid)))and query like '%save_clinical_dictation_action%');`,
        ) === "t",
      "genuine HTTP proposal review waiting",
    );
    observedWaits++;
    held.stdin.end("commit;\\q\n");
    await heldExit;
    await edit;
    apiCheck((await resultPromise).error?.code, "PT409");
  } finally {
    if (!closed) {
      held.stdin.end("rollback;\\q\n");
      await heldExit;
    }
    if (edit) await edit.catch(() => undefined);
  }
  const rejected = reviewAction(first, raceSource, "rejected");
  apiCheck(
    verifyReceipt(
      await rpc(first.db, "save_clinical_dictation_action", args(rejected)),
      rejected,
    ).encounter,
    null,
  );
  // Genuine browser against the owned runtime; all other origins are blocked before transmission.
  const origin = "http://127.0.0.1:64881";
  vite = spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "--host",
      "127.0.0.1",
      "--port",
      "64881",
      "--strictPort",
    ],
    {
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
  }, "owned Vite server");
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1000 },
  });
  await context.addInitScript((session) => {
    if (!localStorage.getItem("synthetic:dictation-bootstrap")) {
      localStorage.setItem("sb-127-auth-token", JSON.stringify(session));
      localStorage.setItem("synthetic:dictation-bootstrap", "true");
    }
  }, first.session);
  await context.route("**/*", (route) =>
    [origin, status.API_URL].includes(new URL(route.request().url()).origin)
      ? route.continue()
      : route.abort(),
  );
  page = await context.newPage();
  page.setDefaultTimeout(20000);
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  const dropped = new Map<string, string>();
  await page.route(
    "**/rest/v1/rpc/save_clinical_dictation_action",
    async (route) => {
      const input = route.request().postDataJSON();
      if (!dropped.has(input.p_kind)) {
        const response = await route.fetch();
        assert.equal(response.status(), 200);
        dropped.set(input.p_kind, input.p_id);
        await route.abort("failed");
      } else await route.continue();
    },
  );
  await page.goto(
    origin + "/hub/patient/" + uiPet + "?tab=medical&section=soap",
  );
  const clinical = page.getByRole("region", {
    name: "Clinical records",
    exact: true,
  });
  await clinical.getByRole("button", { name: /· clinic · draft$/ }).click();
  const panel = clinical.locator('details[aria-label="Dictation drafts"]');
  await panel.locator("summary").click();
  await panel
    .getByRole("button", { name: "Import dictation draft", exact: true })
    .click();
  browserChecks++;
  await panel
    .getByLabel("Source transcript", { exact: true })
    .fill("Owner reports cough for two days. No exam was dictated.");
  await panel
    .getByLabel("Transcript source and authorization", { exact: true })
    .fill("Synthetic owned browser transcript, authorized for this test.");
  await panel
    .getByLabel("Proposed Subjective", { exact: true })
    .fill("Cough for two days.");
  await panel
    .getByLabel("Subjective supporting transcript excerpt", { exact: true })
    .fill("cough for two days");
  await panel
    .getByLabel(
      "I verified this transcript belongs to this patient and is authorized for use.",
      { exact: true },
    )
    .check();
  browserCheck(
    await clinical.getByLabel("Subjective", { exact: true }).isDisabled(),
    true,
  );
  await page.getByRole("button", { name: "Clients", exact: true }).click();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  browserCheck(
    await panel.getByLabel("Source transcript", { exact: true }).inputValue(),
    "Owner reports cough for two days. No exam was dictated.",
  );
  await panel
    .getByRole("button", {
      name: "Save dictation draft for review",
      exact: true,
    })
    .click();
  await panel
    .getByRole("button", { name: "Recover dictation save", exact: true })
    .waitFor();
  browserChecks++;
  await panel
    .getByRole("button", { name: "Recover dictation save", exact: true })
    .click();
  await panel
    .getByText("Draft imported for review. The encounter has not changed.", {
      exact: true,
    })
    .waitFor();
  browserChecks++;
  const uiSource = dropped.get("submit")!;
  assert.ok(uiSource);
  sqlCheck(
    sql(
      `select count(*)from clinical_dictation_proposals where encounter_id='${uiEncounter.id}';`,
    ),
    "1",
  );
  const unused = importAction(second, uiPet, uiEncounter.id);
  await rpc(second.db, "save_clinical_dictation_action", args(unused));
  await panel
    .getByRole("button", { name: "Reload dictation history", exact: true })
    .click();
  await panel.getByTestId("dictation-" + uiSource).click();
  const reviewPanel = panel.getByRole("region", {
    name: "Review dictation draft",
    exact: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await reviewPanel.getByLabel("Accept Subjective", { exact: true }).check();
  await reviewPanel
    .getByLabel("Subjective reviewed wording", { exact: true })
    .fill("Reviewed UI cough history.");
  await reviewPanel
    .getByLabel(
      "I reviewed the patient attribution, transcript and selected wording.",
      { exact: true },
    )
    .check();
  await reviewPanel
    .getByRole("button", {
      name: "Accept selected sections into saved draft",
      exact: true,
    })
    .click();
  await panel
    .getByRole("button", { name: "Recover dictation save", exact: true })
    .waitFor();
  browserChecks++;
  await rpc(second.db, "sign_clinical_encounter", {
    p_id: uiEncounter.id,
    p_expected_version: 2,
  });
  await panel
    .getByRole("button", { name: "Recover dictation save", exact: true })
    .click();
  await panel
    .getByText(
      "Acceptance confirmed. The encounter has since been signed; its text is locked.",
      { exact: true },
    )
    .waitFor();
  browserChecks++;
  browserCheck(
    await clinical.getByLabel("Subjective", { exact: true }).inputValue(),
    "Reviewed UI cough history.",
  );
  browserCheck(
    await clinical.getByLabel("Objective", { exact: true }).inputValue(),
    "Original exam",
  );
  browserCheck(
    await clinical
      .getByLabel("Subjective", { exact: true })
      .getAttribute("readonly"),
    "",
  );
  browserCheck(
    await clinical
      .getByRole("button", { name: "Review and sign", exact: true })
      .count(),
    0,
  );
  sqlCheck(
    sql(
      `select count(*)from clinical_dictation_reviews where proposal_id='${uiSource}';`,
    ),
    "1",
  );
  await panel.getByTestId("dictation-" + unused.id).click();
  await reviewPanel
    .getByLabel("Review note (required for rejection)", { exact: true })
    .fill("Later signed note supersedes this source draft.");
  await reviewPanel
    .getByLabel(
      "I reviewed the patient attribution, transcript and selected wording.",
      { exact: true },
    )
    .check();
  await reviewPanel
    .getByRole("button", { name: "Reject dictation draft", exact: true })
    .click();
  await panel
    .getByText("Draft rejected. The encounter has not changed.", {
      exact: true,
    })
    .waitFor();
  browserChecks++;
  await panel.getByTestId("dictation-" + uiSource).click();
  await page.setViewportSize({ width: 1280, height: 1000 });
  browserCheck(
    await reviewPanel
      .getByLabel("Subjective reviewed wording", { exact: true })
      .isEnabled(),
    true,
  );
  browserCheck(
    await reviewPanel
      .getByLabel("Subjective reviewed wording", { exact: true })
      .getAttribute("readonly"),
    "",
  );
  await panel.locator("summary").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "tmp/clinical-dictation-browser/desktop.png",
    fullPage: false,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await reviewPanel
    .getByLabel("Subjective reviewed wording", { exact: true })
    .scrollIntoViewIfNeeded();
  browserCheck(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );
  await page.screenshot({
    path: "tmp/clinical-dictation-browser/mobile.png",
    fullPage: false,
  });
  browserCheck(pageErrors, []);
  await context.close();
  const finalRead = readSchema.parse(
    await rpc(first.db, "read_clinical_dictation", {
      p_actor_id: first.id,
      p_pet_id: uiPet,
      p_encounter_id: uiEncounter.id,
    }),
  );
  apiCheck(
    finalRead.items.find((p) => p.id === uiSource)?.review?.decision,
    "accepted",
  );
  apiCheck(
    finalRead.items.find((p) => p.id === unused.id)?.review?.decision,
    "rejected",
  );
  // Populated public/auth/storage/extensions restore. Clone reads below use SQL-role context, not a second HTTP server.
  const snapshot = `set timezone='UTC';create temp table dictation_snapshot(name text,value jsonb);do $$declare r record;v jsonb;begin for r in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','auth','storage','extensions')and c.relkind in('r','p')order by 1,2 loop execute format('select jsonb_build_object(''count'',count(*),''hash'',md5(coalesce(string_agg(to_jsonb(t)::text,''|''order by to_jsonb(t)::text),'''')))from %I.%I t',r.nspname,r.relname)into v;insert into dictation_snapshot values(r.nspname||'.'||r.relname,v);end loop;end$$;select jsonb_object_agg(name,value)from dictation_snapshot;`;
  const before = JSON.parse(sql(snapshot));
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
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
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
      "owned_dictation_restore_" +
      randomUUID().replaceAll("-", "").slice(0, 10),
    marker = randomUUID();
  sql(`create database ${clone};comment on database ${clone} is '${marker}';`);
  try {
    sql(
      'drop schema public;create schema extensions;create extension pgcrypto with schema extensions;create extension "uuid-ossp"with schema extensions;',
      clone,
    );
    sql(dump, clone);
    sqlCheck(JSON.parse(sql(snapshot, clone)), before);
    sqlCheck(JSON.parse(sql(snapshot)), before);
    const sid = sql(
      `select id from auth.sessions where user_id='${first.id}'order by created_at desc limit 1;`,
    );
    assert.match(sid, /^[a-f0-9-]{36}$/);
    sqlCheck(
      sql(
        `begin;select set_config('request.jwt.claims','{"role":"authenticated","sub":"${first.id}","session_id":"${sid}"}',true);set local role authenticated;select read_clinical_dictation('${first.id}','${uiPet}','${uiEncounter.id}')->>'encounter_id';rollback;`,
        clone,
      )
        .split("\n")
        .at(-1),
      uiEncounter.id,
    );
  } finally {
    assert.equal(
      sql(
        `select shobj_description(oid,'pg_database')from pg_database where datname='${clone}';`,
      ),
      marker,
    );
    sql(`drop database ${clone} with(force);`);
    sqlCheck(
      sql(`select count(*)from pg_database where datname='${clone}';`),
      "0",
    );
  }
  sql(`delete from auth.sessions where user_id='${second.id}';`);
  apiCheck(
    (
      await second.db.rpc("read_clinical_dictation", {
        ...readArgs,
        p_actor_id: second.id,
      })
    ).error?.code,
    "42501",
  );
  const proof = {
    apiAssertions: apiChecks,
    browserAssertions: browserChecks,
    sqlRestoreAssertions: sqlChecks,
    observedHttpLockWaits: observedWaits,
    restoredRelations: Object.keys(before).length,
    populatedDictationFamilies: 3,
    droppedCommittedResponses: dropped.size,
    cloneRemoved: true,
    providerRequests: 0,
    limitations: [
      "Staff-supplied transcript/draft only; no audio or AI generation",
      "Restored-session read uses SQL context, not genuine HTTP",
    ],
  };
  writeFileSync(
    "tmp/clinical-dictation-roundtrip.json",
    JSON.stringify(proof, null, 2) + "\n",
    { mode: 0o600 },
  );
  console.log(JSON.stringify(proof));
} catch (failure) {
  if (page) {
    await page
      .screenshot({
        path: "tmp/clinical-dictation-browser/failure.png",
        fullPage: true,
      })
      .catch(() => undefined);
    writeFileSync(
      "tmp/clinical-dictation-browser/failure.html",
      await page.content().catch(() => ""),
      { mode: 0o600 },
    );
  }
  throw failure;
} finally {
  if (browser) await browser.close();
  if (vite) {
    const exited = new Promise<void>((resolve) =>
      vite!.once("exit", () => resolve()),
    );
    vite.kill("SIGTERM");
    await exited;
  }
  for (const a of actors) {
    try {
      sql(
        `update profiles set is_active=false where id='${a.id}';delete from user_roles where user_id='${a.id}';delete from auth.refresh_tokens where user_id='${a.id}';delete from auth.sessions where user_id='${a.id}';`,
      );
      const retired = await service.auth.admin.updateUserById(a.id, {
        ban_duration: "876000h",
      });
      if (retired.error)
        cleanupFailure = new Error("Owned synthetic actor retirement failed");
    } catch (error) {
      cleanupFailure = error;
    }
  }
}
if (cleanupFailure) throw cleanupFailure;
