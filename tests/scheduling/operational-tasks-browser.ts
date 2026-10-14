/** Real browser workflow; no mocked operational RPCs or external provider traffic. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { operationalLocal } from "../../src/hub/features/daily-tasks/task-ui.ts";
import { denverLocal } from "../../src/hub/features/scheduling/time.ts";
import type { SupabaseClient, Session } from "@supabase/supabase-js";
interface Actor {
  id: string;
  db: SupabaseClient;
  session: Session | null;
  email: string;
  password: string;
}
interface BrowserInput {
  status: { API_URL: string; ANON_KEY: string };
  admin: Actor;
  staff: Actor;
  other: Actor;
  tech: Actor;
  client: string;
  pet: string;
  room: { id: string; published: { id: string; definition: { name: string } } };
  type: { published: { id: string } };
  sql: (query: string) => string;
  rpc: (
    actor: Actor,
    name: string,
    args: Record<string, unknown>,
  ) => Promise<unknown>;
}
export async function operationalBrowserProof(
  input: BrowserInput,
): Promise<number> {
  const {
    status,
    admin,
    staff,
    other,
    tech,
    client,
    pet,
    room,
    type,
    sql,
    rpc,
  } = input;
  let checks = 0;
  const api = new URL(status.API_URL);
  assert.equal(api.hostname, "127.0.0.1");
  const port = api.port === "48621" ? 48681 : 47281,
    origin = `http://127.0.0.1:${port}`;
  const vite = spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
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
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  async function until(
    predicate: () => boolean | Promise<boolean>,
    label: string,
  ) {
    for (let n = 0; n < 200; n++) {
      if (await predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error("Did not observe " + label);
  }
  function check(actual: unknown, expected: unknown) {
    assert.deepEqual(actual, expected);
    checks++;
  }
  try {
    await until(async () => {
      if (vite.exitCode !== null) throw new Error("Owned browser app exited");
      try {
        return (await fetch(origin)).ok;
      } catch {
        return false;
      }
    }, "owned app ready");
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    await context.addInitScript((session) => {
      if (!localStorage.getItem("synthetic:task-browser-bootstrapped")) {
        localStorage.setItem("sb-127-auth-token", JSON.stringify(session));
        localStorage.setItem("synthetic:task-browser-bootstrapped", "true");
      }
    }, admin.session);
    await context.route("**/*", (route) =>
      [origin, status.API_URL].includes(new URL(route.request().url()).origin)
        ? route.continue()
        : route.abort(),
    );
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("dialog", (dialog) => void dialog.accept());
    const name = "Synthetic UI room cleanup " + randomUUID().slice(0, 8);
    await page.goto(origin + "/hub/tools/task-templates");
    await page
      .getByRole("heading", { name: "Operational templates", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "New operational draft", exact: true })
      .click();
    await page.locator("#task-template-name").fill(name);
    await page
      .getByRole("checkbox", {
        name: new RegExp(room.published.definition.name),
      })
      .check();
    await page.locator("#task-template-offset").fill("5");
    await page
      .getByRole("checkbox", { name: "Technician", exact: true })
      .check();
    await page
      .getByLabel("Checklist item 1", { exact: true })
      .fill("Synthetic UI SOP check");
    await page
      .locator("#task-template-sop")
      .fill("Synthetic UI reviewed room SOP");
    await page
      .locator("#task-template-review-note")
      .fill("Synthetic UI draft review");
    await page
      .getByRole("button", { name: "Save template draft", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Review " + name, exact: true })
      .waitFor();
    check(
      sql(
        `select count(*) from operational_task_templates t join operational_task_template_versions v on v.id=t.current_version_id where v.definition->>'name'='${name}' and v.state='draft' and t.published_version_id is null;`,
      ),
      "1",
    );
    await page
      .getByRole("button", { name: "Review " + name, exact: true })
      .click();
    check(
      await page
        .getByRole("button", { name: "Publish reviewed template", exact: true })
        .isDisabled(),
      true,
    );
    await page
      .locator("#task-template-review-note")
      .fill("Synthetic exact saved draft attestation");
    await page
      .getByRole("checkbox", { name: /I reviewed this exact saved checklist/ })
      .check();
    let drop = true,
      dropped = false;
    await page.route(
      status.API_URL + "/rest/v1/rpc/execute_operational_review",
      async (route) => {
        const response = await route.fetch();
        if (drop && response.ok()) {
          drop = false;
          await response.body();
          dropped = true;
          await route.abort("failed");
        } else await route.fulfill({ response });
      },
    );
    await page
      .getByRole("button", { name: "Publish reviewed template", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Check saved work", exact: true })
      .waitFor();
    await until(
      () => dropped,
      "publication committed before acknowledgment drop",
    );
    check(await page.locator("#task-template-name").isDisabled(), true);
    const pointer = await page.evaluate(
      () =>
        Object.keys(localStorage)
          .filter((key) => key.startsWith("lrv:operational-reviews:"))
          .flatMap((key) => JSON.parse(localStorage.getItem(key)!))[0],
    );
    check(Object.keys(pointer).sort(), ["actor_id", "id", "operation"]);
    await page.reload();
    await page.getByRole("region", { name: "Operational recovery" }).waitFor();
    await page
      .getByRole("button", { name: "Check saved action", exact: true })
      .click();
    await page.getByText("Template review · Saved", { exact: true }).waitFor();
    const replay = (await rpc(admin, "execute_operational_review", {
      p_actor_id: admin.id,
      p_action_id: pointer.id,
    })) as { version: number };
    check(replay.version, 2);
    check(
      sql(
        `select t.version from operational_task_templates t join operational_task_template_versions v on v.id=t.current_version_id where v.definition->>'name'='${name}';`,
      ),
      "2",
    );
    await page
      .getByRole("button", { name: "Check and release action", exact: true })
      .click();
    await until(
      async () =>
        (await page
          .getByRole("region", { name: "Operational recovery" })
          .count()) === 0,
      "publication recovery released",
    );
    await page
      .getByRole("button", { name: "Review task generation", exact: true })
      .click();
    await page
      .getByRole("checkbox", {
        name: "Generate new operational tasks",
        exact: true,
      })
      .check();
    await page
      .locator("#task-generation-from")
      .fill(
        operationalLocal(new Date(Date.now() - 3600000)).replace(/:00$/, ""),
      );
    await page
      .locator("#task-generation-until")
      .fill(
        operationalLocal(new Date(Date.now() + 86400000)).replace(/:00$/, ""),
      );
    await page
      .locator("#task-generation-note")
      .fill("Synthetic generation reviewed in browser");
    await page
      .getByRole("checkbox", { name: /I reviewed the published checklists/ })
      .check();
    await page
      .getByRole("button", { name: "Save generation review", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Review task generation", exact: true })
      .waitFor();
    check(
      sql(
        "select enabled from operational_task_generation_policy order by version desc limit 1;",
      ),
      "t",
    );
    const at = new Date(Date.now() + 4 * 3600000).toISOString();
    const booked = (await rpc(staff, "save_catalog_appointment", {
      p_actor_id: staff.id,
      p_action_id: randomUUID(),
      p_id: null,
      p_expected_version: null,
      p_values: {
        type_version_id: type.published.id,
        resource_version_id: room.published.id,
        client_id: client,
        pet_id: pet,
        scheduled_at: at,
        duration_minutes: 30,
        status: "SCHEDULED",
        assigned_dvm_id: staff.id,
        visit_type: "clinic",
        address_snapshot: "Synthetic",
        travel_before_minutes: 0,
        travel_after_minutes: 0,
        notes: "Synthetic UI source",
        reminder_offsets: [],
        override_note: "",
      },
    })) as { appointment: { id: string } };
    async function account(a: Actor) {
      await page.evaluate(
        (session) =>
          localStorage.setItem("sb-127-auth-token", JSON.stringify(session)),
        a.session,
      );
      await page.reload();
    }
    await account(tech);
    await page.goto(origin + "/hub/tools/task-templates");
    await page
      .getByRole("heading", { name: "Operational templates", exact: true })
      .waitFor();
    check(
      await page
        .getByRole("button", { name: "New operational draft", exact: true })
        .count(),
      0,
    );
    const day = denverLocal(at).slice(0, 10);
    await page.goto(origin + "/hub/schedule?date=" + day);
    const sourceCard = page.locator(
      `[data-appointment-id="${booked.appointment.id}"]`,
    );
    await sourceCard
      .getByRole("button", { name: "Resource use", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Record actual use", exact: true })
      .click();
    await page.locator("#actual-use-resource").selectOption(room.published.id);
    await page
      .locator("#actual-use-reason")
      .fill("Synthetic technician records actual room use");
    await page
      .getByRole("button", { name: "Save actual use", exact: true })
      .click();
    await page
      .getByRole("button", { name: "End this actual use", exact: true })
      .waitFor();
    check(
      sql(
        `select count(*) from operational_resource_uses where appointment_id='${booked.appointment.id}';`,
      ),
      "1",
    );
    await rpc(staff, "cancel_appointment", {
      p_id: booked.appointment.id,
      p_expected_version: 1,
    });
    await page.reload();
    await sourceCard
      .getByRole("button", { name: "Resource use", exact: true })
      .click();
    await page
      .getByRole("button", { name: "End this actual use", exact: true })
      .click();
    await page
      .locator("#actual-use-reason")
      .fill("Synthetic technician ends use after cancellation");
    await page
      .getByRole("button", { name: "Record actual use ended", exact: true })
      .click();
    await until(
      () =>
        sql(
          `select e.facts->>'state' from operational_resource_uses u join operational_resource_use_events e on e.id=u.head_id where u.appointment_id='${booked.appointment.id}';`,
        ) === "ended",
      "actual-use end committed",
    );
    await page
      .getByRole("button", { name: "Record actual use ended", exact: true })
      .waitFor({ state: "hidden" });
    check(
      sql(
        `select e.facts->>'state' from operational_resource_uses u join operational_resource_use_events e on e.id=u.head_id where u.appointment_id='${booked.appointment.id}';`,
      ),
      "ended",
    );
    await page
      .getByRole("button", { name: "Close resource-use records", exact: true })
      .click();
    await page.goto(origin + "/hub");
    const openName = "Open checklist for " + name;
    await page.getByRole("button", { name: openName, exact: true }).click();
    await page
      .locator("#operational-task-note")
      .fill("Synthetic technician claims cleanup");
    await page
      .getByRole("button", { name: "Claim this task", exact: true })
      .click();
    await page.getByRole("button", { name: openName, exact: true }).waitFor();
    const taskId = sql(
      `select t.id from operational_tasks t join operational_task_enrollments e on e.id=t.enrollment_id where t.use_id in(select id from operational_resource_uses where appointment_id='${booked.appointment.id}') and e.definition->>'name'='${name}';`,
    );
    check(
      sql(
        `select assignee_id from operational_task_revisions r join operational_tasks t on t.head_id=r.id where t.id='${taskId}';`,
      ),
      tech.id,
    );
    await page.getByRole("button", { name: openName, exact: true }).click();
    check(
      await page
        .getByRole("button", {
          name: "Complete reviewed checklist",
          exact: true,
        })
        .isDisabled(),
      true,
    );
    await page
      .getByRole("checkbox", { name: /Synthetic UI SOP check/ })
      .check();
    await page
      .locator("#operational-task-note")
      .fill("Synthetic technician completed mandatory SOP");
    drop = true;
    dropped = false;
    await page
      .getByRole("button", { name: "Complete reviewed checklist", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Check saved work", exact: true })
      .waitFor();
    await until(
      () => dropped,
      "checklist committed before acknowledgment drop",
    );
    check(await page.locator("#operational-task-note").isDisabled(), true);
    check(
      sql(
        `select state from operational_task_revisions r join operational_tasks t on t.head_id=r.id where t.id='${taskId}';`,
      ),
      "completed",
    );
    check(
      await page.evaluate(() =>
        Object.keys(localStorage)
          .filter((key) => key.startsWith("lrv:operational-reviews:"))
          .every((key) =>
            JSON.parse(localStorage.getItem(key)!).every(
              (entry: Record<string, unknown>) =>
                Object.keys(entry).sort().join(",") === "actor_id,id,operation",
            ),
          ),
      ),
      true,
    );
    sql(`update profiles set is_active=false where id='${tech.id}';`);
    await page.reload();
    await page.getByLabel("Email", { exact: true }).waitFor();
    check(
      await page.getByText("Synthetic UI SOP check", { exact: true }).count(),
      0,
    );
    sql(`update profiles set is_active=true where id='${tech.id}';`);
    const fresh = await tech.db.auth.signInWithPassword({
      email: tech.email,
      password: tech.password,
    });
    if (fresh.error) throw fresh.error;
    tech.session = fresh.data.session;
    await account(other);
    await page.goto(origin + "/hub/tasks");
    await page
      .getByRole("heading", { name: "Daily tasks", exact: true })
      .waitFor();
    check(
      await page.getByRole("region", { name: "Operational recovery" }).count(),
      0,
    );
    await account(tech);
    await page.getByRole("region", { name: "Operational recovery" }).waitFor();
    await page
      .getByRole("button", { name: "Check saved action", exact: true })
      .click();
    await page.getByText("Task action · Saved", { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "Check and release action", exact: true })
      .click();
    await until(
      async () =>
        (await page
          .getByRole("region", { name: "Operational recovery" })
          .count()) === 0,
      "completion recovered and released",
    );
    await page.goto(origin + "/hub/tasks?task=" + taskId);
    await page.getByRole("dialog", { name, exact: true }).waitFor();
    await page
      .getByRole("button", { name: "View task history", exact: true })
      .click();
    await page
      .getByRole("region", { name: "Task history" })
      .getByText("Synthetic UI SOP check", { exact: false })
      .first()
      .waitFor();
    check(
      sql(
        `select count(*) from operational_task_revisions where task_id='${taskId}' and state='completed';`,
      ),
      "1",
    );
    await page.setViewportSize({ width: 390, height: 900 });
    await page
      .getByRole("dialog")
      .evaluate((element) =>
        Promise.all(
          element
            .getAnimations()
            .map((animation) => animation.finished.catch(() => undefined)),
        ),
      );
    check(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      true,
    );
    check(
      await page
        .getByRole("button", { name: "Close operational review", exact: true })
        .evaluate((element) => element.getBoundingClientRect().height >= 44),
      true,
    );
    mkdirSync("tmp/operational-tasks-browser", { recursive: true });
    await page.screenshot({
      path: "tmp/operational-tasks-browser/mobile-completed-checklist.png",
    });
    await page
      .getByRole("button", { name: "Close operational review", exact: true })
      .click();
    await page.setViewportSize({ width: 1280, height: 900 });
    await account(admin);
    // Reloading the deep link intentionally reopens its current task.
    await page.getByRole("dialog", { name, exact: true }).waitFor();
    await page
      .getByRole("button", { name: "Close operational review", exact: true })
      .click();
    await page
      .getByRole("link", {
        name: "Review templates and generation.",
        exact: true,
      })
      .click();
    await page
      .getByRole("button", { name: "New operational draft", exact: true })
      .click();
    await page
      .locator("#task-template-name")
      .fill("Synthetic unsaved checklist");
    // The modal hides background navigation; the browser Back control remains available.
    await page.evaluate(() => window.history.back());
    await page
      .getByRole("button", { name: "Keep editing", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Keep editing", exact: true })
      .click();
    check(
      await page.locator("#task-template-name").inputValue(),
      "Synthetic unsaved checklist",
    );
    await page
      .getByRole("button", { name: "Close operational review", exact: true })
      .click();
    check(pageErrors, []);
    await context.close();
    return checks;
  } finally {
    await browser?.close();
    vite.kill("SIGTERM");
  }
}
