/** Genuine next-visit Auth/PostgREST, observed schedule locks and populated restore. */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { readFileSync, realpathSync, mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parseOwnedRuntimeStatus } from "../estimates/owned-runtime-status.ts";
import { catalogEntrySchema } from "../../src/hub/features/scheduling/catalog-model.ts";
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
  email: string;
  password: string;
}
const options = { auth: { persistSession: false, autoRefreshToken: false } },
  service = createClient(status.API_URL, status.SERVICE_ROLE_KEY, options);
const actors: Actor[] = [];
let checks = 0;
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
  const value = { id, db, session: login.data.session, email, password };
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
import { nextVisitCompletionReceiptSchema } from "../../src/hub/features/scheduling/next-visit-model.ts";
const staff = await actor("STAFF"),
  dvm = await actor("DVM"),
  other = await actor("STAFF");
let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null,
  vite: ReturnType<typeof spawn> | null = null,
  browserChecks = 0;
const client = randomUUID(),
  pet = randomUUID();
import { nextVisitReviewSchema } from "../../src/hub/features/scheduling/next-visit-review-model.ts";
try {
  sql(
    `insert into clients(id,first_name,last_name,full_name,primary_phone,primary_email,preferred_channel) values('${client}','Synthetic','Staff household','Synthetic Staff household','+12025550194','synthetic-staff-${randomUUID()}@example.test','EMAIL');insert into pets(id,client_id,name,species) values('${pet}','${client}','Synthetic Staff Dog','Dog');`,
  );
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Denver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const base = {
    p_actor_id: staff.id,
    p_id: null,
    p_expected_version: null,
    p_client_id: client,
    p_pet_id: pet,
    p_duration_minutes: 30,
    p_appointment_type: "Synthetic Staff Source",
    p_status: "CONFIRMED",
    p_assigned_dvm_id: dvm.id,
    p_visit_type: "clinic",
    p_address_snapshot: "Synthetic",
    p_travel_before_minutes: 0,
    p_travel_after_minutes: 0,
    p_resource_name: null,
    p_notes: "Synthetic",
    p_reminder_offsets: [],
  };
  const visit = (at: string, extra: Record<string, unknown> = {}) =>
    rpc(staff.db, "save_appointment", {
      ...base,
      p_scheduled_at: at,
      ...extra,
    });
  const source = await visit("2035-01-01T16:00:00Z"),
    actionId = randomUUID(),
    request = { id: source.id, expected_version: 1 },
    reviewArgs = {
      p_actor_id: staff.id,
      p_action_id: actionId,
      p_operation: "complete",
      p_request: request,
    };
  const prepared = nextVisitReviewSchema.parse(
    await rpc(staff.db, "prepare_next_visit_review", reviewArgs),
  );
  check(prepared.state, "prepared");
  await denied(
    other.db,
    "read_next_visit_review",
    { p_actor_id: other.id, p_action_id: actionId },
    "42501",
  );
  const two = await Promise.all([
    staff.db.rpc("execute_next_visit_review", {
      p_actor_id: staff.id,
      p_action_id: actionId,
    }),
    staff.db.rpc("execute_next_visit_review", {
      p_actor_id: staff.id,
      p_action_id: actionId,
    }),
  ]);
  check(two[0].error, null);
  check(two[1].error, null);
  check(two[0].data, two[1].data);
  const complete = nextVisitCompletionReceiptSchema.parse(two[0].data);
  check(
    nextVisitReviewSchema.parse(
      await rpc(staff.db, "read_next_visit_review", {
        p_actor_id: staff.id,
        p_action_id: actionId,
      }),
    ).receipt,
    complete,
  );
  check(
    (
      await rpc(staff.db, "cancel_next_visit_review", {
        p_actor_id: staff.id,
        p_action_id: actionId,
      })
    ).cancelled,
    false,
  );
  const cancelId = randomUUID();
  await rpc(staff.db, "cancel_next_visit_review", {
    p_actor_id: staff.id,
    p_action_id: cancelId,
  });
  await denied(
    staff.db,
    "prepare_next_visit_review",
    { ...reviewArgs, p_action_id: cancelId },
    "PT409",
  );
  // Existing committed action remains recoverable after its private reviewed envelope has expired.
  const sid = JSON.parse(
    Buffer.from(
      (staff.session as { access_token: string }).access_token.split(".")[1],
      "base64url",
    ).toString(),
  ).session_id;
  const existingId = randomUUID(),
    later = {
      occurrence_id: complete.context.occurrence.id,
      expected_version: 0,
      values: {
        action: "later",
        note: "Synthetic expired saved decision",
        followup_on: null,
        booking: null,
        appointment_id: null,
        appointment_version: null,
      },
    };
  const saved = await rpc(staff.db, "save_next_visit_outcome", {
    p_actor_id: staff.id,
    p_action_id: existingId,
    p_occurrence_id: later.occurrence_id,
    p_expected_version: 0,
    p_values: later.values,
  });
  sql(
    `insert into appointment_next_visit_reviews(id,actor_id,operation,request,prepared_session_id,prepared_at,expires_at) values('${existingId}','${staff.id}','decide','${JSON.stringify(later)}','${sid}',now()-interval '2 days',now()-interval '1 day');`,
  );
  check(
    nextVisitReviewSchema.parse(
      await rpc(staff.db, "read_next_visit_review", {
        p_actor_id: staff.id,
        p_action_id: existingId,
      }),
    ).state,
    "saved",
  );
  check(
    await rpc(staff.db, "execute_next_visit_review", {
      p_actor_id: staff.id,
      p_action_id: existingId,
    }),
    saved,
  );
  // Real browser accepts only this owned app/API, with one intentional lost acknowledgment.
  vite = spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "--host",
      "127.0.0.1",
      "--port",
      "47281",
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
  for (let i = 0; i < 100; i++) {
    if (vite.exitCode !== null) throw new Error("Owned Vite exited");
    try {
      if ((await fetch("http://127.0.0.1:47281")).ok) break;
    } catch {
      /* Owned Vite is still starting. */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  await context.addInitScript((session) => {
    if (!localStorage.getItem("sb-127-auth-token"))
      localStorage.setItem("sb-127-auth-token", JSON.stringify(session));
  }, staff.session);
  await context.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1"
      ? route.continue()
      : route.abort(),
  );
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on("dialog", (dialog) => void dialog.accept());
  const homeVisit = await visit(today + "T16:00:00Z");
  await page.goto("http://127.0.0.1:47281/hub", {
    waitUntil: "domcontentloaded",
  });
  await page
    .getByRole("button", { name: "Complete visit", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Next visit for Synthetic Staff Dog" })
    .waitFor();
  browserChecks++;
  await page
    .getByRole("button", { name: "Schedule later", exact: true })
    .click();
  await page.locator("#next-visit-note").fill("Synthetic call to book later");
  await page
    .getByRole("button", { name: "Save schedule later", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByText("Synthetic call to book later", { exact: true })
    .waitFor();
  check(
    sql(`select status from appointments where id='${homeVisit.id}';`),
    "COMPLETED",
  );
  browserChecks++;
  await page
    .getByRole("button", { name: "Close next visit review", exact: true })
    .click();
  await page.reload();
  await page
    .getByRole("region", { name: "Pending next visits" })
    .getByText("Schedule later", { exact: false })
    .first()
    .waitFor();
  browserChecks++;
  const next = await visit("2035-01-02T16:00:00Z");
  await page.goto("http://127.0.0.1:47281/hub/schedule?date=2035-01-02");
  await page.getByRole("button", { name: "Complete", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Next visit for Synthetic Staff Dog" })
    .waitFor();
  await page
    .getByRole("button", { name: "Client declined", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save client declined", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .locator("p")
    .filter({ hasText: "Client declined · Recorded" })
    .waitFor();
  check(
    sql(`select status from appointments where id='${next.id}';`),
    "COMPLETED",
  );
  browserChecks++;
  await page
    .getByRole("button", { name: "Close next visit review", exact: true })
    .click();
  // Editor custom completion reaches the exact immutable trigger occurrence.
  const editorSource = await visit("2035-01-03T16:00:00Z");
  await page.goto("http://127.0.0.1:47281/hub/schedule?date=2035-01-03");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.locator("#booking-status").selectOption("COMPLETED");
  await page
    .getByRole("button", { name: "Save appointment", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Next visit for Synthetic Staff Dog" })
    .waitFor();
  check(
    sql(
      `select count(*) from appointment_completion_occurrences where appointment_id='${editorSource.id}' and appointment_version=2;`,
    ),
    "1",
  );
  browserChecks++;
  await page.locator("#next-visit-note").fill("Synthetic navigation draft");
  await page
    .getByRole("link", { name: "Open patient record", exact: true })
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Keep editing", exact: true })
    .click();
  check(
    await page.locator("#next-visit-note").inputValue(),
    "Synthetic navigation draft",
  );
  browserChecks++;
  await page.locator("#next-visit-note").fill("");
  await page
    .getByRole("button", { name: "Schedule next visit", exact: true })
    .click();
  await page.locator("#booking-reason").fill("Synthetic Staff follow-up");
  await page.locator("#booking-clinician").selectOption(dvm.id);
  await page.locator("#booking-time").fill("2035-01-04T09:00");
  await page.locator("#booking-notes").fill("Synthetic private reviewed note");
  let lost = false;
  await page.route(
    status.API_URL + "/rest/v1/rpc/execute_next_visit_review",
    async (route) => {
      const response = await route.fetch();
      if (!lost && response.ok()) {
        lost = true;
        await route.abort("failed");
      } else await route.fulfill({ response });
    },
  );
  await page
    .getByRole("button", { name: "Book and record next visit", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Check saved follow-up", exact: true })
    .waitFor();
  await waitUntil(
    () => lost,
    "successful follow-up response intentionally dropped",
  );
  check(lost, true);
  check(await page.locator("#booking-time").isDisabled(), true);
  browserChecks++;
  check(
    await page.evaluate(() =>
      Object.keys(localStorage)
        .filter((k) => k.startsWith("lrv:next-visit-reviews:"))
        .every((k) => {
          const raw = localStorage.getItem(k)!;
          return (
            !raw.includes("private reviewed note") &&
            !raw.includes("address") &&
            JSON.parse(raw).every(
              (v: Record<string, unknown>) =>
                Object.keys(v).sort().join(",") === "actor_id,id,operation",
            )
          );
        }),
    ),
    true,
  );
  browserChecks++;
  // Permission loss after an uncertain commit hides clinical drafts and retains the actor pointer.
  sql(`update profiles set is_active=false where id='${staff.id}';`);
  await page.reload();
  await page.getByLabel("Email", { exact: true }).waitFor();
  check(
    await page
      .getByText("Synthetic private reviewed note", { exact: true })
      .count(),
    0,
  );
  browserChecks++;
  await waitUntil(
    () =>
      sql(
        `select count(*) from auth.sessions where id='${sid}' and (not_after is null or not_after>clock_timestamp());`,
      ) === "0",
    "deactivated browser session retired",
  );
  sql(`update profiles set is_active=true where id='${staff.id}';`);
  const fresh = await staff.db.auth.signInWithPassword({
    email: staff.email,
    password: staff.password,
  });
  if (fresh.error) throw fresh.error;
  staff.session = fresh.data.session;
  await page.evaluate(
    (session) =>
      localStorage.setItem("sb-127-auth-token", JSON.stringify(session)),
    other.session,
  );
  await page.reload();
  await page.goto("http://127.0.0.1:47281/hub/schedule?date=2035-01-03");
  check(
    await page
      .getByRole("region", { name: "Unconfirmed next visit reviews" })
      .count(),
    0,
  );
  check(
    await page
      .getByText("Synthetic private reviewed note", { exact: true })
      .count(),
    0,
  );
  browserChecks++;
  await page.evaluate(
    (session) =>
      localStorage.setItem("sb-127-auth-token", JSON.stringify(session)),
    staff.session,
  );
  await page.reload();
  await page
    .getByRole("region", { name: "Unconfirmed next visit reviews" })
    .getByRole("button", { name: "Check saved review", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Next visit for Synthetic Staff Dog" })
    .waitFor();
  await page
    .getByRole("region", { name: "Recorded next booking" })
    .getByText("Booked", { exact: true })
    .waitFor();
  check(
    sql(
      `select count(*) from appointments where pet_id='${pet}' and appointment_type='Synthetic Staff follow-up';`,
    ),
    "1",
  );
  browserChecks++;
  const follow = JSON.parse(
    sql(
      `select jsonb_build_object('id',id,'version',version) from appointments where pet_id='${pet}' and appointment_type='Synthetic Staff follow-up';`,
    ),
  );
  await rpc(staff.db, "cancel_appointment", {
    p_id: follow.id,
    p_expected_version: follow.version,
  });
  await page.reload();
  await page.goto(`http://127.0.0.1:47281/hub/patient/${pet}?tab=schedule`);
  await page
    .getByRole("region", { name: "Next visit decisions" })
    .getByRole("button", { name: "Review next visit", exact: true })
    .nth(3)
    .click();
  await page
    .getByRole("region", { name: "Recorded next booking" })
    .getByText("Cancelled", { exact: true })
    .waitFor();
  browserChecks++;
  await page
    .getByRole("button", { name: "Close next visit review", exact: true })
    .click();
  // Managed editor completion uses a reviewed publication and keeps its binding.
  const typeId = randomUUID(),
    definition = {
      name: "Synthetic staff reviewed visit",
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
  const cat = (action: string, version: number | null) => ({
    p_actor_id: dvm.id,
    p_action_id: randomUUID(),
    p_id: typeId,
    p_expected_version: version,
    p_kind: "type",
    p_action: action,
    p_values: {
      definition,
      review_note: "Synthetic exact staff review",
      attest_review: action !== "draft",
    },
  });
  await rpc(dvm.db, "save_appointment_catalog", cat("draft", null));
  const pub = catalogEntrySchema.parse(
    await rpc(dvm.db, "save_appointment_catalog", cat("publish", 1)),
  );
  await visit("2035-01-05T16:00:00Z");
  await page.goto("http://127.0.0.1:47281/hub/schedule?date=2035-01-05");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.locator("#booking-catalog-type").selectOption(pub.published!.id);
  await page.locator("#booking-status").selectOption("COMPLETED");
  await page
    .getByRole("button", { name: "Save appointment", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Next visit for Synthetic Staff Dog" })
    .waitFor();
  browserChecks++;
  sql(
    `insert into user_roles(user_id,role) values('${dvm.id}','ADMIN') on conflict do nothing;`,
  );
  const template = randomUUID(),
    plan = randomUUID();
  await rpc(dvm.db, "save_recurring_care_template", {
    p_action_id: randomUUID(),
    p_id: template,
    p_expected_version: null,
    p_request: {
      care_key: "synthetic-staff-reviewed",
      name: "Synthetic reviewed staff wellness",
      care_kind: "wellness",
      interval_amount: 1,
      interval_unit: "months",
      anchor_mode: "fixed_schedule",
      month_end: "clamp",
      active: true,
      review_note: "Synthetic clinician review",
    },
  });
  await rpc(dvm.db, "save_patient_care_plan", {
    p_action_id: randomUUID(),
    p_id: plan,
    p_pet_id: pet,
    p_expected_version: null,
    p_request: {
      template_id: template,
      template_version: 1,
      name: "Synthetic reviewed staff wellness",
      interval_amount: 1,
      interval_unit: "months",
      anchor_mode: "fixed_schedule",
      month_end: "clamp",
      anchor_on: "2026-01-31",
      due_on: "2026-02-28",
      status: "current",
      reminders_enabled: false,
      override_reason: "",
      review_note: "Synthetic reviewed patient calendar",
      replace_anchor_evidence: false,
    },
  });
  await rpc(dvm.db, "save_patient_lab_order", {
    p_id: randomUUID(),
    p_pet_id: pet,
    p_expected_version: null,
    p_values: {
      test_name: "Synthetic planned staff CBC",
      status: "planned",
      due_date: "2035-01-07",
    },
    p_correction_reason: "",
  });
  await page
    .getByRole("button", { name: "Close next visit review", exact: true })
    .click();
  await page
    .getByRole("region", { name: "Pending next visits" })
    .getByRole("button", { name: "Review next visit", exact: true })
    .last()
    .click();
  await page
    .getByRole("region", { name: "Due care context" })
    .getByText(/Synthetic reviewed staff wellness.*Reviewed care/)
    .waitFor();
  await page
    .getByRole("region", { name: "Due care context" })
    .getByText(/Synthetic planned staff CBC.*planned lab/)
    .waitFor();
  browserChecks++;
  // A retained unassigned future visit is explicit and can resolve without creating another booking.
  const unassigned = randomUUID();
  sql(
    `insert into appointments(id,client_id,pet_id,scheduled_at,duration_minutes,appointment_type,status,visit_type) values('${unassigned}','${client}','${pet}','2035-01-07T16:00:00Z',30,'Synthetic Unassigned','SCHEDULED','clinic');`,
  );
  await page
    .getByRole("button", { name: "Close next visit review", exact: true })
    .click();
  await page
    .getByRole("region", { name: "Pending next visits" })
    .getByRole("button", { name: "Review next visit", exact: true })
    .last()
    .click();
  await page
    .getByRole("region", { name: "Existing future appointments" })
    .getByText(/Synthetic Unassigned.*Unassigned/)
    .waitFor();
  await page
    .getByRole("listitem")
    .filter({ hasText: "Synthetic Unassigned" })
    .getByRole("button", { name: "Use this appointment", exact: true })
    .click();
  await page.getByRole("region", { name: "Recorded next booking" }).waitFor();
  check(
    sql(
      `select count(*) from appointments where pet_id='${pet}' and appointment_type='Synthetic Unassigned';`,
    ),
    "1",
  );
  browserChecks++;
  await page.setViewportSize({ width: 390, height: 900 });
  await page
    .getByRole("dialog")
    .evaluate((el) =>
      Promise.all(
        el
          .getAnimations()
          .map((animation) => animation.finished.catch(() => undefined)),
      ),
    );
  mkdirSync("tmp/next-visit-staff-browser", { recursive: true });
  await page.screenshot({
    path: "tmp/next-visit-staff-browser/mobile-next-visit.png",
  });
  check(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );
  check(
    await page
      .getByRole("button", { name: "Close next visit review", exact: true })
      .evaluate((el) => el.getBoundingClientRect().height >= 44),
    true,
  );
  browserChecks++;
  await page
    .getByRole("button", { name: "Close next visit review", exact: true })
    .click();
  // Reviewed catalog follow-up reuses the same editor and atomic outcome transaction.
  await page.setViewportSize({ width: 1280, height: 900 });
  const catalogSource = await visit("2035-01-08T16:00:00Z");
  await page.goto("http://127.0.0.1:47281/hub/schedule?date=2035-01-08");
  await page.getByRole("button", { name: "Complete", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Next visit for Synthetic Staff Dog" })
    .waitFor();
  await page
    .getByRole("button", { name: "Schedule next visit", exact: true })
    .click();
  await page.locator("#booking-catalog-type").selectOption(pub.published!.id);
  await page.locator("#booking-clinician").selectOption(dvm.id);
  await page.locator("#booking-time").fill("2035-01-09T09:00");
  await page
    .getByRole("button", { name: "Book and record next visit", exact: true })
    .click();
  await page.getByRole("region", { name: "Recorded next booking" }).waitFor();
  check(
    sql(
      `select count(*) from appointment_next_visit_decisions d join appointment_completion_occurrences o on o.id=d.occurrence_id where o.appointment_id='${catalogSource.id}' and d.booking_receipt#>>'{binding,type,id}'='${pub.published!.id}';`,
    ),
    "1",
  );
  browserChecks++;
  await page
    .getByRole("button", { name: "Close next visit review", exact: true })
    .click();
  mkdirSync("tmp/next-visit-staff-browser", { recursive: true });
  await page.screenshot({
    path: "tmp/next-visit-staff-browser/schedule-desktop.png",
    fullPage: true,
  });
  // Page date changes never remove the pending/later queue.
  await page.getByLabel("Schedule date").fill("2036-01-01");
  await page
    .getByRole("region", { name: "Pending next visits" })
    .getByText("Schedule later", { exact: false })
    .first()
    .waitFor();
  browserChecks++;
  await context.close();
  console.log(
    `Genuine local next-visit staff passed: ${checks} checks; ${browserChecks} browser checks; no provider requests.`,
  );
} finally {
  await browser?.close();
  vite?.kill("SIGTERM");
  for (const person of actors) {
    sql(`update profiles set is_active=false where id='${person.id}';`);
    await person.db.auth.signOut();
  }
}
