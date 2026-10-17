/** Actual local Auth/PostgREST/HTTP + synthetic provider fixtures. No real call or AI access. */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { parseOwnedRuntimeStatus } from "../estimates/owned-runtime-status.ts";
import { createClinicalCallHandler } from "../../supabase/functions/_shared/clinical-call-handler.ts";
import { callCaptureReadSchema } from "../../supabase/functions/_shared/clinical-call-model.ts";
import { page as providerPage } from "./fixtures.ts";
import { proveClinicalCallBrowser } from "./browser-proof.ts";
const project = process.env.CALL_TEST_PROJECT;
assert.ok(project && process.env.CALL_RUN_SYNTHETIC_LOCAL === "true");
const evidencePrefix = process.env.CALL_EVIDENCE_PREFIX ?? "clinical-calls";
assert.match(evidencePrefix, /^[a-z0-9][a-z0-9-]{0,79}$/, "Invalid local evidence prefix.");
const evidenceBase = `tmp/${evidencePrefix}`;
const browserEvidence = `${evidenceBase}-browser`;
const identity = readFileSync(project + "/supabase/config.toml", "utf8").match(
  /^project_id = "(lrv-clinical-calls-[a-f0-9]+)"/m,
)?.[1];
assert.ok(identity);
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
  execFileSync("supabase", [
    "status",
    "--workdir",
    project,
    "--output",
    "json",
    "--agent",
    "no",
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
);
assert.equal(status.API_URL, "http://127.0.0.1:65321");
function sql(query: string, database = "postgres") {
  try {
    return execFileSync("docker", [
      "exec",
      "-i",
      container,
      "psql",
      "-X",
      "-qAt",
      "-U",
      "postgres",
      "-d",
      database,
      "-v",
      "ON_ERROR_STOP=1",
    ], {
      input: query,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    }).trim();
  } catch (failure) {
    mkdirSync("tmp", { recursive: true, mode: 0o700 });
    writeFileSync(
      `${evidenceBase}-sql-failure.txt`,
      query + "\n" + String(failure),
      { mode: 0o600 },
    );
    throw Error(
      `Owned recap SQL failed; see private ${evidenceBase}-sql-failure.txt.`,
    );
  }
}
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(status.API_URL, status.SERVICE_ROLE_KEY, options);
interface Actor {
  id: string;
  db: SupabaseClient;
  session: Session;
  signInAgain: () => Promise<Actor>;
}
async function rpc(
  db: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
) {
  const { data, error } = await db.rpc(name, args);
  if (error) {
    throw Object.assign(Error(name + ": " + error.message), {
      code: error.code, details: error.details,
    });
  }
  return data;
}
async function actor(admin: boolean): Promise<Actor> {
  const email = "synthetic-notes-" + randomUUID() + "@example.test",
    password = randomUUID() + randomUUID();
  const created = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error) throw created.error;
  const id = created.data.user!.id;
  sql(
    `update profiles set is_active=true,full_name='Synthetic recap staff'where id='${id}';insert into user_roles(user_id,role)values('${id}','${
      admin ? "ADMIN" : "STAFF"
    }')on conflict do nothing;`,
  );
  async function signInAgain(): Promise<Actor> {
    const signedDb = createClient(status.API_URL, status.ANON_KEY, options);
    const signed = await signedDb.auth.signInWithPassword({ email, password });
    if (signed.error) throw signed.error;
    return { id, db: signedDb, session: signed.data.session!, signInAgain };
  }
  return signInAgain();
}

let apiChecks = 0, restoreChecks = 0, providerRequests = 0, finishRequests = 0, observedWaits = 0;
const check = (actual: unknown, expected: unknown) => { assert.deepEqual(actual, expected); apiChecks++; };
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(test: () => boolean | Promise<boolean>, label: string) { for (let i = 0; i < 600; i++) { if (await test()) return; await pause(25); } throw Error("Did not observe " + label); }
mkdirSync("tmp", { recursive: true, mode: 0o700 });
let enabled = true, loseFinish = false, loseDispatch = false, providerHold: Promise<void> | null = null;
const handler = createClinicalCallHandler({
  get enabled() { return enabled; }, credentials: "synthetic-provider-only",
  authenticate: async (token) => {
    const { data, error } = await service.auth.getUser(token); if (error || !data.user) return null;
    const actorId = data.user.id, db = createClient(status.API_URL, status.ANON_KEY, { ...options, global: { headers: { Authorization: "Bearer " + token } } });
    return { actorId, read: (id) => rpc(db, "read_clinical_call_capture", { p_actor_id: actorId, p_id: id }) };
  },
  dispatch: async (id) => { const result = await rpc(service, "dispatch_clinical_call_capture", { p_id: id }); if (loseDispatch) { loseDispatch = false; throw Error("Dropped committed dispatch acknowledgement"); } return result; },
  finish: async (id, document) => { finishRequests++; const result = await rpc(service, "finish_clinical_call_capture", { p_id: id, p_document: document }); if (loseFinish) { loseFinish = false; throw Error("Dropped committed synthetic finish acknowledgement"); } return result; },
  fail: async (id, code) => { await rpc(service, "fail_clinical_call_capture", { p_id: id, p_code: code }); },
  providerFetch: async (url, init) => {
    const parsed = new URL(String(url)); check(parsed.origin, "https://api.cloudtalk.io"); check(parsed.pathname, "/v1/ai/calls/700013/transcription"); check(init?.redirect, "error"); providerRequests++;
    if (providerHold) await providerHold;
    const result = providerPage(101, Number(parsed.searchParams.get("offset")));
    return new Response(JSON.stringify(result), { headers: { "content-type": "application/json" } });
  },
});
const bridge = createServer(async (request, response) => {
  try {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const headers = new Headers(); for (const [key, value] of Object.entries(request.headers)) if (typeof value === "string") headers.set(key, value);
    const result = await handler(new Request("http://127.0.0.1/capture", { method: request.method, headers, ...(request.method !== "GET" && request.method !== "HEAD" ? { body: Buffer.concat(chunks) } : {}) }));
    response.writeHead(result.status, Object.fromEntries(result.headers)); response.end(Buffer.from(await result.arrayBuffer()));
  } catch { response.writeHead(500); response.end("Synthetic bridge failed"); }
});
bridge.listen(0, "127.0.0.1"); await once(bridge, "listening"); const address = bridge.address(); assert.ok(address && typeof address !== "string"); const bridgeUrl = "http://127.0.0.1:" + address.port;
const send = (who: Actor, id: string) => fetch(bridgeUrl, { method: "POST", headers: { Authorization: "Bearer " + who.session.access_token, "Content-Type": "application/json" }, body: JSON.stringify({ capture_id: id }) });
const call = (who: Actor, name: string, args: Record<string, unknown> = {}) => rpc(who.db, name, { p_actor_id: who.id, ...args });
async function barrier(encounterId: string, table: "clinical_encounters" | "pets" = "clinical_encounters") {
  const process = spawn("docker", ["exec", "-i", container, "psql", "-X", "-qAt", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], { stdio: ["pipe", "pipe", "pipe"] });
  let output = ""; process.stdout.on("data", (chunk) => { output += chunk; });
  process.stdin.write("begin;select pg_backend_pid();select 1 from " + table + " where id='" + encounterId + "'for update;select 'LOCKED';\n");
  await until(() => output.includes("LOCKED"), "owned canonical source row barrier"); const pid = Number(output.trim().split("\n")[0]);
  return { pid, release: async () => { process.stdin.end("rollback;\n"); await once(process, "exit"); } };
}
async function observe(pid: number, routine: string) {
  await until(() => Number(sql("select count(*)from pg_stat_activity where query like '%" + routine + "%'and wait_event_type='Lock'and " + pid + "=any(pg_blocking_pids(pid));")) > 0, routine + " actual lock wait"); observedWaits++;
}
try {
  check(sql("select count(*)from supabase_migrations.schema_migrations;"), "202");
  const first = await actor(true), staff = await actor(false);
  const client = await rpc(first.db, "save_client", { p_actor_id: first.id, p_client_id: null, p_expected_version: null, p_first_name: "Synthetic", p_last_name: "Calls", p_primary_phone: "+13035555584", p_primary_email: "synthetic-calls-http@example.test", p_preferred_channel: "EMAIL", p_mailing_address: null, p_housecall_address: null });
  const pet = await rpc(first.db, "save_patient", { p_id: null, p_client_id: client.id, p_expected_version: null, p_name: "Synthetic Call Patient", p_species: "Dog", p_breed: "Mixed", p_dob: null, p_birth_date_precision: "unknown", p_color: "", p_sex: "unknown", p_neuter_status: "unknown", p_microchip_id: null, p_archived_at: null, p_deceased_at: null });
  const makeEncounter = () => rpc(first.db, "save_clinical_encounter", { p_id: null, p_pet_id: pet.id, p_expected_version: null, p_visit_at: new Date().toISOString(), p_visit_type: "clinic", p_location: "Synthetic call review", p_subjective: "", p_objective: "", p_assessment: "", p_plan: "" });
  const encounter = await makeEncounter();
  const callUuid = "synthetic-call-" + randomUUID();
  sql("insert into cloudtalk_calls(call_uuid,call_id,direction,external_number,internal_number,started_at,ended_at,duration_seconds,talking_seconds,trusted_number,transcript_ready,last_event_at)values('" + callUuid + "','700013','inbound','+13035555584','+13035550000',now()-interval'2 minutes',now()-interval'1 minute',60,60,true,true,now());");
  const candidates = await call(first, "list_clinical_call_candidates", { p_pet_id: pet.id, p_encounter_id: encounter.id, p_expected_version: 1 }); check(candidates.calls.length, 1); check(candidates.policy.status, "draft");
  const candidate = candidates.calls[0];
  const intent = { pet_id: pet.id, expected_pet_version: 1, encounter_id: encounter.id, expected_encounter_version: 1, inbound_id: candidate.inbound_id, expected_inbound_version: candidate.inbound_version, policy_version: 2, attest_authorized: true };
  const reserve = (id: string, request = intent) => call(first, "reserve_clinical_call_capture", { p_id: id, p_request: request });
  const read = (id: string, who = first) => call(who, "read_clinical_call_capture", { p_id: id });
  await assert.rejects(reserve(randomUUID())); apiChecks++;
  await call(first, "save_clinical_call_policy", { p_id: randomUUID(), p_request: { expected_version: 1, status: "approved", consent_text: "Synthetic local approval only", retention_text: "Synthetic local retention only", attest_reviewed: true } });
  const id = randomUUID(); await reserve(id); check((await reserve(id)).action.id, id);
  enabled = false; check((await send(first, id)).status, 503); check(providerRequests, 0); enabled = true;
  loseFinish = true; const response = await send(first, id); check(response.status, 200); const saved = callCaptureReadSchema.parse(await response.json()); assert.ok(saved.source); check(saved.source.document.segments.length, 101); check(new Date(saved.source.context.call_ended_at).getTime() < new Date(saved.source.document.captured_from).getTime(), true); check(providerRequests, 4); check(finishRequests, 2);
  check((await send(first, id)).status, 200); check(providerRequests, 4);
  await assert.rejects(read(id, staff)); await assert.rejects(call(staff, "read_clinical_call_source", { p_id: id })); apiChecks += 2;
  check((await send(staff, id)).status, 409); check(providerRequests, 4);
  const canceled = randomUUID(); await call(first, "cancel_clinical_call_capture", { p_id: canceled }); await assert.rejects(reserve(canceled)); apiChecks++;
  await assert.rejects(reserve(randomUUID(), { ...intent, expected_encounter_version: 2 })); apiChecks++;
  const orphan = randomUUID(); await reserve(orphan); const beforeOrphan = providerRequests; loseDispatch = true;
  check((await send(first, orphan)).status, 409); check((await read(orphan)).action.state, "capturing"); check(providerRequests, beforeOrphan);
  // Owned fixture expires the lease rather than sleeping or changing production clocks.
  sql("update clinical_call_capture_actions set lease_until=clock_timestamp()-interval'1 second'where id='" + orphan + "';");
  const expired = await read(orphan); check(expired.action.state, "failed"); check(expired.action.error_code, "capture_unconfirmed"); check(expired.source, null); check(providerRequests, beforeOrphan);
  sql("update cloudtalk_calls set trusted_number=false where call_uuid='" + callUuid + "';");
  await assert.rejects(read(id)); await assert.rejects(call(first, "read_clinical_call_source", { p_id: id })); apiChecks += 2;
  check((await call(first, "list_clinical_call_sources", { p_pet_id: pet.id })).sources.length, 0);
  sql("update cloudtalk_calls set trusted_number=true where call_uuid='" + callUuid + "';"); check((await read(id)).source.id, id);
  // Actual PostgREST lock wait: demotion while a dispatched capture waits to finish must prevent source retention.
  const otherAdmin = await actor(true), race = randomUUID();
  await call(otherAdmin, "reserve_clinical_call_capture", { p_id: race, p_request: intent });
  let releaseProvider!: () => void; providerHold = new Promise<void>((resolve) => { releaseProvider = resolve; }); const beforeRace = providerRequests;
  const racingCapture = send(otherAdmin, race); await until(() => providerRequests > beforeRace, "provider request admitted");
  const held = await barrier(encounter.id); providerHold = null; releaseProvider(); await observe(held.pid, "finish_clinical_call_capture");
  sql("delete from user_roles where user_id='" + otherAdmin.id + "'and role='ADMIN';"); await held.release(); check((await racingCapture).status, 409); check(sql("select count(*)from clinical_call_sources where capture_id='" + race + "';"), "0");
  const reader = await actor(true), readBarrier = await barrier(pet.id, "pets");
  const providerBeforeRead = providerRequests;
  const blockedRead = call(reader, "read_clinical_call_source", { p_id: id }).then(() => "returned_source", (failure) => failure.code);
  await observe(readBarrier.pid, "read_clinical_call_source");
  sql("delete from auth.sessions where user_id='" + reader.id + "';"); await readBarrier.release();
  check(await blockedRead, "42501"); check(providerRequests, providerBeforeRead);
  check(sql("select count(*)from clinical_note_jobs where pet_id='" + pet.id + "';"), "0"); check(sql("select subjective from clinical_encounters where id='" + encounter.id + "';"), "");
  const browserProof = await proveClinicalCallBrowser({ status, session: first.session, petId: pet.id, encounterId: encounter.id, bridgeUrl, evidenceBase, expectedTranscriptText: providerPage(101, 0).data.segments[0].text, expectedSegmentCount: 101, staffSession: staff.session });
  const snapshot = "select jsonb_build_object('policies',(select jsonb_agg(to_jsonb(t)order by version)from clinical_call_policies t),'policy_actions',(select jsonb_agg(to_jsonb(t)order by id)from clinical_call_policy_actions t),'actions',(select jsonb_agg(to_jsonb(t)order by id)from clinical_call_capture_actions t),'sources',(select jsonb_agg(to_jsonb(t)order by id)from clinical_call_sources t));";
  const before = JSON.parse(sql(snapshot));
  const catalog = "select jsonb_build_object('routines',(select jsonb_agg(jsonb_build_object('name',p.oid::regprocedure::text,'body',pg_get_functiondef(p.oid),'acl',p.proacl,'owner',p.proowner)order by p.oid::regprocedure::text)from pg_proc p where p.pronamespace='public'::regnamespace and(p.proname like'clinical_call_%'or p.proname like'%clinical_call_%')),'relations',(select jsonb_agg(jsonb_build_object('name',relname,'rls',relrowsecurity,'acl',(select jsonb_agg(jsonb_build_object('grantee',a.grantee,'grantor',a.grantor,'privilege',a.privilege_type,'grantable',a.is_grantable)order by a.grantee,a.grantor,a.privilege_type)from aclexplode(coalesce(relacl,acldefault('r',relowner)))a),'owner',relowner)order by relname)from pg_class where relnamespace='public'::regnamespace and relname like'clinical_call_%'and relkind='r'),'triggers',(select jsonb_agg(pg_get_triggerdef(t.oid)order by c.relname,t.tgname)from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace='public'::regnamespace and c.relname like'clinical_call_%'and not t.tgisinternal));";
  const beforeCatalog = JSON.parse(sql(catalog));
  let dump = execFileSync("docker", ["exec", container, "pg_dump", "-U", "postgres", "--no-owner", "--schema=public", "--schema=auth", "--schema=storage", "--schema=extensions", "postgres"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
  dump = dump.split("\n").filter((line) => !line.startsWith("ALTER DEFAULT PRIVILEGES")).join("\n").replace("CREATE SCHEMA extensions;", "CREATE SCHEMA IF NOT EXISTS extensions;");
  const clone = "owned_call_restore_" + randomUUID().replaceAll("-", "").slice(0, 10), marker = randomUUID(); sql("create database " + clone + ";comment on database " + clone + " is '" + marker + "';");
  try {
    sql('drop schema public;create schema extensions;create extension pgcrypto with schema extensions;create extension "uuid-ossp"with schema extensions;', clone); sql(dump, clone);
    assert.deepEqual(JSON.parse(sql(snapshot, clone)), before); restoreChecks++;
    assert.deepEqual(JSON.parse(sql(catalog, clone)), beforeCatalog); restoreChecks++;
    const claims = JSON.parse(Buffer.from(first.session.access_token.split(".")[1], "base64url").toString());
    const restored = JSON.parse(sql("begin;set local role authenticated;select set_config('request.jwt.claims','" + JSON.stringify(claims).replaceAll("'", "''") + "',true);select read_clinical_call_source('" + first.id + "','" + id + "');rollback;", clone).split("\n").at(-1)!);
    check(restored.sha256, saved.source.sha256); restoreChecks++;
    assert.deepEqual(JSON.parse(sql(snapshot)), before); restoreChecks++;
  } finally { assert.equal(sql("select shobj_description(oid,'pg_database')from pg_database where datname='" + clone + "';"), marker); sql("drop database " + clone + " with(force);"); restoreChecks++; }
  sql("delete from auth.sessions where user_id='" + first.id + "';"); await assert.rejects(read(id)); apiChecks++;
  const proof = { apiAssertions: apiChecks, restoreAssertions: restoreChecks, observedLockWaits: observedWaits, fakeProviderRequests: providerRequests, realProviderRequests: 0, apiSourceId: id, apiSourceHash: saved.source.sha256, browser: browserProof };
  writeFileSync(evidenceBase + "-roundtrip.json", JSON.stringify(proof, null, 2) + "\n", { mode: 0o600 }); console.log(JSON.stringify(proof));
} finally { bridge.closeAllConnections(); await new Promise<void>((resolve) => bridge.close(() => resolve())); }
