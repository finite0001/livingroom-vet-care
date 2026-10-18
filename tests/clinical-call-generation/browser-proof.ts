/** Actual Patient 360 + owned Auth/PostgREST; only OpenAI transport is synthetic. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { closeSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { chromium, type Browser } from "playwright";
import type { Session } from "@supabase/supabase-js";

interface CallNoteBrowserOptions {
  status: { API_URL: string; ANON_KEY: string };
  session: Session;
  staffSession: Session;
  petId: string;
  encounterId: string;
  sourceId: string;
  bridgeUrl: string;
  evidenceBase: string;
  sql?: (query: string) => string;
}
async function until(test: () => boolean | Promise<boolean>, label: string) {
  for (let n = 0; n < 800; n++) {
    if (await test()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw Error("Did not observe " + label);
}
export async function proveCallNoteBrowser(options: CallNoteBrowserOptions) {
  const { status, session, petId, encounterId, sourceId, bridgeUrl, evidenceBase } = options;
  assert.equal(new URL(status.API_URL).hostname, "127.0.0.1");
  assert.equal(new URL(bridgeUrl).hostname, "127.0.0.1");
  assert.match(evidenceBase, /^tmp\/clinical-calls-[a-z0-9-]+$/);
  const directory = evidenceBase + "-browser", origin = "http://127.0.0.1:65531";
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const viteLog = openSync(`${directory}/vite.log`, "wx", 0o600);
  const vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "65531", "--strictPort"], {
    env: { ...process.env, VITE_SUPABASE_URL: status.API_URL, VITE_SUPABASE_PUBLISHABLE_KEY: status.ANON_KEY }, stdio: ["ignore", viteLog, viteLog],
  });
  closeSync(viteLog);
  let browser: Browser | null = null, checks = 0, droppedReserve = false, droppedGenerate = false, droppedReview = false;
  const check = (actual: unknown, expected: unknown) => { assert.deepEqual(actual, expected); checks++; };
  const failures: string[] = [];
  const url = origin + "/hub/patient/" + petId + "?tab=medical&section=soap";
  try {
    await until(async () => { assert.equal(vite.exitCode, null); try { return (await fetch(origin)).ok; } catch { return false; } }, "owned browser server");
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    await context.route("**/*", (route) => [origin, status.API_URL].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
    await context.addInitScript((value) => {
      if (!localStorage.getItem("synthetic:call-generation-bootstrap")) {
        localStorage.setItem("sb-127-auth-token", JSON.stringify(value));
        localStorage.setItem("synthetic:call-generation-bootstrap", "true");
      }
    }, session);
    const page = await context.newPage();page.setDefaultTimeout(60000);page.setDefaultNavigationTimeout(90000);
    page.on("pageerror", (error) => failures.push(error.message));
    let privateReads = 0;
    page.on("request", (request) => { if (/\/rpc\/.*clinical_call/.test(request.url())) privateReads++; });
    await page.route("**/rest/v1/rpc/reserve_clinical_call_note_v1", async (route) => {
      const response = await route.fetch();
      if (!droppedReserve && response.ok()) { droppedReserve = true; await route.abort("failed"); }
      else await route.fulfill({ response });
    });
    await page.route("**/functions/v1/clinical-call-note-process", async (route) => {
      const request = route.request();
      const response = await fetch(bridgeUrl, { method: request.method(), headers: request.headers(), body: request.postData() });
      const body = await response.text();
      if (!droppedGenerate && response.ok && JSON.parse(body).proposal) { droppedGenerate = true; await route.abort("failed"); }
      else await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body });
    });
    await page.route("**/rest/v1/rpc/save_clinical_call_note_review_v1", async (route) => {
      const response = await route.fetch();
      if (!droppedReview && response.ok()) { droppedReview = true; await route.abort("failed"); }
      else await route.fulfill({ response });
    });
    async function openEncounter() {
      const workspace = page.getByRole("region", { name: "Clinical records", exact: true });
      await workspace.getByRole("button", { name: / · clinic · draft$/ }).first().click();
      await workspace.getByRole("button", { name: "Review household call sources", exact: true }).click();
      const panel = page.getByRole("region", { name: "Patient-linked call sources", exact: true });
      await until(async () => !(await panel.getByText("Loading authorized call sources…", { exact: true }).isVisible()), "private source settings");
      return panel;
    }
    async function openSource() {
      const panel = await openEncounter();
      const note = panel.getByRole("region", { name: "Private call generation and review", exact: true });
      if (!(await note.isVisible())) await panel.getByRole("button", { name: /^Review call ended / }).first().click();
      await note.waitFor();
      await until(async () => !(await note.getByText("Loading private call drafting settings…", { exact: true }).isVisible()), "private draft settings");
      return note;
    }
    async function reload() {
      page.once("dialog", (dialog) => dialog.accept());
      await page.reload({ waitUntil: "domcontentloaded" });
      return openSource();
    }
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.getByRole("region", { name: "Clinical records", exact: true }).waitFor();
    check(privateReads, 0);
    let note = await openSource();
    const template = note.getByLabel("Approved call drafting template", { exact: true });
    const chosen = await template.locator("option").nth(1).getAttribute("value");assert.ok(chosen);
    await template.selectOption(chosen);
    await note.getByRole("checkbox", { name: /^I confirm this exact call/ }).check();
    await page.getByRole("button", { name: "Schedule", exact: true }).first().click();
    const leave = page.getByRole("alertdialog", { name: "Leave with unsaved changes?", exact: true });
    await leave.waitFor();await leave.getByRole("button", { name: "Keep editing", exact: true }).click();
    check(new URL(page.url()).pathname, "/hub/patient/" + petId);
    await note.getByRole("button", { name: "Pin private call draft source", exact: true }).click();
    await until(() => droppedReserve, "committed reservation ACK loss");
    await note.getByRole("region", { name: "Unconfirmed private call draft action", exact: true }).waitFor();
    let recovery = await page.evaluate(() => Object.fromEntries(Object.entries(sessionStorage).filter(([key]) => key.startsWith("lrv:call-note:"))));
    check(Object.keys(recovery).length, 1);
    check(JSON.parse(Object.values(recovery)[0]).source, sourceId);
    check(JSON.stringify(recovery).includes("historical vomiting"), false);
    note = await reload();
    await note.getByRole("button", { name: "Recover original call draft action", exact: true }).click();
    await note.getByRole("region", { name: "Selected private call drafting job", exact: true }).waitFor();
    await note.getByRole("checkbox", { name: /^I authorize this explicit AI request/ }).check();
    await note.getByRole("button", { name: "Generate private call draft", exact: true }).click();
    await until(() => droppedGenerate, "committed generation ACK loss");
    await note.getByRole("region", { name: "Unconfirmed private call draft action", exact: true }).waitFor();
    note = await reload();
    await note.getByRole("button", { name: "Recover original call draft action", exact: true }).click();
    let review = note.getByRole("region", { name: "Private call draft review", exact: true });await review.waitFor();
    const claims = review.getByRole("region", { name: "Private call claim evidence", exact: true });
    await claims.locator("summary").first().click();
    check((await claims.locator("blockquote").first().textContent())!.includes("historical vomiting"), true);
    check((await claims.textContent())!.includes("original speaker owner"), true);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await review.getByRole("heading", { name: "Review private call draft", exact: true }).scrollIntoViewIfNeeded();
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: `${directory}/review-${width}.png`, fullPage: false });
      await claims.locator("blockquote").first().scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${directory}/evidence-${width}.png`, fullPage: false });
    }
    const edited = "Reviewed owner report: historical vomiting; vaccine was declined.";
    await review.getByRole("checkbox", { name: "Accept subjective", exact: true }).check();
    await review.getByLabel("subjective reviewed wording", { exact: true }).fill(edited);
    await review.getByRole("checkbox", { name: /^I reviewed patient attribution/ }).check();
    await review.getByRole("button", { name: "Accept selected call sections into saved draft", exact: true }).click();
    await until(() => droppedReview, "committed review ACK loss");
    await note.getByRole("region", { name: "Unconfirmed private call draft action", exact: true }).waitFor();
    recovery = await page.evaluate(() => Object.fromEntries(Object.entries(sessionStorage).filter(([key]) => key.startsWith("lrv:call-note:"))));
    check(Object.keys(JSON.parse(Object.values(recovery)[0])).sort(), ["actor", "encounter", "id", "job", "kind", "pet", "source"]);
    check(JSON.stringify(recovery).includes(edited), false);
    note = await reload();
    await note.getByRole("button", { name: "Recover original call draft action", exact: true }).click();
    await note.getByRole("region", { name: "Saved call draft decision", exact: true }).waitFor();
    check((await note.getByRole("region", { name: "Saved call draft decision", exact: true }).textContent())!.includes("accepted"), true);
    check(await note.getByLabel("subjective reviewed wording", { exact: true }).inputValue(), edited);
    check(await page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.startsWith("lrv:call-note:")).length), 0);
    // A new job uses the new saved encounter version, then rejection leaves all chart sections intact.
    await page.setViewportSize({ width: 1280, height: 1000 });
    await note.getByLabel("Approved call drafting template", { exact: true }).selectOption(chosen);
    await note.getByRole("checkbox", { name: /^I confirm this exact call/ }).check();
    await note.getByRole("button", { name: "Pin private call draft source", exact: true }).click();
    await until(async () => await note.getByRole("button", { name: "Generate private call draft", exact: true }).isVisible(), "second job reservation");
    await note.getByRole("checkbox", { name: /^I authorize this explicit AI request/ }).check();
    await note.getByRole("button", { name: "Generate private call draft", exact: true }).click();
    review = note.getByRole("region", { name: "Private call draft review", exact: true });await review.waitFor();
    await review.getByLabel("Call draft review note (required for rejection)", { exact: true }).fill("Synthetic rejection: no additional chart wording needed.");
    await review.getByRole("checkbox", { name: /^I reviewed patient attribution/ }).check();
    await review.getByRole("button", { name: "Reject private call draft", exact: true }).click();
    await until(async () => (await note.getByRole("region", { name: "Saved call draft decision", exact: true }).textContent())!.includes("rejected"), "saved rejection");
    if (options.sql) {
      assert.match(session.user.id, /^[a-f0-9-]{36}$/);
      try {
        options.sql("delete from user_roles where user_id='" + session.user.id + "'and role='ADMIN';");
        await page.evaluate(async () => {
          const modulePath = "/src/integrations/supabase/client.ts";
          const module = await import(modulePath);
          const { error } = await module.supabase.auth.refreshSession();
          if (error) throw error;
        });
        await until(async () => !(await note.isVisible()), "same-user role revalidation removing private state");
        check(await page.getByRole("region", { name: "Frozen call transcript", exact: true }).count(), 0);
        check(await page.getByRole("region", { name: "Private call draft review", exact: true }).count(), 0);
      } finally {
        options.sql("insert into user_roles(user_id,role)values('" + session.user.id + "','ADMIN')on conflict do nothing;");
      }
    }
    check(failures, []);
    await context.close();
    const staff = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await staff.route("**/*", (route) => [origin, status.API_URL].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
    await staff.addInitScript((value) => localStorage.setItem("sb-127-auth-token", JSON.stringify(value)), options.staffSession);
    const staffPage = await staff.newPage();staffPage.setDefaultTimeout(60000);
    let staffPrivate = 0;
    staffPage.on("request", (request) => { if (/\/rpc\/.*clinical_call/.test(request.url())) staffPrivate++; });
    await staffPage.goto(url, { waitUntil: "domcontentloaded" });
    await staffPage.getByRole("region", { name: "Clinical records", exact: true }).getByRole("button", { name: / · clinic · draft$/ }).first().click();
    await staffPage.getByRole("heading", { name: "Edit draft encounter", exact: true }).waitFor();
    check(await staffPage.getByRole("region", { name: "Private call draft review", exact: true }).count(), 0);
    check(await staffPage.getByRole("button", { name: "Review household call sources", exact: true }).count(), 0);
    check(staffPrivate, 0);
    check(await staffPage.getByLabel("Subjective", { exact: true }).inputValue(), edited);
    await staff.close();
    return { assertions: checks, droppedCommittedAcknowledgements: 3, desktopWidth: 1280, mobileChromiumWidth: 390, realProviderRequests: 0, staffPrivateRequests: staffPrivate, acceptedThenRejected: true };
  } catch (failure) {
    const page = browser?.contexts()[0]?.pages()[0];
    if (page) {
      await page.screenshot({ path: `${directory}/failure.png`, fullPage: false }).catch(() => {});
      writeFileSync(`${directory}/failure.html`, await page.content().catch(() => "Unavailable"), { mode: 0o600 });
    }
    throw failure;
  } finally {
    if (browser) { for (const context of browser.contexts()) await context.unrouteAll({ behavior: "ignoreErrors" });await browser.close(); }
    if (vite.exitCode === null) { const stopped = once(vite, "exit");vite.kill("SIGTERM");await stopped; }
  }
}
