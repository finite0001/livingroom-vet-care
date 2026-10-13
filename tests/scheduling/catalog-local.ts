/** Genuine synthetic Auth/PostgREST, observed schedule locks, browser and populated restore. */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { readFileSync, realpathSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { parseOwnedRuntimeStatus } from "../estimates/owned-runtime-status.ts";
import {
  catalogEntrySchema,
  bookingReceiptSchema,
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
  observed = 0,
  browserChecks = 0,
  restoreChecks = 0;
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
  if (error) throw error;
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
          "select count(*) from pg_stat_activity where wait_event='advisory' and query like '%appointment%';",
        ),
      ) >= number,
    "schedule advisory waiters",
  );
  observed++;
}
let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null,
  vite: ReturnType<typeof spawn> | null = null;
try {
  const staff = await actor("STAFF"),
    dvm = await actor("DVM"),
    admin = await actor("ADMIN");
  const client = randomUUID(),
    pet = randomUUID();
  sql(
    `insert into clients(id,first_name,last_name,full_name,primary_phone,primary_email,preferred_channel) values('${client}','Synthetic','Catalog household','Synthetic Catalog household','+12025550199','synthetic-catalog@example.test','EMAIL');insert into pets(id,client_id,name,species,breed) values('${pet}','${client}','Synthetic Catalog Dog','Dog','Mixed');`,
  );
  const legacy = {
    p_actor_id: staff.id,
    p_id: null,
    p_expected_version: null,
    p_client_id: client,
    p_pet_id: pet,
    p_scheduled_at: "2030-01-10T16:00:00Z",
    p_duration_minutes: 30,
    p_appointment_type: "Synthetic custom",
    p_status: "SCHEDULED",
    p_assigned_dvm_id: staff.id,
    p_visit_type: "clinic",
    p_address_snapshot: "Synthetic",
    p_travel_before_minutes: 0,
    p_travel_after_minutes: 0,
    p_resource_name: "Historical Room",
    p_notes: "Synthetic history",
    p_reminder_offsets: [24],
  };
  const existing = await rpc(staff.db, "save_appointment", legacy);
  check(existing.version, 1);
  const typeId = randomUUID(),
    resourceId = randomUUID();
  const type = {
    name: "Synthetic reviewed wellness",
    category: "well",
    species: ["Dog"],
    visit_types: ["clinic", "housecall"],
    duration_minutes: 30,
    travel_before_minutes: 0,
    travel_after_minutes: 0,
    resource_kind: "exam",
    staffing: "dvm",
    allow_override: true,
  };
  const resource = {
    name: "Synthetic Exam One",
    resource_kind: "exam",
    visit_types: ["clinic", "housecall"],
    aliases: ["Historical Room"],
  };
  const catalogArgs = (
    id: string,
    kind: string,
    definition: unknown,
    expected: number | null,
    operation: string,
    actorId = dvm.id,
  ) => ({
    p_actor_id: actorId,
    p_action_id: randomUUID(),
    p_id: id,
    p_expected_version: expected,
    p_kind: kind,
    p_action: operation,
    p_values: {
      definition,
      review_note: "Synthetic exact practice review",
      attest_review: operation !== "draft",
    },
  });
  await denied(
    staff.db,
    "save_appointment_catalog",
    catalogArgs(typeId, "type", type, null, "draft", staff.id),
    "42501",
  );
  const draftArgs = catalogArgs(typeId, "type", type, null, "draft"),
    draft = catalogEntrySchema.parse(
      await rpc(dvm.db, "save_appointment_catalog", draftArgs),
    );
  check(draft.published, null);
  check(
    (
      await rpc(staff.db, "list_appointment_catalog", {
        p_kind: "type",
        p_limit: 50,
      })
    ).items.length,
    0,
  );
  const published = catalogEntrySchema.parse(
    await rpc(
      dvm.db,
      "save_appointment_catalog",
      catalogArgs(typeId, "type", type, 1, "publish"),
    ),
  );
  check(
    catalogEntrySchema.parse(
      await rpc(dvm.db, "save_appointment_catalog", draftArgs),
    ),
    draft,
  );
  await rpc(
    admin.db,
    "save_appointment_catalog",
    catalogArgs(resourceId, "resource", resource, null, "draft", admin.id),
  );
  const room = catalogEntrySchema.parse(
    await rpc(
      admin.db,
      "save_appointment_catalog",
      catalogArgs(resourceId, "resource", resource, 1, "publish", admin.id),
    ),
  );
  const values = {
    type_version_id: published.published!.id,
    resource_version_id: room.published!.id,
    client_id: client,
    pet_id: pet,
    scheduled_at: "2030-01-01T16:00:00Z",
    duration_minutes: 30,
    status: "SCHEDULED",
    assigned_dvm_id: dvm.id,
    visit_type: "clinic",
    address_snapshot: "Synthetic",
    travel_before_minutes: 0,
    travel_after_minutes: 0,
    notes: "Synthetic",
    reminder_offsets: [48, 24],
    override_note: "",
  };
  const args = (time: string) => ({
    p_actor_id: staff.id,
    p_action_id: randomUUID(),
    p_id: null,
    p_expected_version: null,
    p_values: { ...values, scheduled_at: time },
  });
  await denied(
    staff.db,
    "save_catalog_appointment",
    {
      ...args("2030-01-01T16:00:00Z"),
      p_values: { ...values, assigned_dvm_id: staff.id },
    },
    "23514",
  );
  // Both requests demonstrably queue behind the same schedule lock; one capacity winner.
  let release = await heldSchedule();
  const typed = staff.db
    .rpc("save_catalog_appointment", args("2030-01-01T16:00:00Z"))
    .then((v) => v);
  await waiters(1);
  const old = staff.db
    .rpc("save_appointment", {
      ...legacy,
      p_id: existing.id,
      p_expected_version: 1,
      p_scheduled_at: "2030-01-01T16:00:00Z",
    })
    .then((v) => v);
  await waiters(2);
  await release();
  const competing = await Promise.all([typed, old]);
  check(competing.filter((v) => !v.error).length, 1);
  check(competing.find((v) => v.error)?.error?.code, "23P01");
  const retryArgs = args("2030-01-02T16:00:00Z");
  release = await heldSchedule();
  const first = staff.db
    .rpc("save_catalog_appointment", retryArgs)
    .then((v) => v);
  await waiters(1);
  const second = staff.db
    .rpc("save_catalog_appointment", retryArgs)
    .then((v) => v);
  await waiters(2);
  await release();
  const replays = await Promise.all([first, second]);
  check(replays[0].error, null);
  check(replays[1].error, null);
  check(replays[0].data, replays[1].data);
  const saved = bookingReceiptSchema.parse(replays[0].data);
  check(saved.binding.fields.duration_minutes, 30);
  check(
    sql(
      `select count(*) from appointment_catalog_bindings where appointment_id='${saved.appointment.id}';`,
    ),
    "1",
  );
  check(
    sql(
      `select count(*) from appointment_reminders where appointment_id='${saved.appointment.id}' and status='PENDING';`,
    ),
    "2",
  );
  await denied(
    staff.db,
    "save_catalog_appointment",
    { ...retryArgs, p_values: { ...retryArgs.p_values, notes: "Changed" } },
    "23505",
  );
  check(await rpc(staff.db, "recover_catalog_appointment", retryArgs), saved);
  await denied(
    dvm.db,
    "recover_catalog_appointment",
    { ...retryArgs, p_actor_id: dvm.id },
    "23505",
  );
  check(
    bindingSchema.parse(
      await rpc(staff.db, "read_appointment_catalog_binding", {
        p_id: saved.appointment.id,
      }),
    ),
    saved.binding,
  );
  // Permanent aliases stay stable when the display name changes.
  const renamed = {
    ...resource,
    name: "Synthetic Exam Renamed",
    aliases: ["Historical Room", "Synthetic Exam One"],
  };
  await rpc(
    admin.db,
    "save_appointment_catalog",
    catalogArgs(resourceId, "resource", renamed, 2, "draft", admin.id),
  );
  const renamedRoom = catalogEntrySchema.parse(
    await rpc(
      admin.db,
      "save_appointment_catalog",
      catalogArgs(resourceId, "resource", renamed, 3, "publish", admin.id),
    ),
  );
  await denied(
    staff.db,
    "save_catalog_appointment",
    {
      ...args("2030-01-02T16:00:00Z"),
      p_values: { ...values, resource_version_id: renamedRoom.published!.id },
    },
    "23P01",
  );
  check(await rpc(staff.db, "recover_catalog_appointment", retryArgs), saved);
  // Retirement demonstrably queues before a booking using that exact old publication.
  release = await heldSchedule();
  const retiring = dvm.db
    .rpc(
      "save_appointment_catalog",
      catalogArgs(typeId, "type", type, 2, "retire"),
    )
    .then((v) => v);
  await waiters(1);
  const booking = staff.db
    .rpc("save_catalog_appointment", {
      ...args("2030-01-03T16:00:00Z"),
      p_values: {
        ...values,
        resource_version_id: renamedRoom.published!.id,
        scheduled_at: "2030-01-03T16:00:00Z",
      },
    })
    .then((v) => v);
  await waiters(2);
  await release();
  check((await retiring).error, null);
  check((await booking).error?.code, "PT409");
  check(await rpc(staff.db, "save_catalog_appointment", retryArgs), saved);
  check(
    (
      await rpc(staff.db, "save_appointment", {
        ...legacy,
        p_id: saved.appointment.id,
        p_expected_version: 1,
        p_scheduled_at: "2030-01-02T16:00:00Z",
        p_appointment_type: type.name,
        p_assigned_dvm_id: dvm.id,
        p_resource_name: resource.name,
        p_status: "COMPLETED",
        p_reminder_offsets: [48, 24],
      })
    ).version,
    2,
  );
  // Publish again only through a saved draft; keep earlier booked snapshots.
  await rpc(
    dvm.db,
    "save_appointment_catalog",
    catalogArgs(typeId, "type", type, 3, "draft"),
  );
  const current = catalogEntrySchema.parse(
    await rpc(
      dvm.db,
      "save_appointment_catalog",
      catalogArgs(typeId, "type", type, 4, "publish"),
    ),
  );
  const originalAddress = "Synthetic original housecall destination";
  const originalHousecall = bookingReceiptSchema.parse(await rpc(staff.db, "save_catalog_appointment", {
    ...args("2030-01-06T16:00:00Z"), p_values: { ...values, type_version_id: current.published!.id,
      resource_version_id: renamedRoom.published!.id, scheduled_at: "2030-01-06T16:00:00Z", visit_type: "housecall", address_snapshot: originalAddress }
  }));
  // Real browser data: only intercept one successful response to simulate lost acknowledgment.
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
      /* Owned Vite may still be starting. */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ headless: true });
  mkdirSync("tmp/catalog-browser", { recursive: true });
  for (const width of [1280, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
    });
    await context.addInitScript(
      (session) =>
        localStorage.setItem("sb-127-auth-token", JSON.stringify(session)),
      staff.session,
    );
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      return url.origin === status.API_URL ||
        url.origin === "http://127.0.0.1:47281"
        ? route.continue()
        : route.abort();
    });
    context.setDefaultTimeout(60000); context.setDefaultNavigationTimeout(90000);
    const page = await context.newPage();
    await page.goto(
      `http://127.0.0.1:47281/hub/schedule`, { waitUntil: "domcontentloaded" },
    );
    await page
      .getByRole("button", { name: "Book appointment", exact: true })
      .click();
    await page.locator("#booking-client").selectOption(client);
    await page.locator("#booking-pet").selectOption(pet);
    await page
      .locator("#booking-catalog-type")
      .selectOption(current.published!.id);
    await page.locator("#booking-clinician").selectOption(dvm.id);
    await page.locator("#booking-room").selectOption(renamedRoom.published!.id);
    await page
      .locator("#booking-time")
      .fill(width === 1280 ? "2030-01-04T09:00" : "2030-01-05T09:00");
    check(await page.locator("#booking-duration").inputValue(), "30");
    browserChecks++;
    await page.locator("#booking-duration").fill("45");
    await page
      .locator("#booking-review")
      .fill("Synthetic practice time review");
    let lost = false;
    await page.route(
      status.API_URL + "/rest/v1/rpc/save_catalog_appointment",
      async (route) => {
        const response = await route.fetch();
        if (!lost && response.ok()) {
          lost = true;
          await route.abort("failed");
        } else await route.fulfill({ response });
      },
    );
    await page
      .getByRole("button", { name: "Save appointment", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Check saved action", exact: true })
      .waitFor();
    check(await page.locator("#booking-duration").isDisabled(), true);
    browserChecks++;
    await page.screenshot({
      path: `tmp/catalog-browser/booking-${width}.png`,
      fullPage: true,
    });
    if (width === 1280) {
      sql(`update profiles set is_active=false where id='${staff.id}';`);
      await page.getByRole("button", { name: "Retry unchanged review", exact: true }).click();
      await page.getByRole("alert").filter({ hasText: "Your current account cannot make this change" }).waitFor();
      check(await page.locator("#booking-duration").isDisabled(), true); browserChecks++;
      check(await page.getByRole("button", { name: "Check saved action", exact: true }).count(), 1); browserChecks++;
      sql(`update profiles set is_active=true where id='${staff.id}';`);
    }
    await page
      .getByRole("button", { name: "Check saved action", exact: true })
      .click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    check(lost, true);
    browserChecks++;
    check(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      true,
    );
    browserChecks++;
    await page.goto("http://127.0.0.1:47281/hub/tools/appointment-catalog", { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: type.name, exact: true }).waitFor();
    check(
      await page
        .getByRole("button", { name: "New draft", exact: true })
        .count(),
      0,
    );
    browserChecks++;
    await page.screenshot({
      path: `tmp/catalog-browser/catalog-staff-${width}.png`,
      fullPage: true,
    });
    if (width === 390) {
      await page.goto("http://127.0.0.1:47281/hub/schedule?date=2030-01-06", { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await page.locator("#booking-catalog-type").selectOption(current.published!.id);
      await page.locator("#booking-type").selectOption("clinic");
      check(await page.getByRole("button", { name: "Save appointment", exact: true }).isDisabled(), true); browserChecks++;
      await page.getByRole("button", { name: "Restore original reviewed settings", exact: true }).click();
      check(await page.locator("#booking-address").inputValue(), originalAddress); browserChecks++;
      check(await page.locator("#booking-type").inputValue(), "housecall"); browserChecks++;
      await page.locator("#booking-catalog-type").selectOption(current.published!.id);
      await page.locator("#booking-client").selectOption(client);
      check(await page.locator("#booking-pet").isDisabled(), false); browserChecks++;
      await page.getByRole("button", { name: "Restore original reviewed settings", exact: true }).click();
      await page.locator("#booking-notes").fill("Synthetic unchanged frozen review");
      await page.getByRole("button", { name: "Save appointment", exact: true }).click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      check(bindingSchema.parse(await rpc(staff.db,"read_appointment_catalog_binding",{p_id:originalHousecall.appointment.id})),originalHousecall.binding);
    }
    await context.close();
  }
  // Reviewer draft/publication through real browser and explicit unsaved-dismiss confirmation.
  const context = await browser.newContext({
    viewport: { width: 390, height: 900 },
  });
  await context.addInitScript(
    (session) =>
      localStorage.setItem("sb-127-auth-token", JSON.stringify(session)),
    admin.session,
  );
  await context.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1"
      ? route.continue()
      : route.abort(),
  );
  context.setDefaultTimeout(60000); context.setDefaultNavigationTimeout(90000);
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:47281/hub/tools/appointment-catalog", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "New draft", exact: true }).click();
  await page.locator("#catalog-name").fill("Synthetic browser type");
  await page.locator("#catalog-species").fill("Dog");
  page.once("dialog", (dialog) => void dialog.dismiss());
  await page
    .locator("form")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  check(
    await page.locator("#catalog-name").inputValue(),
    "Synthetic browser type",
  );
  browserChecks++;
  await page.locator("#catalog-duration").fill("40");
  await page
    .locator("#catalog-review")
    .fill("Synthetic browser practice review");
  let draftLost = false;
  await page.route(
    status.API_URL + "/rest/v1/rpc/save_appointment_catalog",
    async (route) => {
      const response = await route.fetch();
      if (!draftLost && response.ok()) {
        draftLost = true;
        await route.abort("failed");
      } else await route.fulfill({ response });
    },
  );
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page
    .getByRole("button", { name: "Check saved action", exact: true })
    .waitFor();
  check(await page.locator("#catalog-name").isDisabled(), true);
  browserChecks++;
  await page
    .getByRole("button", { name: "Check saved action", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  check(draftLost, true);
  browserChecks++;
  const card = page
    .getByRole("listitem")
    .filter({
      has: page.getByRole("heading", {
        name: "Synthetic browser type",
        exact: true,
      }),
    });
  await card
    .getByRole("button", { name: "Review configuration", exact: true })
    .click();
  await page
    .locator("#catalog-review")
    .fill("Synthetic exact browser publication review");
  await page
    .getByLabel("I reviewed this saved definition and its scheduling rules.")
    .check();
  await page.screenshot({
    path: "tmp/catalog-browser/catalog-review-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Publish reviewed draft", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await card.getByText(/Published revision 2 available for bookings/).waitFor();
  check(
    await card.textContent().then((v) => v?.includes("Published revision 2")),
    true,
  );
  browserChecks++;
  await context.close();
  // All six populated ledgers, appointment bindings, Auth relations and privileges survive pg_dump/restore.
  const tables = [
    "appointment_catalog_entries",
    "appointment_catalog_versions",
    "appointment_resource_aliases",
    "appointment_catalog_actions",
    "appointment_catalog_bindings",
    "appointment_booking_actions",
  ];
  const snapshot =
    "select jsonb_object_agg(name,rows) from (" +
    tables
      .map(
        (table) =>
          `select '${table}' name,coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) rows from public.${table} t`,
      )
      .join(" union all ") +
    ") r;";
  const original = JSON.parse(sql(snapshot));
  for (const table of tables) assert.ok(original[table].length > 0);
  const backup = execFileSync(
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
    { maxBuffer: 40 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] },
  )
    .toString()
    .replace(
      "CREATE SCHEMA extensions;",
      "CREATE SCHEMA IF NOT EXISTS extensions;",
    )
    .split("\n")
    .filter((line) => !line.startsWith("ALTER DEFAULT PRIVILEGES"))
    .join("\n");
  const restored = "lrv_catalog_restore_" + randomUUID().replaceAll("-", ""),
    marker = randomUUID();
  sql(
    `create database "${restored}";comment on database "${restored}" is '${marker}';`,
  );
  try {
    sql(
      'drop schema public;create schema extensions;create extension pgcrypto with schema extensions;create extension "uuid-ossp" with schema extensions;',
      restored,
    );
    sql(backup, restored);
    const recovered = JSON.parse(sql(snapshot, restored));
    for (const table of tables) {
      check(recovered[table], original[table]);
      restoreChecks++;
    }
    check(
      sql(
        "select has_table_privilege('authenticated','appointment_catalog_bindings','INSERT');",
        restored,
      ),
      "f",
    );
    restoreChecks++;
    check(
      sql(
        "select has_function_privilege('authenticated','public.save_appointment_before_catalog(uuid,uuid,integer,uuid,uuid,timestamptz,integer,text,appointment_status,uuid,text,text,integer,integer,text,text,integer[])','EXECUTE');",
        restored,
      ),
      "f",
    );
    restoreChecks++;
    check(
      JSON.parse(
        sql(
          `set role authenticated;set request.jwt.claims='{"sub":"${staff.id}","role":"authenticated"}';select recover_catalog_appointment('${staff.id}','${retryArgs.p_action_id}',null,null,'${JSON.stringify(retryArgs.p_values)}'::jsonb);`,
          restored,
        ),
      ),
      saved,
    );
    restoreChecks++;
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
    `Genuine local appointment catalog passed: ${checks} checks; ${observed} observed lock queues; ${browserChecks} browser checks; ${restoreChecks} populated restore checks; no provider requests.`,
  );
} finally {
  await browser?.close();
  vite?.kill("SIGTERM");
  for (const person of actors) {
    sql(`update profiles set is_active=false where id='${person.id}';`);
    await person.db.auth.signOut();
  }
}
