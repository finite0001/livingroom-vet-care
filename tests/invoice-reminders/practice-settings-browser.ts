/** Real no-invoice Settings workflow. One committed HTTP response is deliberately dropped. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { chromium, type Page } from "playwright";
import {
  defaultPolicy,
  practicePolicySchema,
} from "../../src/hub/features/billing/reminders/model.ts";
interface PracticeBrowserConfig {
  apiUrl: string;
  anonKey: string;
  actorId: string;
  session: Session;
  db: SupabaseClient;
}
export async function provePracticeSettings(config: PracticeBrowserConfig) {
  assert.equal(new URL(config.apiUrl).origin, "http://127.0.0.1:64721");
  const origin = "http://127.0.0.1:64781";
  const vite = spawn(
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
        VITE_SUPABASE_URL: config.apiUrl,
        VITE_SUPABASE_PUBLISHABLE_KEY: config.anonKey,
      },
      stdio: "ignore",
    },
  );
  const exited = new Promise<void>((resolve) =>
    vite.once("exit", () => resolve()),
  );
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  let debugPage: Page | null = null;
  let checks = 0,
    committedSaveRequests = 0,
    dropSaves = true;
  let droppedId = "";
  const errors: string[] = [];
  try {
    let ready = false;
    for (let i = 0; i < 200; i++) {
      try {
        ready = (await fetch(origin)).ok;
      } catch {
        /* Owned startup only. */
      }
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.ok(ready, "Owned practice settings server did not start");
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 1000 },
    });
    await context.addInitScript((session) => {
      if (!localStorage.getItem("synthetic:practice-bootstrap")) {
        localStorage.setItem("sb-127-auth-token", JSON.stringify(session));
        localStorage.setItem("synthetic:practice-bootstrap", "true");
      }
    }, config.session);
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (![origin, config.apiUrl].includes(url.origin)) return route.abort();
      if (url.pathname === "/rest/v1/rpc/save_invoice_reminder_policy") {
        const args = route.request().postDataJSON();
        if (dropSaves) {
          if (!droppedId) {
            droppedId = args.p_id;
            const actual = await route.fetch();
            assert.equal(actual.status(), 200);
            committedSaveRequests++;
          } else assert.equal(args.p_id, droppedId);
          return route.abort("failed");
        }
        committedSaveRequests++;
      }
      return route.continue();
    });
    const page = await context.newPage();
    debugPage = page;
    page.setDefaultTimeout(20000);
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (message) => {
      if (/only supports one blocker/i.test(message.text()))
        errors.push(message.text());
    });
    await page.goto(origin + "/hub/settings");
    const panel = page.getByRole("region", {
      name: "Practice unpaid invoice reminders",
      exact: true,
    });
    const days = panel.getByLabel("Reminder days after due date", {
      exact: true,
    });
    await panel
      .getByText("No practice policy has been saved.", { exact: false })
      .waitFor();
    assert.equal(await days.inputValue(), "7, 14, 30");
    assert.equal(
      await panel
        .getByLabel("Default days until due (0 = due on receipt)", {
          exact: true,
        })
        .inputValue(),
      "0",
    );
    checks++;
    await days.fill("14, 30");
    await page.getByRole("button", { name: "Clients", exact: true }).click();
    await page
      .getByRole("button", { name: "Keep editing", exact: true })
      .click();
    assert.equal(await days.inputValue(), "14, 30");
    checks++;
    await days.fill("7, 7");
    await panel
      .getByRole("button", {
        name: "Save practice reminder policy",
        exact: true,
      })
      .click();
    await panel.getByRole("alert").filter({ hasText: "ascending" }).waitFor();
    assert.equal(committedSaveRequests, 0);
    checks++;
    await days.fill("7, 14, 30");
    await panel
      .getByLabel("Practice payment/contact instructions", { exact: true })
      .fill("synthetic-policy@example.test");
    await panel
      .getByRole("button", {
        name: "Save practice reminder policy",
        exact: true,
      })
      .click();
    await panel
      .getByText("The save is unconfirmed.", { exact: false })
      .waitFor();
    assert.equal(committedSaveRequests, 1);
    assert.ok(droppedId);
    checks++;
    dropSaves = false;
    await panel
      .getByRole("button", { name: "Recover reminder save", exact: true })
      .click();
    await panel
      .getByText("Practice reminder policy saved.", { exact: true })
      .waitFor();
    assert.equal(committedSaveRequests, 1);
    checks++;
    const saved = await config.db.rpc("read_invoice_reminder_practice", {
      p_actor_id: config.actorId,
    });
    if (saved.error) throw saved.error;
    const value = practicePolicySchema.parse(saved.data);
    assert.equal(value.policy?.id, droppedId);
    assert.equal(value.policy?.version, 1);
    checks++;
    await page.reload();
    await panel.getByText("Saved policy version 1", { exact: false }).waitFor();
    assert.equal(
      await panel
        .getByLabel("Practice payment/contact instructions", { exact: true })
        .inputValue(),
      "synthetic-policy@example.test",
    );
    checks++;
    // A real competing ADMIN RPC changes the policy after this editor loaded it.
    const competing = await config.db.rpc("save_invoice_reminder_policy", {
      p_actor_id: config.actorId,
      p_id: randomUUID(),
      p_expected_version: 1,
      p_definition: {
        ...defaultPolicy,
        practice_contact: "concurrent-policy@example.test",
      },
    });
    if (competing.error) throw competing.error;
    await panel
      .getByLabel("Email subject", { exact: true })
      .fill("Synthetic stale draft {{invoice_reference}}");
    await panel
      .getByRole("button", {
        name: "Save practice reminder policy",
        exact: true,
      })
      .click();
    await panel
      .getByRole("alert")
      .filter({ hasText: "settings changed" })
      .waitFor();
    assert.equal(
      await panel.getByLabel("Email subject", { exact: true }).inputValue(),
      "Synthetic stale draft {{invoice_reference}}",
    );
    checks++;
    await panel
      .getByRole("button", {
        name: "Discard edits and reload saved policy",
        exact: true,
      })
      .click();
    await panel.getByText("Saved policy version 2", { exact: false }).waitFor();
    assert.equal(
      await panel
        .getByLabel("Practice payment/contact instructions", { exact: true })
        .inputValue(),
      "concurrent-policy@example.test",
    );
    checks++;
    mkdirSync("tmp/invoice-reminder-browser", { recursive: true });
    await panel.screenshot({
      path: "tmp/invoice-reminder-browser/practice-desktop.png",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await panel.scrollIntoViewIfNeeded();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    );
    checks++;
    await panel.screenshot({
      path: "tmp/invoice-reminder-browser/practice-mobile.png",
    });
    // A clean reminder editor must not override the existing return-policy guard.
    // This is an unsaved UI draft only; no clinical policy is reviewed or saved.
    await page.setViewportSize({ width: 1280, height: 1000 });
    const returns = page.getByRole("region", {
      name: "Native return policy",
      exact: true,
    });
    await returns
      .getByLabel("Policy review reference", { exact: true })
      .fill("Synthetic unsaved return review");
    await page.getByRole("button", { name: "Clients", exact: true }).click();
    await page
      .getByRole("button", { name: "Keep editing", exact: true })
      .click();
    assert.equal(
      await returns
        .getByLabel("Policy review reference", { exact: true })
        .inputValue(),
      "Synthetic unsaved return review",
    );
    checks++;
    await page.getByRole("button", { name: "Clients", exact: true }).click();
    await page
      .getByRole("button", { name: "Discard and leave", exact: true })
      .click();
    await page.getByRole("heading", { name: "Clients", exact: true }).waitFor();
    checks++;
    assert.deepEqual(errors, []);
    checks++;
    await context.close();
    return {
      browserChecks: checks,
      policyVersion: 2,
      lostAckRecoveredWithoutNewWrite: true,
      staleSaveRejected: true,
      existingReturnPolicyGuardPreserved: true,
      providerRequests: 0,
    };
  } catch (failure) {
    if (debugPage) {
      mkdirSync("tmp/invoice-reminder-browser", { recursive: true });
      writeFileSync(
        "tmp/invoice-reminder-browser/practice-failure.txt",
        JSON.stringify(
          {
            url: debugPage.url(),
            body: await debugPage.locator("body").innerText(),
            nativeRegionCount: await debugPage
              .getByRole("region", {
                name: "Native return policy",
                exact: true,
                includeHidden: true,
              })
              .count(),
            nativeAncestors: await debugPage
              .locator('section[aria-label="Native return policy"]')
              .evaluate((el) => {
                const result = [];
                for (
                  let node: Element | null = el;
                  node;
                  node = node.parentElement
                )
                  result.push({
                    tag: node.tagName,
                    role: node.getAttribute("role"),
                    ariaLabel: node.getAttribute("aria-label"),
                    hidden: node.getAttribute("aria-hidden"),
                    inert: node.hasAttribute("inert"),
                    dataHidden: node.getAttribute("data-aria-hidden"),
                  });
                return result;
              }),
            errors,
          },
          null,
          2,
        ),
      );
      await debugPage.screenshot({
        path: "tmp/invoice-reminder-browser/practice-failure.png",
        fullPage: true,
      });
    }
    throw failure;
  } finally {
    if (browser) await browser.close();
    if (vite.exitCode === null && vite.signalCode === null)
      vite.kill("SIGTERM");
    await exited;
  }
}
