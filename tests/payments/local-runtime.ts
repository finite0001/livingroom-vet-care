/** Actual local HTTP/Auth/PostgREST checks; no Stripe provider acceptance is claimed. */
import {execFileSync, spawn} from "node:child_process";
import {readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHmac, createHash, randomUUID} from "node:crypto";
import assert from "node:assert/strict";
let project = process.env.PAYMENT_TEST_PROJECT || "/tmp/livingroom-vet-foundation";
let temporaryProject = "";
// The existing containers may outlive their /tmp configuration. This config is
// used for status only; this runner never starts, resets, or stops Supabase.
if (!process.env.PAYMENT_TEST_PROJECT && !existsSync(`${project}/supabase/config.toml`)) {
  temporaryProject = mkdtempSync(join(tmpdir(), "lrv-payment-local-"));
  project = temporaryProject;
  mkdirSync(join(project, "supabase"));
  writeFileSync(join(project, "supabase/config.toml"), 'project_id = "livingroom-vet-foundation"\n[api]\nport = 56321\n[db]\nport = 56322\nshadow_port = 56320\n');
  process.once("exit", () => rmSync(temporaryProject, {recursive: true, force: true}));
}
const projectId = readFileSync(`${project}/supabase/config.toml`, "utf8").match(/^project_id\s*=\s*"([a-zA-Z0-9_-]+)"/m)?.[1];
assert.ok(projectId, "Explicit local project required");
const local = JSON.parse(execFileSync("supabase", ["status", "--workdir", project, "--output", "json"], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}));
assert.match(local.API_URL, /^http:\/\/127\.0\.0\.1:\d+$/);
const sql = (query: string) => execFileSync("docker", ["exec", "-i", `supabase_db_${projectId}`, "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], {input: query, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"]}).trim();
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
assert.equal(sql("select count(*) from public.stripe_event_work where state in ('queued','leased','retry');"), "0", "Do not claim another test's pending work");
const eventId = `evt_Local${randomUUID().replaceAll("-", "")}`;
const account = `acct_Local${randomUUID().replaceAll("-", "")}`;
const signingSecret = `whsec_${randomUUID().replaceAll("-", "")}`;
const version = readFileSync("supabase/functions/_shared/stripe-provider.ts", "utf8").match(/STRIPE_API_VERSION\s*=\s*"([^"]+)"/)?.[1];
assert.ok(version);
const root = "http://127.0.0.1:56461";
// The module dependency must already be cached; runtime is intentionally unable to download code.
const server = spawn("deno", ["run", "--cached-only", "--allow-env", "--allow-net=127.0.0.1", "tests/payments/local-server.ts"], {env: {...process.env, SUPABASE_URL: local.API_URL, SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY, SUPABASE_SECRET_KEYS: "{}", APP_URL: "https://thelivingroom.vet", STRIPE_ACCOUNT_ID: account, STRIPE_LIVEMODE: "false", STRIPE_WEBHOOK_SECRET: signingSecret, STRIPE_EVENT_PROCESSING_ENABLED: "true", STRIPE_COLLECTIONS_ENABLED: "false", STRIPE_SECRET_KEY: "", STRIPE_RETURN_ORIGIN: "https://thelivingroom.vet"}, stdio: ["ignore", "ignore", "pipe"]});
let stderr = "";
server.stderr.on("data", value => {stderr += value.toString();});
let assertions = 0;
const check = (value: unknown, message: string) => {assert.ok(value, message); assertions++;};
const post = (path: string, body = "{}", headers: Record<string,string> = {}) => fetch(root + path, {method: "POST", headers: {"Content-Type": "application/json", ...headers}, body});
let failure: unknown;
try {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    if (server.exitCode !== null) throw new Error(`Local Deno server exited: ${stderr.replaceAll(local.SERVICE_ROLE_KEY, "[redacted]")}`);
    try {const response = await fetch(root + "/health"); ready = await response.text() === "ready"; if (ready) break;} catch { /* Boot pending. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  check(ready, "Actual Deno runtime booted");
  const before = sql("select count(*) from public.stripe_event_receipts;");
  check((await post("/checkout-off")).status === 503, "Disabled checkout fails closed");
  check((await post("/webhook-off")).status === 503, "Disabled webhook fails closed");
  check((await post("/checkout")).status === 401, "Missing staff authentication denied");
  check((await post("/checkout", "{}", {Authorization: "Bearer invalid"})).status === 401, "Invalid JWT rejected by actual local Auth");
  check((await post("/worker")).status === 401, "Missing worker credential denied");
  check((await post("/worker", "{}", {Authorization: `Bearer ${local.ANON_KEY}`})).status === 401, "Anon credential denied");
  check((await post("/worker", "{}", {Authorization: `Bearer ${local.SERVICE_ROLE_KEY}`, apikey: "sb_secret_incorrect"})).status === 401, "Explicit incorrect key cannot fall back to valid bearer");
  const worker = await post("/worker", "{}", {Authorization: `Bearer ${local.SERVICE_ROLE_KEY}`});
  check(worker.status === 200 && (await worker.json()).state === "empty", "Authorized worker reaches actual empty database queue");
  check((await post("/webhook", "{}", {"stripe-signature": "t=1,v1=" + "0".repeat(64)})).status === 400, "Forged signature denied");
  check(sql("select count(*) from public.stripe_event_receipts;") === before, "Denied requests persist no receipt");
  const event = JSON.stringify({id: eventId, object: "event", type: "checkout.session.completed", created: Math.floor(Date.now()/1000), livemode: false, api_version: version, data: {object: {id: "cs_test_Local", object: "checkout.session", metadata: {request_id: randomUUID()}, customer_email: "must-not-persist@example.test"}}});
  const timestamp = Math.floor(Date.now()/1000);
  const signature = `t=${timestamp},v1=${createHmac("sha256", signingSecret).update(`${timestamp}.${event}`).digest("hex")}`;
  check((await post("/webhook", event, {"stripe-signature": signature})).status === 200, "Signed synthetic event reaches actual receive RPC");
  check((await post("/webhook", event, {"stripe-signature": signature})).status === 200, "Exact redelivery acknowledged");
  const rows = JSON.parse(sql(`select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.stripe_event_receipts r where event_id=${quote(eventId)} and account_id=${quote(account)};`));
  check(rows.length === 1, "Duplicate delivery creates one durable receipt");
  check(rows[0].raw_sha256 === createHash("sha256").update(event).digest("hex"), "Durable hash matches signed raw bytes");
  check(rows[0].disposition === "quarantined" && rows[0].reason === "provider_not_configured", "Unconfigured synthetic account quarantined");
  check(!JSON.stringify(rows).includes("must-not-persist"), "Provider customer payload excluded from receipt");
} catch (error) {failure = error;} finally {
  server.kill("SIGTERM");
  await new Promise<void>(resolve => {if (server.exitCode !== null || server.signalCode !== null) resolve(); else server.once("exit", () => resolve());});
  // Exact synthetic IDs only; disable append-only triggers in this local cleanup transaction.
  sql(`begin; set local session_replication_role=replica; delete from public.stripe_event_work_history where receipt_id in (select id from public.stripe_event_receipts where event_id=${quote(eventId)} and account_id=${quote(account)}); delete from public.stripe_event_work where receipt_id in (select id from public.stripe_event_receipts where event_id=${quote(eventId)} and account_id=${quote(account)}); delete from public.stripe_event_receipts where event_id=${quote(eventId)} and account_id=${quote(account)}; commit;`);
  check(sql(`select count(*) from public.stripe_event_receipts where event_id=${quote(eventId)} and account_id=${quote(account)};`) === "0", "Exact synthetic receipt cleanup verified");
}
if (failure) throw failure;
console.log(`Local Stripe runtime checks passed: ${assertions}. No provider requests or payments performed.`);
