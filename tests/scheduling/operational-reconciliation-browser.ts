/** Genuine reviewer workflow against owned Auth/PostgREST; no provider traffic. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import type { SupabaseClient } from "@supabase/supabase-js";

interface BrowserInput {
  status: { API_URL: string; ANON_KEY: string };
  admin: { id: string; db: SupabaseClient };
  staff: { id: string; db: SupabaseClient };
  service: SupabaseClient;
  sql: (query: string) => string;
}
export async function reconciliationBrowserProof(
  { status, admin, staff, service, sql }: BrowserInput,
) {
  const origin = "http://127.0.0.1:47281";
  let checks = 0;
  function check(actual: unknown, expected: unknown) {
    assert.deepEqual(actual, expected);
    checks++;
  }
  const vite = spawn(process.execPath, [
    "node_modules/vite/bin/vite.js",
    "--host",
    "127.0.0.1",
    "--port",
    "47281",
    "--strictPort",
  ], {
    cwd: process.cwd(),
    stdio: "ignore",
    env: {
      ...process.env,
      VITE_SUPABASE_URL: status.API_URL,
      VITE_SUPABASE_PUBLISHABLE_KEY: status.ANON_KEY,
    },
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  async function session(db: SupabaseClient) {
    const { data, error } = await db.auth.getSession();
    if (error) throw error;
    assert.ok(data.session);
    return data.session;
  }
  try {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (vite.exitCode !== null) throw new Error("Owned reviewer app exited");
      try {
        if ((await fetch(origin)).ok) break;
      } catch { /* own startup */ }
      if (attempt === 399) throw new Error("Owned reviewer app not ready");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    await context.addInitScript((value) => {
      if (!localStorage.getItem("synthetic:reconciliation-boot")) {
        localStorage.setItem("sb-127-auth-token", JSON.stringify(value));
        localStorage.setItem("synthetic:reconciliation-boot", "true");
      }
    }, await session(admin.db));
    await context.route(
      "**/*",
      (route) =>
        [origin, status.API_URL].includes(new URL(route.request().url()).origin)
          ? route.continue()
          : route.abort(),
    );
    const page = await context.newPage(), errors: string[] = [];
    page.setDefaultTimeout(30000);
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("dialog", (dialog) => void dialog.accept());
    await page.goto(origin + "/hub/admin/operations");
    const panel = page.getByRole("region", {
      name: "Operational reconciliation",
      exact: true,
    });
    await panel.getByText("Reconciliation policy enabled", { exact: false })
      .waitFor();
    await panel.getByText(
      "Timetable: inactive · every 5 minutes when active.",
      { exact: true },
    ).waitFor();
    checks++;
    await panel.getByText("Committed task check", { exact: true }).first()
      .waitFor();
    checks++;
    await panel.getByText("Committed counts unknown.", { exact: true }).first()
      .waitFor();
    checks++;
    await panel.getByText("No checkpoint advancement established.", {
      exact: true,
    }).first().waitFor();
    checks++;
    for (let index = 0; index < 26; index++) {
      const args = { p_run_id: randomUUID(), p_limit: 1 };
      const start = await service.rpc(
        "start_operational_reconciliation_run",
        args,
      );
      if (start.error) throw start.error;
      const result = await service.rpc(
        "execute_operational_reconciliation_run",
        args,
      );
      if (result.error) throw result.error;
    }
    await panel.getByRole("button", {
      name: "Refresh reconciliation",
      exact: true,
    }).click();
    await panel.getByRole("button", {
      name: "Next reconciliation page",
      exact: true,
    }).waitFor();
    await panel.getByRole("button", {
      name: "Next reconciliation page",
      exact: true,
    }).click();
    await panel.getByText("Committed counts unknown.", { exact: true }).first()
      .waitFor();
    checks++;
    check(
      await panel.getByRole("listitem").count(),
      Math.min(
        25,
        Number(sql("select count(*)from operational_reconciliation_runs;")) -
          25,
      ),
    );
    await panel.getByRole("button", {
      name: "First reconciliation page",
      exact: true,
    }).click();
    await panel.getByRole("button", {
      name: "Review task reconciliation",
      exact: true,
    }).click();
    await page.locator("#reconciliation-note").fill(
      "Synthetic interrupted policy review",
    );
    await page.getByRole("checkbox", {
      name: "Reconcile operational tasks",
      exact: true,
    }).uncheck();
    await page.getByRole("checkbox", {
      name: /I reviewed the appointment window/,
    }).check();
    let dropped = false, executionRequests = 0;
    await page.route(
      status.API_URL + "/rest/v1/rpc/execute_operational_review",
      async (route) => {
        executionRequests++;
        const response = await route.fetch();
        if (!dropped && response.ok()) {
          await response.body();
          dropped = true;
          await route.abort("failed");
        } else await route.fulfill({ response });
      },
    );
    await page.getByRole("button", {
      name: "Save reconciliation review",
      exact: true,
    }).click();
    await page.getByRole("button", { name: "Check saved work", exact: true })
      .waitFor();
    check(dropped, true);
    check(await page.locator("#reconciliation-note").isDisabled(), true);
    const pointer = await page.evaluate(() =>
      Object.keys(localStorage).filter((key) =>
        key.startsWith("lrv:operational-reviews:")
      ).flatMap((key) => JSON.parse(localStorage.getItem(key)!))[0]
    );
    check(Object.keys(pointer).sort(), ["actor_id", "id", "operation"]);
    check(pointer.operation, "reconciliation_policy");
    check(
      sql(
        `select count(*)from operational_task_actions where id='${pointer.id}';`,
      ),
      "1",
    );
    await page.reload();
    await page.getByRole("region", {
      name: "Operational recovery",
      exact: true,
    }).waitFor();
    await page.getByRole("button", { name: "Check saved action", exact: true })
      .click();
    await page.getByText("Reconciliation review · Saved", { exact: true })
      .waitFor();
    check(executionRequests, 1);
    await page.getByRole("button", {
      name: "Check and release action",
      exact: true,
    }).click();
    await page.getByRole("region", {
      name: "Operational recovery",
      exact: true,
    }).waitFor({ state: "detached" });
    check(
      sql(
        "select enabled from operational_reconciliation_policy order by version desc limit 1;",
      ),
      "f",
    );
    await panel.getByRole("button", {
      name: "Review task reconciliation",
      exact: true,
    }).click();
    await page.getByRole("checkbox", {
      name: "Reconcile operational tasks",
      exact: true,
    }).check();
    await page.locator("#reconciliation-from").fill("2026-10-14T09:00");
    await page.locator("#reconciliation-until").fill("2026-11-15T09:00");
    await page.locator("#reconciliation-note").fill(
      "Synthetic over-limit window",
    );
    await page.getByRole("checkbox", {
      name: /I reviewed the appointment window/,
    }).check();
    const beforeActions = sql(
      "select count(*) from operational_task_actions where operation='reconciliation_policy';",
    );
    await page.getByRole("button", {
      name: "Save reconciliation review",
      exact: true,
    }).click();
    await page.getByRole("alert").filter({
      hasText: "Complete the required fields",
    }).waitFor();
    check(
      sql(
        "select count(*) from operational_task_actions where operation='reconciliation_policy';",
      ),
      beforeActions,
    );
    await page.locator("#reconciliation-from").fill("2026-03-08T02:30");
    await page.locator("#reconciliation-until").fill("2026-03-08T03:30");
    await page.getByRole("checkbox", {
      name: /I reviewed the appointment window/,
    }).check();
    await page.getByRole("button", {
      name: "Save reconciliation review",
      exact: true,
    }).click();
    await page.getByRole("alert").filter({
      hasText: "This local time does not exist",
    }).waitFor();
    checks++;
    await page.locator("#reconciliation-from").fill("2026-11-01T01:30");
    await page.locator("#reconciliation-until").fill("2026-11-01T02:30");
    await page.getByRole("checkbox", {
      name: /I reviewed the appointment window/,
    }).check();
    await page.getByRole("button", {
      name: "Save reconciliation review",
      exact: true,
    }).click();
    await page.getByRole("alert").filter({ hasText: "This hour occurs twice" })
      .waitFor();
    checks++;
    await page.locator("#reconciliation-dst").selectOption("earlier");
    await page.locator("#reconciliation-note").fill(
      "Synthetic explicit repeated-hour review",
    );
    await page.getByRole("checkbox", {
      name: /I reviewed the appointment window/,
    }).check();
    await page.getByRole("button", {
      name: "Save reconciliation review",
      exact: true,
    }).click();
    await page.getByRole("dialog").waitFor({ state: "detached" });
    check(
      sql(
        "select window_from at time zone 'UTC' from operational_reconciliation_policy order by version desc limit 1;",
      ),
      "2026-11-01 07:30:00",
    );
    await page.setViewportSize({ width: 375, height: 812 });
    await page.getByRole("navigation", {
      name: "Operations workflows",
      exact: true,
    }).getByRole("link", { name: "Operational templates", exact: true })
      .click();
    await page.getByRole("heading", { name: "Operational templates", exact: true }).waitFor();
    await page.getByRole("heading", {
      name: "Operational reconciliation",
      exact: true,
    }).waitFor();
    await panel.getByRole("button", {
      name: "Review task reconciliation",
      exact: true,
    }).click();
    await page.locator("#reconciliation-note").fill(
      "Synthetic dirty draft for close and back guards",
    );
    await page.locator("#reconciliation-note").blur();
    await page.evaluate(() =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
    );
    check(
      await page.evaluate(() =>
        document.documentElement.scrollWidth <= window.innerWidth
      ),
      true,
    );
    mkdirSync("tmp/reconciliation-browser", { recursive: true });
    await page.screenshot({
      path: "tmp/reconciliation-browser/mobile-review.png",
      fullPage: true,
    });
    await page.evaluate(() => window.history.back());
    await page.getByRole("button", { name: "Keep editing", exact: true })
      .waitFor();
    await page.getByRole("button", { name: "Keep editing", exact: true })
      .click();
    check(
      await page.locator("#reconciliation-note").inputValue(),
      "Synthetic dirty draft for close and back guards",
    );
    await page.getByRole("button", {
      name: "Close operational review",
      exact: true,
    }).click();
    await page.evaluate(
      (value) =>
        localStorage.setItem("sb-127-auth-token", JSON.stringify(value)),
      await session(staff.db),
    );
    await page.reload();
    await page.getByRole("heading", {
      name: "Operational templates",
      exact: true,
    }).waitFor();
    check(
      await page.getByRole("button", {
        name: "Review task reconciliation",
        exact: true,
      }).count(),
      0,
    );
    check(errors, []);
    await context.close();
    return {
      browser_checks: checks,
      genuine_staff_api: true,
      committed_ack_loss_recovered: true,
      dst_and_window_review: true,
      mobile_overflow_checked: true,
      dirty_navigation_guard: true,
      provider_requests: 0,
    };
  } finally {
    await browser?.close();
    vite.kill("SIGTERM");
  }
}
