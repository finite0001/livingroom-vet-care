/** Real local Patient 360 + authenticated RPCs. Only the external provider is synthetic. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium, type Browser } from "playwright";
import type { Session } from "@supabase/supabase-js";
interface CallBrowserProofOptions {
  status: { API_URL: string; ANON_KEY: string };
  session: Session;
  petId: string;
  encounterId: string;
  bridgeUrl: string;
  evidenceBase: string;
  expectedTranscriptText?: string;
  expectedSegmentCount?: number;
  staffSession?: Session;
}
async function until(condition: () => boolean | Promise<boolean>, label: string) {
  for (let i = 0; i < 600; i++) { if (await condition()) return; await new Promise((resolve) => setTimeout(resolve, 25)); }
  throw Error("Did not observe " + label);
}
export async function proveClinicalCallBrowser(options: CallBrowserProofOptions) {
  const { status, session, petId, encounterId, bridgeUrl, evidenceBase } = options;
  assert.equal(new URL(status.API_URL).hostname, "127.0.0.1");
  assert.equal(new URL(bridgeUrl).hostname, "127.0.0.1");
  assert.match(evidenceBase, /^tmp\/[a-z0-9][a-z0-9-]{0,79}$/);
  const directory = `${evidenceBase}-browser`, origin = "http://127.0.0.1:65381";
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  let checks = 0, browser: Browser | null = null;
  const check = (actual: unknown, expected: unknown) => { assert.deepEqual(actual, expected); checks++; };
  const vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "65381", "--strictPort"], { env: { ...process.env, VITE_SUPABASE_URL: status.API_URL, VITE_SUPABASE_PUBLISHABLE_KEY: status.ANON_KEY }, stdio: "ignore" });
  try {
    await until(async () => { assert.equal(vite.exitCode, null, "Owned browser server exited."); try { return (await fetch(origin)).ok; } catch { return false; } }, "owned call browser server");
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    await context.route("**/*", (route) => [origin, status.API_URL].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
    await context.addInitScript((value) => { if (!localStorage.getItem("synthetic:call-bootstrap")) { localStorage.setItem("sb-127-auth-token", JSON.stringify(value)); localStorage.setItem("synthetic:call-bootstrap", "true"); } }, session);
    const page = await context.newPage(); page.setDefaultTimeout(60000); page.setDefaultNavigationTimeout(90000);
    const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
    let privateCallRequests = 0, remoteCancellationRequests = 0;
    page.on("request", (request) => { if (request.url().includes("/rpc/") && /clinical_call/.test(request.url())) privateCallRequests++; if (/\/rpc\/cancel_clinical_call_/.test(request.url())) remoteCancellationRequests++; });
    let lostReservation = false, lostCapture = false, lostPolicy = false, captureId: string | null = null, sourceId: string | null = null;
    await page.route("**/rest/v1/rpc/reserve_clinical_call_capture", async (route) => {
      const response = await route.fetch();
      if (!lostReservation && response.ok()) { lostReservation = true; captureId = route.request().postDataJSON().p_id; await route.abort("failed"); }
      else await route.fulfill({ response });
    });
    await page.route("**/functions/v1/clinical-call-capture", async (route) => {
      const request = route.request();
      const response = await fetch(bridgeUrl, { method: request.method(), headers: request.headers(), body: request.postData() });
      const body = await response.text();
      if (!lostCapture && response.ok && JSON.parse(body).source) { lostCapture = true; sourceId = JSON.parse(body).source.id; await route.abort("failed"); }
      else await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body });
    });
    async function openEncounter() {
      const workspace = page.getByRole("region", { name: "Clinical records", exact: true });
      const beforePrivateReads = privateCallRequests;
      await workspace.getByRole("button", { name: / · clinic · draft$/ }).first().click();
      await workspace.getByRole("button", { name: "Review household call sources", exact: true }).waitFor();
      check(privateCallRequests, beforePrivateReads);
      await workspace.getByRole("button", { name: "Review household call sources", exact: true }).click();
      const panel = page.getByRole("region", { name: "Patient-linked call sources", exact: true });
      await panel.getByRole("region", { name: "Explicit call destination", exact: true }).waitFor();
      await until(async () => !(await panel.getByText("Loading authorized call sources…", { exact: true }).isVisible()), "call source candidate loading");
      check((await panel.getByRole("region", { name: "Explicit call destination", exact: true }).textContent())!.includes(encounterId), true);
      return panel;
    }
    const url = origin + "/hub/patient/" + petId + "?tab=medical&section=soap";
    await page.goto(url, { waitUntil: "domcontentloaded" });
    let panel = await openEncounter();
    const choice = panel.getByLabel("Assigned completed household call", { exact: true });
    check(await choice.inputValue(), "");
    check(await panel.getByRole("button", { name: "Reserve selected household call", exact: true }).isEnabled(), false);
    const candidate = await choice.locator("option").nth(1).getAttribute("value"); assert.ok(candidate);
    await choice.selectOption(candidate);
    await panel.getByRole("checkbox", { name: /^I explicitly confirm this household call/ }).check();
    await panel.getByRole("checkbox", { name: /^I verified permission to capture this call/ }).check();
    // Uncommitted selection must participate in the real patient's existing navigation guard.
    await page.getByRole("button", { name: "Schedule", exact: true }).first().click();
    const leave = page.getByRole("alertdialog", { name: "Leave with unsaved changes?", exact: true });
    await leave.waitFor(); await leave.getByRole("button", { name: "Keep editing", exact: true }).click();
    check(new URL(page.url()).pathname, "/hub/patient/" + petId);
    await panel.getByRole("button", { name: "Reserve selected household call", exact: true }).click();
    await until(() => lostReservation, "dropped committed call reservation");
    await panel.getByRole("region", { name: "Pending call capture", exact: true }).waitFor();
    page.once("dialog", (dialog) => dialog.accept());
    await page.reload({ waitUntil: "domcontentloaded" }); panel = await openEncounter();
    await panel.getByRole("button", { name: "Recover original call capture", exact: true }).click();
    await panel.getByRole("button", { name: "Capture complete call transcript", exact: true }).waitFor();
    await panel.getByRole("button", { name: "Capture complete call transcript", exact: true }).click();
    await until(() => lostCapture, "dropped committed call capture");
    await until(async () => (await panel.getByRole("region", { name: "Pending call capture", exact: true }).textContent())!.includes("Unconfirmed"), "unconfirmed capture recovery state");
    const storedRecovery = await page.evaluate(() => Object.fromEntries(Object.entries(sessionStorage).filter(([key]) => key.startsWith("lrv:call-"))));
    check(Object.keys(storedRecovery).length, 1);
    const storedPending = JSON.parse(Object.values(storedRecovery)[0]);
    check(Object.keys(storedPending).sort(), ["action_id", "actor_id", "request"]);
    check(storedPending.action_id, captureId);
    check(Object.keys(storedPending.request).sort(), ["attest_authorized", "encounter_id", "expected_encounter_version", "expected_inbound_version", "expected_pet_version", "inbound_id", "pet_id", "policy_version"]);
    if (options.expectedTranscriptText) check(JSON.stringify(storedRecovery).includes(options.expectedTranscriptText), false);
    await panel.getByRole("button", { name: "Recover original call capture", exact: true }).click();
    const preview = panel.getByRole("region", { name: "Frozen call transcript", exact: true }); await preview.waitFor();
    check((await preview.textContent())!.includes(sourceId!), true);
    check(await panel.getByRole("region", { name: "Pending call capture", exact: true }).count(), 0);
    check(await page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.startsWith("lrv:call-capture:")).length), 0);
    const segments = preview.getByRole("region", { name: "All captured call segments", exact: true });
    check(await segments.locator("article").count(), options.expectedSegmentCount ?? 101);
    if (options.expectedTranscriptText) await segments.getByText(options.expectedTranscriptText, { exact: true }).waitFor();
    check((await preview.getByRole("region", { name: "Original call speaker labels", exact: true }).textContent())!.includes("provider role"), true);
    const audit = preview.locator('details[aria-label="Capture audit details"]');
    check(await audit.getAttribute("open"), null);
    check(await preview.getByText(/^Source manifest SHA256/).isVisible(), false);
    check(await segments.getByText(/SHA256|projection offsets/).count(), 0);
    check((await preview.getByText("Call ended", { exact: true }).locator("..").locator("dd").textContent())!.includes("Denver"), true);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await preview.getByRole("heading", { name: "Complete captured transcript", exact: true }).scrollIntoViewIfNeeded();
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: `${directory}/transcript-${width}.png`, fullPage: false });
      await segments.locator("article").first().scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${directory}/segments-${width}.png`, fullPage: false });
    }
    await audit.locator(":scope > summary").click();
    await preview.locator("summary").filter({ hasText: "Exact transcript projection and page evidence" }).click();
    check((await preview.locator("pre").textContent())!.includes("[#0101"), true);
    check((await preview.textContent())!.includes("Source manifest SHA256"), true);
    // A separate policy save also recovers its original receipt after a committed acknowledgement is lost.
    await page.route("**/rest/v1/rpc/save_clinical_call_policy", async (route) => {
      const response = await route.fetch();
      if (!lostPolicy && response.ok()) { lostPolicy = true; await route.abort("failed"); }
      else await route.fulfill({ response });
    });
    await panel.locator("summary").filter({ hasText: "Independent call-source policy" }).click();
    const policyText = "Synthetic browser policy retained only on the local backend.";
    await panel.getByLabel("Call consent and permitted use", { exact: true }).fill(policyText);
    await panel.getByLabel("Call policy status", { exact: true }).selectOption("draft");
    await panel.getByRole("button", { name: "Save call-source policy", exact: true }).click();
    await until(() => lostPolicy, "dropped committed call policy acknowledgement");
    await panel.getByRole("region", { name: "Unconfirmed call policy action", exact: true }).waitFor();
    const policyRecovery = await page.evaluate(() => Object.fromEntries(Object.entries(sessionStorage).filter(([key]) => key.startsWith("lrv:call-policy:"))));
    check(Object.keys(policyRecovery).length, 1);
    check(Object.keys(JSON.parse(Object.values(policyRecovery)[0])).sort(), ["action_id", "actor_id", "expected_version"]);
    check(JSON.stringify(policyRecovery).includes(policyText), false);
    page.once("dialog", (dialog) => dialog.accept());
    await page.reload({ waitUntil: "domcontentloaded" }); panel = await openEncounter();
    await panel.locator("summary").filter({ hasText: "Independent call-source policy" }).click();
    await panel.getByRole("button", { name: "Recover original call policy action", exact: true }).click();
    await panel.getByText("Original call policy action recovered.", { exact: true }).waitFor();
    check(await panel.getByLabel("Call consent and permitted use", { exact: true }).inputValue(), policyText);
    check(await panel.getByLabel("Call policy status", { exact: true }).inputValue(), "draft");
    check(await page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.startsWith("lrv:call-policy:")).length), 0);
    // Invalid local recovery data has an explicit escape hatch without canceling unknown remote actions.
    await page.evaluate(({ actor, patient, encounter }) => {
      sessionStorage.setItem(`lrv:call-capture:${actor}:${patient}:${encounter}`, JSON.stringify({ invalid_local_fixture: true }));
      sessionStorage.setItem(`lrv:call-policy:${actor}`, JSON.stringify({ invalid_local_fixture: true }));
    }, { actor: session.user.id, patient: petId, encounter: encounterId });
    await page.reload({ waitUntil: "domcontentloaded" }); panel = await openEncounter();
    page.once("dialog", (dialog) => dialog.accept());
    await panel.getByRole("button", { name: "Discard invalid local call recovery data", exact: true }).click();
    await panel.getByRole("region", { name: "Call recovery review required", exact: true }).waitFor();
    await panel.getByRole("button", { name: "I reviewed retained sources and outstanding captures", exact: true }).click();
    await panel.locator("summary").filter({ hasText: "Independent call-source policy" }).click();
    page.once("dialog", (dialog) => dialog.accept());
    await panel.getByRole("button", { name: "Discard invalid local call policy recovery data", exact: true }).click();
    await panel.getByText("Invalid local policy recovery data discarded. No remote action was canceled. Review the current policy before editing.", { exact: true }).waitFor();
    check(await page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.startsWith("lrv:call-")).length), 0);
    check(remoteCancellationRequests, 0);
    check(errors, []);
    await context.close();
    let staffAssertions = 0;
    if (options.staffSession) {
      const staff = await browser.newContext({ viewport: { width: 390, height: 844 } });
      await staff.route("**/*", (route) => [origin, status.API_URL].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
      await staff.addInitScript((value) => localStorage.setItem("sb-127-auth-token", JSON.stringify(value)), options.staffSession);
      const staffPage = await staff.newPage(); staffPage.setDefaultTimeout(60000);
      let privateRequests = 0; staffPage.on("request", (request) => { if (request.url().includes("/rpc/") && /clinical_call/.test(request.url())) privateRequests++; });
      await staffPage.goto(url, { waitUntil: "domcontentloaded" });
      await staffPage.getByRole("region", { name: "Clinical records", exact: true }).getByRole("button", { name: / · clinic · draft$/ }).first().click();
      await staffPage.getByRole("heading", { name: "Edit draft encounter", exact: true }).waitFor();
      check(await staffPage.getByRole("region", { name: "Patient-linked call sources", exact: true }).count(), 0);
      check(await staffPage.getByRole("region", { name: "Frozen call transcript", exact: true }).count(), 0);
      check(privateRequests, 0); staffAssertions = 3;
      await staff.close();
    }
    return { browserAssertions: checks, droppedCommittedResponses: 3, captureId, sourceId, staffAssertions, realProviderRequests: 0 };
  } catch (failure) {
    const page = browser?.contexts()[0]?.pages()[0];
    if (page) { await page.screenshot({ path: `${directory}/failure.png`, fullPage: false }).catch(() => {}); writeFileSync(`${directory}/failure.html`, await page.content().catch(() => "Unavailable"), { mode: 0o600 }); }
    throw failure;
  } finally {
    if (browser) { for (const context of browser.contexts()) await context.unrouteAll({ behavior: "ignoreErrors" }); await browser.close(); }
    if (vite.exitCode === null) { const stopped = once(vite, "exit"); vite.kill("SIGTERM"); await stopped; }
  }
}
