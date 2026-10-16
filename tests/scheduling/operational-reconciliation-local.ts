/** Genuine Auth/PostgREST proof in a uniquely owned local runtime only. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { parseOwnedRuntimeStatus } from "../estimates/owned-runtime-status.ts";
import { reconciliationRunSchema } from "../../supabase/functions/_shared/operational-reconciliation-contract.ts";
import { reconciliationHttpProof } from "./operational-reconciliation-http.ts";
import { reconciliationBrowserProof } from "./operational-reconciliation-browser.ts";

const project = process.env.RECONCILIATION_TEST_PROJECT;
assert.ok(project && process.env.RECONCILIATION_RUN_SYNTHETIC_LOCAL === "true");
const identity = readFileSync(project + "/supabase/config.toml", "utf8").match(/^project_id = "(lrv-(?:reconcile|catalog)-[a-z0-9]+)"/m)?.[1];
assert.ok(identity);
const container = "supabase_db_" + identity;
const labels = JSON.parse(execFileSync("docker", ["inspect", container], { encoding: "utf8" }))[0].Config.Labels;
assert.equal(labels["com.supabase.cli.project"], identity);
assert.equal(realpathSync(labels["com.supabase.cli.workdir"]), realpathSync(project));
const status = parseOwnedRuntimeStatus(execFileSync("supabase", ["status", "--workdir", project, "--output", "json", "--agent", "no"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
assert.ok(["localhost", "127.0.0.1"].includes(new URL(status.API_URL).hostname));
function sql(query: string) {
  return execFileSync("docker", ["exec", "-i", container, "psql", "-X", "-qAt", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], { input: query, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(status.API_URL, status.SERVICE_ROLE_KEY, options);
interface Actor { id: string; db: SupabaseClient; }
const actors: Actor[] = [];
let checks = 0, originalNext = "", admin: Actor | null = null;
function check(actual: unknown, expected: unknown) { assert.deepEqual(actual, expected); checks++; }
async function rpc(db: SupabaseClient, name: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await db.rpc(name, args);
  if (error) throw Object.assign(new Error(name + ": " + error.message), { code: error.code });
  return data;
}
async function actor(role: string) {
  const email = "synthetic-reconciliation-" + randomUUID() + "@example.test", password = randomUUID() + randomUUID();
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const id = data.user!.id, db = createClient(status.API_URL, status.ANON_KEY, options);
  actors.push({ id, db });
  sql(`update profiles set is_active=true,full_name='Synthetic reconciliation ${role}' where id='${id}';insert into user_roles(user_id,role) values('${id}','${role}') on conflict do nothing;`);
  const signed = await db.auth.signInWithPassword({ email, password });
  if (signed.error) throw signed.error;
  return actors[actors.length - 1];
}
async function policy(owner: Actor, enabled: boolean) {
  const current = await rpc(owner.db, "read_operational_reconciliation_policy", {});
  const action = randomUUID();
  const currentVersion = current === null ? null : z.object({ version: z.number().int().positive() }).parse(current).version;
  const request = { expected_version: currentVersion, enabled, window_from: enabled ? new Date(Date.now() - 3600000).toISOString() : null, window_until: enabled ? new Date(Date.now() + 86400000).toISOString() : null, review_note: "Synthetic bounded policy proof", attest_review: true };
  await rpc(owner.db, "prepare_operational_review", { p_actor_id: owner.id, p_action_id: action, p_operation: "reconciliation_policy", p_request: request });
  const receipt = await rpc(owner.db, "execute_operational_review", { p_actor_id: owner.id, p_action_id: action });
  check(await rpc(owner.db, "execute_operational_review", { p_actor_id: owner.id, p_action_id: action }), receipt);
  return receipt;
}
let elapsed = 0, failure: unknown = null, httpProof: Awaited<ReturnType<typeof reconciliationHttpProof>> | null = null,
  browserProof: Awaited<ReturnType<typeof reconciliationBrowserProof>> | null = null;
try {
  check(sql("select count(*) from supabase_migrations.schema_migrations;"), "191");
  const cursorBaseline = sql("select count(*) from operational_reconciliation_cursor;");
  check(await rpc(service, "start_operational_reconciliation_run", { p_run_id: randomUUID(), p_limit: 5 }), { disabled: true });
  check(sql("select count(*) from operational_reconciliation_cursor;"), cursorBaseline);
  admin = await actor("ADMIN");
  const staff = await actor("STAFF");
  for (const table of ["operational_reconciliation_policy", "operational_reconciliation_runs", "operational_reconciliation_results", "operational_reconciliation_cursor"]) {
    const serviceRead = await service.from(table).select("*");check(serviceRead.error?.code, "42501");
    const staffRead = await staff.db.from(table).select("*");check(staffRead.error?.code, "42501");
  }
  const forbidden = await staff.db.rpc("start_operational_reconciliation_run", { p_run_id: randomUUID(), p_limit: 5 });check(forbidden.error?.code, "42501");
  const staffPolicy = await staff.db.rpc("read_operational_reconciliation_policy", {});check(staffPolicy.error?.code, "42501");
  await policy(admin, true);
  const firstId = randomUUID(), args = { p_run_id: firstId, p_limit: 5 };
  const first = reconciliationRunSchema.parse(await rpc(service, "start_operational_reconciliation_run", args));check(first.outcome, "started");
  const pending = await service.rpc("start_operational_reconciliation_run", { p_run_id: randomUUID(), p_limit: 5 });check(pending.error?.code, "PT409");
  check(await rpc(service, "recover_operational_reconciliation_run", args), first);
  const done = reconciliationRunSchema.parse(await rpc(service, "execute_operational_reconciliation_run", args));check(done.outcome, "completed");check(done.counts !== null && done.counts.examined <= 5, true);check(done.sweep_complete, done.checkpoint?.lane === "complete");
  check(await rpc(service, "execute_operational_reconciliation_run", args), done);
  const collision = await service.rpc("start_operational_reconciliation_run", { p_run_id: firstId, p_limit: 4 });check(collision.error?.code, "23505");
  const pausedArgs = { p_run_id: randomUUID(), p_limit: 5 };await rpc(service, "start_operational_reconciliation_run", pausedArgs);await policy(admin, false);
  const paused = reconciliationRunSchema.parse(await rpc(service, "execute_operational_reconciliation_run", pausedArgs));check(paused.outcome, "paused");check(paused.counts, null);
  check(await rpc(service, "recover_operational_reconciliation_run", args), done);
  await policy(admin, true);
  // An owned private helper delays the empty-source query. This tests the real
  // function-level PostgREST timeout, not a fake HTTP or JavaScript timer.
  const timeoutArgs = { p_run_id: randomUUID(), p_limit: 5 };
  originalNext = sql("select pg_get_functiondef('operational_reconciliation_next(operational_reconciliation_runs,text,uuid)'::regprocedure);");
  const delayed = originalNext.replace("declare source uuid;begin", `declare source uuid;begin if r.run_id='${timeoutArgs.p_run_id}' then perform pg_sleep(6);end if;`);
  assert.notEqual(delayed, originalNext);sql(delayed);
  await rpc(service, "start_operational_reconciliation_run", timeoutArgs);
  const began = performance.now();
  const timed = reconciliationRunSchema.parse(await rpc(service, "execute_operational_reconciliation_run", timeoutArgs));elapsed = performance.now() - began;
  check(timed.outcome, "failed");check(timed.failure_code, "deadline");check(timed.counts, null);check(timed.checkpoint, null);check(elapsed >= 4500 && elapsed < 5800, true);
  check(await rpc(service, "recover_operational_reconciliation_run", timeoutArgs), timed);
  sql(originalNext);originalNext = "";
  const observed = z.object({ items: z.array(reconciliationRunSchema).max(1), next: z.object({ before: z.string(), before_id: z.string().uuid() }).strict().nullable() }).strict().parse(await rpc(admin.db, "list_operational_reconciliation_runs", { p_limit: 1 }));check(observed.items.length, 1);check(observed.next !== null, true);
  const invalidCursor = await admin.db.rpc("list_operational_reconciliation_runs", { p_before: new Date().toISOString(), p_before_id: null, p_limit: 1 });check(invalidCursor.error?.code, "23514");
  httpProof = await reconciliationHttpProof({ status, service, sql });
  browserProof = await reconciliationBrowserProof({ status, admin, staff, service, sql });
  check(sql("select count(*) from communication_outbox;"), "0");check(sql("select count(*) from inventory_movements;"), "0");
} catch (cause) { failure = cause; } finally {
  try { if (originalNext) sql(originalNext); } catch (cause) { failure ??= cause; }
  try { if (admin) await policy(admin, false); } catch (cause) { failure ??= cause; }
  for (const owned of actors) {
    try { sql(`update profiles set is_active=false where id='${owned.id}';update auth.sessions set not_after=clock_timestamp() where user_id='${owned.id}';delete from auth.refresh_tokens where user_id='${owned.id}';`); } catch (cause) { failure ??= cause; }
    try { const signedOut = await owned.db.auth.signOut();assert.ifError(signedOut.error); } catch (cause) { failure ??= cause; }
  }
}
if (failure) throw failure;
check(sql("select count(*) from operational_reconciliation_policy where enabled and version=(select max(version)from operational_reconciliation_policy);"), "0");
for (const owned of actors) check(sql(`select count(*)from profiles where id='${owned.id}' and is_active;`), "0");
const proof = { api_checks: checks, http: httpProof, browser: browserProof, timeout_elapsed_ms: Math.round(elapsed), real_auth_postgrest: true, provider_requests: 0, owned_accounts_deactivated: true, private_timeout_helper_restored: true };
writeFileSync(project + "/reconciliation-api-proof.json", JSON.stringify(proof, null, 2));
console.log(JSON.stringify(proof));
