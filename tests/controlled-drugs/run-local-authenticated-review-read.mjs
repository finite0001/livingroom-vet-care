/** Closed local engineering driver; no generic URL, user or production mode.
 * The independently admitted backend wrapper owns services and the original
 * deadline and child/process watchdog. The 120s here is a success cutoff, not
 * autonomous hard termination. This driver uses a fresh browser/Vite instance,
 * closes both, and does not admit production origin/key behavior.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, realpathSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react-swc";
import { chromium, expect } from "@playwright/test";
import { localAuthenticatedReviewReadInputSchema } from "./local-authenticated-review-read-input.ts";
import { recordReviewRequestSchema, reviewTransportDigest } from "../../src/hub/features/controlled-drugs/record-review/request.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const pageOrigin = "http://127.0.0.1:64901";
const reason = "Synthetic independent record review only; no claim of physical observation";
const start = performance.now(), deadline = start + 120000;
const remaining = (maximum = 15000) => {
  if (failure) throw failure;
  const left = deadline - performance.now() - 30000;
  if (left <= 0) throw new Error("Original local browser phase deadline exhausted");
  return Math.min(maximum, left);
};
if (process.argv.length !== 3) throw new Error("Exactly one owned proof folder is required");
const folder = realpathSync(resolve(process.argv[2]));
const parent = dirname(folder), inputFile = resolve(folder, "input.json");
assert.equal(basename(folder), "browser-proof");
assert.match(parent, /^\/private\/tmp\/lrv-closed-lifecycle-[^/]+$/);
for (const directory of [folder, parent]) {
  const stat = lstatSync(directory);
  assert(stat.isDirectory() && stat.uid === process.getuid() && (stat.mode & 0o077) === 0);
}
assert.deepEqual(readdirSync(folder).sort(), ["input.json"]);
const inputStat = lstatSync(inputFile);
assert(inputStat.isFile() && !inputStat.isSymbolicLink() && inputStat.uid === process.getuid() && (inputStat.mode & 0o077) === 0 && inputStat.size <= 65536);
const parsedInput = (() => {
  try { return localAuthenticatedReviewReadInputSchema.safeParse(JSON.parse(readFileSync(inputFile, "utf8"))); }
  catch { throw new Error("Fixed disposable local reviewer input is invalid"); }
})();
if (!parsedInput.success) throw new Error("Fixed disposable local reviewer input is invalid");
const input = parsedInput.data;
let vite, browserServer, browser, context, page, operationId, request, receiptHash, selected;
let queueDetailAdmitted = false, reloadSelectionAbsent = false, readPhaseReleased = false;
const readEvidence = {}, bodyTasks = [];
let viteClosed = false, browserClosed = false, failure;
const latchFailure = () => { failure ??= new Error("Local browser phase failed"); };
const calls = [], responses = [], blockedOrigins = new Set();
const output = (name, value) => writeFileSync(resolve(folder, name), JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
async function snapshot() { return page.evaluate(() => window.__LRV_LOCAL_READ_REVIEW__?.snapshot()); }
async function untilPhase(phase) {
  await expect.poll(async () => (await snapshot())?.phase, { timeout: remaining() }).toBe(phase);
}
async function closeWithin(work, milliseconds, label) {
  let timer;
  try { return await Promise.race([work(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), milliseconds); })]); }
  finally { clearTimeout(timer); }
}
try {
  vite = await createServer({ root, configFile: false, envFile: false, logLevel: "silent", plugins: [react()],
    cacheDir: resolve(folder, "vite-cache"), resolve: { alias: { "@": resolve(root, "src") } },
    server: { host: "127.0.0.1", port: 64901, strictPort: true, hmr: false, open: false } });
  await vite.listen(); remaining();
  assert.equal(vite.httpServer.address().address, "127.0.0.1");
  browserServer = await chromium.launchServer({ headless: true, host: "127.0.0.1", executablePath: chromium.executablePath(), timeout: remaining(20000) });
  output("browser-owner.json", { node_pid: process.pid, browser_pid: browserServer.process().pid,
    executable: chromium.executablePath(), spawnargs: browserServer.process().spawnargs });
  const endpoint = new URL(browserServer.wsEndpoint());
  assert.equal(endpoint.hostname, "127.0.0.1");
  browser = await chromium.connect(browserServer.wsEndpoint(), { timeout: remaining(15000) });
  context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
  await context.route("**/*", async route => {
    try {
      const networkRequest = route.request(), url = new URL(networkRequest.url());
      if (url.origin === pageOrigin) { await route.continue(); return; }
      if (url.origin !== input.origin) { blockedOrigins.add(url.origin); latchFailure(); await route.abort(); return; }
      remaining(); // Sticky failures and the original phase cutoff prohibit a new API forward.
      assert.match(url.pathname, /^\/rest\/v1\/rpc\/((prepare|execute|read)_controlled_record_review_v3|get_controlled_record_review_event_v3|list_controlled_record_reviews_v3)$/);
      assert.equal(url.search, ""); assert.equal(url.hash, "");
      if (networkRequest.method() === "OPTIONS") { await route.continue(); return; }
      assert.equal(networkRequest.method(), "POST");
      const body = networkRequest.postData(); assert(body && Buffer.byteLength(body) <= 131072);
      const payload = JSON.parse(body), method = url.pathname.split("/").pop();
      assert.deepEqual(Object.keys(payload), ["p_request"]);
      assert.equal(method, ["list_controlled_record_reviews_v3", "get_controlled_record_review_event_v3", "prepare_controlled_record_review_v3", "execute_controlled_record_review_v3", "read_controlled_record_review_v3"][calls.length]);
      if (calls.length >= 2) assert.equal(readPhaseReleased, true, "Parent read phase must finish before any lifecycle request");
      if (method === "list_controlled_record_reviews_v3") {
        assert.deepEqual(payload.p_request, { actor_id: input.session.actorId, ...input.scope, view: "site", page_size: 1, cursor: null });
      } else if (method === "get_controlled_record_review_event_v3") {
        assert.deepEqual(payload.p_request, { actor_id: input.session.actorId, event_id: input.expectedEventId });
      } else if (method === "prepare_controlled_record_review_v3") {
        request = recordReviewRequestSchema.parse(payload.p_request);
        for (const [key, value] of Object.entries(selected)) assert.equal(request[key], value);
        assert.equal(request.decision, "approve"); assert.equal(request.reason, reason);
        const bytes = Buffer.from(body); writeFileSync(resolve(folder, "prepare-request.json"), bytes, { flag: "wx", mode: 0o600 });
        readEvidence.prepare = { file: "prepare-request.json", sha256: createHash("sha256").update(bytes).digest("hex") };
      } else {
        assert.deepEqual(Object.keys(payload.p_request).sort(), ["actor_id", "operation_id"]);
        assert.equal(payload.p_request.actor_id, input.session.actorId); assert.equal(payload.p_request.operation_id, request.operation_id);
      }
      const headers = networkRequest.headers();
      if (headers.authorization !== `Bearer ${input.session.accessToken}` || headers.apikey !== input.anonKey) throw new Error("Local reviewer header identity differs");
      remaining();
      calls.push({ method, request_sha256: createHash("sha256").update(body).digest("hex") });
      await route.continue();
    } catch { latchFailure(); await route.abort().catch(() => {}); }
  });
  // Only this isolated browser context receives the short-lived local JWT.
  // It is not served in a source file, URL, screenshot or emitted receipt.
  await context.addInitScript(value => Object.defineProperty(window, "__LRV_LOCAL_AUTH_READ_INPUT__", { value }), input);
  page = await context.newPage(); page.setDefaultTimeout(remaining(15000));
  page.on("response", response => {
    const url = new URL(response.url());
    if (url.origin === input.origin && response.request().method() === "POST") {
      const method = url.pathname.split("/").pop(); responses.push({ method, status: response.status() });
      const slot = method === "list_controlled_record_reviews_v3" ? "list" : method === "get_controlled_record_review_event_v3" ? "detail" : null;
      if (slot) bodyTasks.push((async () => {
        const bytes = await response.body(); assert(bytes.length <= 2097152);
        const file = slot + "-response.json";
        writeFileSync(resolve(folder, file), bytes, { flag: "wx", mode: 0o600 });
        readEvidence[slot] = { file, sha256: createHash("sha256").update(bytes).digest("hex") };
      })().catch(() => { latchFailure(); }));
    }
  });
  await page.goto(pageOrigin + "/tests/controlled-drugs/record-review-authenticated-read-fixture.html", { waitUntil: "networkidle", timeout: remaining(30000) });
  await untilPhase("idle"); assert.equal(calls.length, 0); assert.equal((await snapshot()).selection, null);
  await expect(page.getByRole("button", { name: "Prepare record review", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Load review records", exact: true }).click();
  await expect.poll(async () => (await snapshot())?.queuePhase, { timeout: remaining() }).toBe("ready");
  assert.equal(calls.length, 1);
  await page.getByRole("button", { name: /^Open record [0-9]+$/ }).click();
  await expect.poll(async () => !!(await snapshot())?.selection, { timeout: remaining() }).toBe(true);
  selected = (await snapshot()).selection;
  assert.deepEqual(Object.keys(selected).sort(), ["actor_id", "event_id", "policy_id", "read_eligibility_id", "review_eligibility_id"]);
  assert.equal(selected.actor_id, input.session.actorId); assert.equal(selected.event_id, input.expectedEventId);
  assert.equal(calls.length, 2); queueDetailAdmitted = true;
  await Promise.all(bodyTasks); remaining();
  assert.deepEqual(Object.keys(readEvidence).sort(), ["detail", "list"]);
  // The owning parent compares permanent row hashes before allowing writes.
  // This local test barrier is separate from evidence admission in the app.
  output("read-phase-ready.json", { kind: "closed-browser-read-phase-v1", event_id: selected.event_id, calls: calls.map(call => ({ ...call })) });
  const continuation = resolve(folder, "read-phase-continue.json");
  while (!existsSync(continuation)) { await new Promise(resolve => setTimeout(resolve, remaining(100))); }
  remaining();
  const continuationStat = lstatSync(continuation);
  assert(continuationStat.isFile() && !continuationStat.isSymbolicLink() && continuationStat.uid === process.getuid() &&
    (continuationStat.mode & 0o077) === 0 && continuationStat.size <= 1024);
  assert.deepEqual(JSON.parse(readFileSync(continuation, "utf8")), { kind: "closed-browser-read-phase-v1", passed: true });
  readPhaseReleased = true;
  await page.getByRole("textbox", { name: "Review reason" }).fill(reason);
  await page.getByRole("button", { name: "Prepare record review", exact: true }).click();
  await untilPhase("review"); operationId = (await snapshot()).operationId;
  assert.equal(request.operation_id, operationId);
  assert.deepEqual(calls.map(call => call.method), ["list_controlled_record_reviews_v3", "get_controlled_record_review_event_v3", "prepare_controlled_record_review_v3"]);
  await expect(page.getByText("LRV synthetic original", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm and sign record review", exact: true })).toHaveCount(0);
  await page.locator("summary").filter({ hasText: /^Event lines$/ }).click();
  await page.screenshot({ path: resolve(folder, "prepared.png"), fullPage: true });
  await page.getByRole("button", { name: "I have reviewed this preparation", exact: true }).click();
  assert.equal(calls.length, 3); // Acknowledgment alone cannot sign.
  await page.getByRole("button", { name: "Confirm and sign record review", exact: true }).click();
  await untilPhase("unknown");
  assert.equal((await snapshot()).operationId, operationId);
  assert.deepEqual(calls.map(call => call.method), ["list_controlled_record_reviews_v3", "get_controlled_record_review_event_v3", "prepare_controlled_record_review_v3", "execute_controlled_record_review_v3"]);
  await page.reload({ waitUntil: "networkidle", timeout: remaining(20000) });
  await untilPhase("recoverable");
  assert.equal((await snapshot()).operationId, operationId);
  assert.equal(calls.length, 4); // Reload reads local storage only.
  assert.equal((await snapshot()).selection, null); assert.equal((await snapshot()).queuePhase, "idle"); reloadSelectionAbsent = true;
  await page.getByRole("button", { name: "Recover original review", exact: true }).click();
  await untilPhase("resolved");
  await expect.poll(async () => (await snapshot()).cleanupPending, { timeout: remaining() }).toBe(false);
  await expect(page.getByText("Record review saved.", { exact: true })).toBeVisible();
  const resolved = await snapshot(); receiptHash = resolved.receiptHash;
  assert.equal(resolved.operationId, null); assert.match(receiptHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(calls.map(call => call.method), ["list_controlled_record_reviews_v3", "get_controlled_record_review_event_v3", "prepare_controlled_record_review_v3", "execute_controlled_record_review_v3", "read_controlled_record_review_v3"]);
  await expect.poll(() => responses.length, { timeout: remaining() }).toBe(5);
  assert(responses.every(response => response.status === 200));
  await Promise.all(bodyTasks); remaining(); assert.deepEqual(Object.keys(readEvidence).sort(), ["detail", "list", "prepare"]);
  await page.screenshot({ path: resolve(folder, "saved-after-recovery.png"), fullPage: true });
  remaining();
} catch {
  latchFailure();
  if (page && !page.isClosed()) { try { await page.screenshot({ path: resolve(folder, "failure.png"), fullPage: true, timeout: 3000 }); } catch {} }
} finally {
  let browserCleanupFailed = false;
  try { if (context) await closeWithin(() => context.close(), 4000, "Local browser context did not close"); }
  catch { browserCleanupFailed = true; latchFailure(); }
  try { if (browser) await closeWithin(() => browser.close(), 4000, "Local browser connection did not close"); }
  catch { browserCleanupFailed = true; latchFailure(); }
  try {
    if (browserServer) {
      try { await closeWithin(() => browserServer.close(), 3000, "Owned browser did not close"); }
      catch { await closeWithin(() => browserServer.kill(), 3000, "Owned browser did not terminate"); throw new Error("Normal browser cleanup failed"); }
      assert(browserServer.process().exitCode !== null || browserServer.process().signalCode !== null);
    }
    browserClosed = !browserCleanupFailed;
  } catch { latchFailure(); }
  try { if (vite) { await closeWithin(() => vite.close(), 5000, "Owned Vite did not close"); assert.equal(vite.httpServer.listening, false); } viteClosed = true; }
  catch { latchFailure(); }
  let digest = null;
  try { if (request) digest = await closeWithin(() => reviewTransportDigest(request), 3000, "Browser request commitment did not finish"); }
  catch { latchFailure(); }
  if (performance.now() >= deadline) failure ??= new Error("Original browser deadline exceeded including cleanup");
  if (!queueDetailAdmitted || !readPhaseReleased || !reloadSelectionAbsent || !request || !receiptHash ||
    calls.length !== 5 || responses.length !== 5 || responses.some(response => response.status !== 200) || blockedOrigins.size !== 0)
    failure ??= new Error("The fixed browser phases did not complete");
  output("result.json", { kind: "closed-local-staff-browser-read-v1", passed: !failure && browserClosed && viteClosed,
    event_id: input.expectedEventId, queue_detail_admitted: queueDetailAdmitted, server_selection_used: queueDetailAdmitted && !!request,
    reload_selection_absent: reloadSelectionAbsent, selection: selected ?? null, read_evidence: readEvidence,
    actor_id: input.session.actorId, operation_id: operationId ?? null, transport_digest: digest,
    receipt_hash: receiptHash ?? null, calls, responses, blocked_external_origins: [...blockedOrigins].sort(),
    explicit_test_origin_and_public_key_translation: true, normal_browser_cleanup: browserClosed, normal_vite_cleanup: viteClosed,
    elapsed_seconds: (performance.now() - start) / 1000, full_auth_acceptance: false, full_protocol_acceptance: false,
    native_origin_security_certification: false, clinical_activation: false, hosted_writes: 0,
    failure_type: failure?.name ?? null });
}
if (failure) throw new Error("Closed local browser read proof failed; private evidence was retained");
console.log("Closed local staff browser flow passed; exact source/metadata/Auth/data admission remains the owning wrapper's responsibility.");
