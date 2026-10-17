/** Synthetic, uniquely owned Auth/HTTP/browser/restore verification. No real provider calls. */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import {
  createClient,
  type Session,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { chromium } from "playwright";
import { parseOwnedRuntimeStatus } from "../estimates/owned-runtime-status.ts";
import { createClinicalRecapHandler } from "../../supabase/functions/_shared/clinical-recap-handler.ts";
import {
  recapJobReadSchema,
} from "../../supabase/functions/_shared/clinical-recap-model.ts";

const project = process.env.RECAP_TEST_PROJECT;
assert.ok(project && process.env.RECAP_RUN_SYNTHETIC_LOCAL === "true");
const evidencePrefix = process.env.RECAP_EVIDENCE_PREFIX ?? "clinical-recap";
assert.match(evidencePrefix, /^[a-z0-9][a-z0-9-]{0,79}$/, "Invalid local evidence prefix.");
const evidenceBase = `tmp/${evidencePrefix}`;
const browserEvidence = `${evidenceBase}-browser`;
const identity = readFileSync(project + "/supabase/config.toml", "utf8").match(
  /^project_id = "(lrv-clinical-recap-[a-f0-9]+)"/m,
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
assert.equal(status.API_URL, "http://127.0.0.1:65221");
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

let apiChecks = 0, browserChecks = 0, restoreChecks = 0, providerRequests = 0, finishRequests = 0;
const check = (actual: unknown, expected: unknown) => { assert.deepEqual(actual, expected); apiChecks++; };
const browserCheck = (actual: unknown, expected: unknown) => { assert.deepEqual(actual, expected); browserChecks++; };
const restoreCheck = (actual: unknown, expected: unknown) => { assert.deepEqual(actual, expected); restoreChecks++; };
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(test: () => boolean | Promise<boolean>, label: string) {
  for (let i = 0; i < 600; i++) { if (await test()) return; await pause(25); }
  throw Error("Did not observe " + label);
}
const fictional = "FICTIONAL TEST ONLY. Owner reports cough for two days. CBC was discussed but declined; not performed.";
let loseFinishAck = false, processingEnabled = true, providerHold: Promise<void> | null = null;
const handler = createClinicalRecapHandler({
  get enabled() { return processingEnabled; },
  apiKey: "owned-stub-only",
  authenticate: async (token) => {
    const { data, error } = await service.auth.getUser(token);
    if (error || !data.user) return null;
    const actorId = data.user.id;
    const db = createClient(status.API_URL, status.ANON_KEY, {
      ...options, global: { headers: { Authorization: "Bearer " + token } },
    });
    return {
      actorId,
      read: (id: string) => rpc(db, "read_clinical_recap_job", { p_actor_id: actorId, p_id: id }),
      claim: (args: Record<string, unknown>) => rpc(db, "claim_clinical_recap", args),
    };
  },
  dispatch: (id: string) => rpc(service, "dispatch_clinical_recap", { p_id: id }),
  finish: async (id: string, result: unknown) => {
    finishRequests++;
    const saved = await rpc(service, "finish_clinical_recap", { p_id: id, p_result: result });
    if (loseFinishAck) { loseFinishAck = false; throw Error("Dropped committed synthetic result response"); }
    return saved;
  },
  fail: async (id: string, uncertain: boolean, code: string, details: unknown) => {
    await rpc(service, "fail_clinical_recap", { p_id: id, p_uncertain: uncertain, p_code: code, p_details: details ?? {} });
  },
  providerFetch: async (url: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(url), "https://api.openai.com/v1/responses");
    const request = JSON.parse(String(init?.body));
    assert.equal(request.store, false);
    assert.equal(request.stream, false);
    assert.equal(request.background, false);
    providerRequests++;
    if (providerHold) await providerHold;
    const payload = {
      claims: [{
        claim_id: "claim_001", category: "history", temporal_status: "historical",
        text: "The owner reported cough for two days.", uncertainty: "",
        citations: [{ source_ref: "src_0001", field_path: "fields.subjective", quote: "Owner reports cough for two days." }],
      }],
      review_flags: ["Declined CBC was not performed; this recap does not establish current health."],
    };
    return new Response(JSON.stringify({
      id: "synthetic-" + randomUUID(), model: "synthetic-model", status: "completed", error: null, incomplete_details: null,
      output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(payload) }] }],
    }), { headers: { "content-type": "application/json", "x-request-id": "synthetic-recap-request" } });
  },
});
const bridge = createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) if (typeof value === "string") headers.set(key, value);
    const response = await handler(new Request("http://localhost/process", {
      method: req.method, headers, ...(req.method !== "OPTIONS" ? { body: Buffer.concat(chunks) } : {}),
    }));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch { res.writeHead(500); res.end("{}"); }
});
bridge.listen(0, "127.0.0.1");
await once(bridge, "listening");
const address = bridge.address();
assert.ok(address && typeof address !== "string");
const bridgeUrl = "http://127.0.0.1:" + address.port + "/process";
const intent = (job_id: string) => ({ job_id, attempt_id: randomUUID(), retry_of: null, reason: "", ack_cost: false });
async function send(a: Actor, value: ReturnType<typeof intent>) {
  return fetch(bridgeUrl, {
    method: "POST", headers: { Authorization: "Bearer " + a.session.access_token, "content-type": "application/json", "x-recap-intent": encodeURIComponent(JSON.stringify(value)) }, body: "{}",
  });
}
interface SqlSession {
  process: ReturnType<typeof spawn>;
  output: () => string;
  release: (commit?: boolean) => Promise<void>;
}
function sqlSession(): SqlSession {
  const process = spawn("docker", ["exec", "-i", container, "psql", "-X", "-qAt", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], { stdio: ["pipe", "pipe", "pipe"] });
  let output = "", failure = "";
  process.stdout!.on("data", (d) => { output += d.toString(); });
  process.stderr!.on("data", (d) => { failure += d.toString(); });
  return { process, output: () => output, release: async (commit = true) => {
    if (process.exitCode !== null) { assert.equal(process.exitCode, 0, failure); return; }
    const exited = once(process, "exit");
    process.stdin!.end(commit ? "commit;\n" : "rollback;\n");
    const [code] = await exited;
    assert.equal(code, 0, failure);
  } };
}
async function sourceBarrier(pet: string) {
  const session = sqlSession();
  session.process.stdin!.write("begin;set application_name='owned-recap-source-blocker';select pg_backend_pid();select pg_advisory_xact_lock(hashtextextended('clinical-recap-source:" + pet + "',0));select 'LOCKED';\n");
  await until(() => session.output().includes("LOCKED"), "owned source lock");
  const pid = Number(session.output().trim().split("\n")[0]);
  assert.ok(pid > 0);
  return { ...session, pid };
}
const observedWaits: { label: string; blocker: number; waiter: number }[] = [];
async function observeWait(blocker: number, needle: string, label: string) {
  let waiter = 0;
  await until(() => {
    waiter = Number(sql("select coalesce((select a.pid from pg_stat_activity a where a.wait_event_type='Lock' and a.query like '%" + needle + "%' and " + blocker + "=any(pg_blocking_pids(a.pid))and exists(select 1 from pg_locks l where l.pid=a.pid and not l.granted)limit 1),0);"));
    return waiter > 0;
  }, label);
  observedWaits.push({ label, blocker, waiter });
}

let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
let vite: ReturnType<typeof spawn> | null = null;
mkdirSync(browserEvidence, { recursive: true, mode: 0o700 });
try {
  check(sql("select count(*)from supabase_migrations.schema_migrations;"), "201");
  const first = await actor(true), second = await actor(false);
  const policyRead = (a = first) => rpc(a.db, "read_clinical_recap_policy", { p_actor_id: a.id });
  const initialPolicy = (await policyRead()).policy;
  check(initialPolicy.status, "draft");
  const policyRequest = { expected_version: initialPolicy.version, status: "approved", consent_text: "SYNTHETIC ONLY. Authorized fictional native records; every cited claim receives staff review.", retention_text: "SYNTHETIC ONLY. Retain private source snapshots and review receipts.", attest_reviewed: true };
  await assert.rejects(rpc(second.db, "save_clinical_recap_policy", { p_actor_id: second.id, p_id: randomUUID(), p_request: policyRequest })); apiChecks++;
  const policyAction = randomUUID();
  const receipt = await rpc(first.db, "save_clinical_recap_policy", { p_actor_id: first.id, p_id: policyAction, p_request: policyRequest });
  check(await rpc(first.db, "recover_clinical_recap_policy", { p_actor_id: first.id, p_id: policyAction }), receipt);
  let policy = receipt.policy;
  const client = (await rpc(first.db, "save_client", { p_actor_id: first.id, p_client_id: null, p_expected_version: null, p_first_name: "Synthetic", p_last_name: "Recap", p_primary_phone: "+13035555582", p_primary_email: "synthetic-recap@example.test", p_preferred_channel: "EMAIL", p_housecall_address: null, p_mailing_address: null })).id;
  async function patient(name: string) {
    return (await rpc(first.db, "save_patient", { p_id: null, p_client_id: client, p_expected_version: null, p_name: name, p_species: "Dog", p_breed: "Mixed", p_dob: null, p_birth_date_precision: "unknown", p_color: "", p_sex: "unknown", p_neuter_status: "unknown", p_microchip_id: null, p_archived_at: null, p_deceased_at: null })).id as string;
  }
  async function encounter(pet: string) {
    const row = await rpc(first.db, "save_clinical_encounter", { p_id: null, p_pet_id: pet, p_expected_version: null, p_visit_at: "2026-10-01T18:00:00.000Z", p_visit_type: "clinic", p_location: "Synthetic clinic", p_subjective: fictional, p_objective: "Examination not documented.", p_assessment: "Historical cough; cause uncertain.", p_plan: "Owner declined CBC." });
    return rpc(first.db, "sign_clinical_encounter", { p_id: row.id, p_expected_version: row.version });
  }
  const pet = await patient("Synthetic API Recap"), uiPet = await patient("Synthetic Browser Recap");
  const signed = await encounter(pet), uiSigned = await encounter(uiPet);
  const selection = { encounter_ids: [signed.id], include_native_problems: false, visit_from: null, visit_to: null };
  const preview = (selected = selection, patientId = pet, a = first) => rpc(a.db, "preview_clinical_recap", { p_actor_id: a.id, p_pet_id: patientId, p_selection: selected });
  const source = await preview();
  check(source.source_set.budgets.encounters, 1);
  check(source.source_set.membership.native_problem_ids, null);
  const requestFor = (snapshot = source, patientId = pet, selected = selection) => ({ pet_id: patientId, expected_pet_version: snapshot.source_set.patient.version, policy_version: policy.version, selection: selected, expected_source_fingerprint: snapshot.source_fingerprint, source_note: "Fictional owned recap test", attest_authorized: true, previous_job_id: null });
  const reserve = (id: string, request = requestFor(), a = first) => rpc(a.db, "reserve_clinical_recap", { p_actor_id: a.id, p_id: id, p_request: request });
  const read = (id: string, a = first) => rpc(a.db, "read_clinical_recap_job", { p_actor_id: a.id, p_id: id });
  const jobId = randomUUID();
  const concurrent = await Promise.all([reserve(jobId), reserve(jobId)]);
  check(concurrent[0].job.id, concurrent[1].job.id);
  check(concurrent[0].manifest.sha256, concurrent[1].manifest.sha256);
  recapJobReadSchema.parse(concurrent[0]);
  await assert.rejects(reserve(jobId, { ...requestFor(), source_note: "Different intent" })); apiChecks++;
  const abandoned = randomUUID();
  check((await rpc(first.db, "cancel_clinical_recap_reservation", { p_actor_id: first.id, p_id: abandoned })).cancelled, true);
  await assert.rejects(reserve(abandoned)); apiChecks++;
  const canonical = () => sql("create temp table recap_canonical(name text,value jsonb);do $$declare r record;v jsonb;begin for r in select c.relname from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in('r','p')and c.relname not like 'clinical_recap_%'order by c.relname loop execute format('select jsonb_build_object(''count'',count(*),''hash'',md5(coalesce(string_agg(to_jsonb(t)::text,''|''order by to_jsonb(t)::text),'''')))from public.%I t',r.relname)into v;insert into recap_canonical values(r.relname,v);end loop;end$$;select jsonb_object_agg(name,value)from recap_canonical;");
  const beforeRecap = canonical();
  let releaseProvider = () => {};
  providerHold = new Promise<void>((resolve) => { releaseProvider = resolve; });
  const firstIntent = intent(jobId), running = send(first, firstIntent);
  await until(() => providerRequests === 1, "first recap provider request");
  check((await send(first, firstIntent)).status, 200);
  check(providerRequests, 1);
  providerHold = null; releaseProvider();
  const generated = await running;
  check(generated.status, 200);
  const output = recapJobReadSchema.parse(await generated.json());
  assert.ok(output.output);
  check(output.output.payload.claims[0].citations[0].quote, "Owner reports cough for two days.");
  check((await send(first, firstIntent)).status, 200);
  check(providerRequests, 1);
  const cited = await rpc(second.db, "read_clinical_recap_citation", { p_actor_id: second.id, p_job_id: jobId, p_source_ref: "src_0001" });
  check(cited.source.fields.subjective, fictional);
  check(cited.current.source_status, "current");
  const reviewRequest = { job_id: jobId, output_id: output.output.id, expected_output_hash: output.output.payload_sha256, expected_review_version: 1, manifest_sha256: output.manifest.sha256, decision: "accepted", accepted_claims: [{ claim_id: "claim_001", text: "Owner reported a two-day cough at the recorded visit." }], review_note: "Fictional reviewed wording", attest_reviewed: true };
  const reviewId = randomUUID();
  const review = await rpc(second.db, "save_clinical_recap_review", { p_actor_id: second.id, p_id: reviewId, p_request: reviewRequest });
  check(review.review.accepted_claims[0].proposed_text, output.output.payload.claims[0].text);
  check(review.review.accepted_claims[0].reviewed_text, reviewRequest.accepted_claims[0].text);
  check(await rpc(second.db, "recover_clinical_recap_review", { p_actor_id: second.id, p_id: reviewId, p_job_id: jobId }), review);
  await assert.rejects(rpc(first.db, "save_clinical_recap_review", { p_actor_id: first.id, p_id: randomUUID(), p_request: reviewRequest })); apiChecks++;
  check(canonical(), beforeRecap);
  const secondJob = randomUUID(); await reserve(secondJob);
  loseFinishAck = true;
  const finishBefore = finishRequests;
  check((await send(first, intent(secondJob))).status, 200);
  check(finishRequests - finishBefore, 2);
  check(providerRequests, 2);
  // An omitted problem group must not stale the chosen encounter-only capture.
  const problem = await rpc(first.db, "save_patient_problem", { p_id: null, p_pet_id: pet, p_expected_version: null, p_title: "Historical vaccine reaction", p_notes: "Fictional owner-reported history", p_onset_date: null, p_status: "active", p_importance: "high" });
  check((await read(jobId)).current.source_status, "current");
  // A real writer holds native locks then reaches the epoch. Reader must wait and capture its committed data.
  const allSelection = { ...selection, include_native_problems: true };
  const old = await preview(allSelection);
  const claims = JSON.parse(Buffer.from(first.session.access_token.split(".")[1], "base64url").toString());
  const nativeAuth = "select set_config('request.jwt.claims','" + JSON.stringify(claims).replaceAll("'", "''") + "',true);";
  const editProblem = (notes: string, version: number) => "select public.save_patient_problem('" + problem.id + "','" + pet + "'," + version + ",'Historical vaccine reaction','" + notes + "',null,'active','high');";
  const writer = sqlSession();
  writer.process.stdin!.write("begin;set application_name='owned-recap-real-writer';select pg_backend_pid();" + nativeAuth + editProblem("Updated fictional history", problem.version) + "select 'LOCKED';\n");
  await until(() => writer.output().includes("LOCKED"), "writer holds source epoch");
  const writerPid = Number(writer.output().trim().split("\n")[0]);
  const waitingPreview = preview(allSelection);
  await observeWait(writerPid, "preview_clinical_recap", "writer-first fresh source capture");
  await writer.release();
  const fresh = await waitingPreview;
  assert.notEqual(fresh.source_fingerprint, old.source_fingerprint); apiChecks++;
  check(fresh.source_set.sources.find((s: { kind: string }) => s.kind === "native_problem").fields.notes, "Updated fictional history");
  await assert.rejects(reserve(randomUUID(), requestFor(old, pet, allSelection))); apiChecks++;
  // Reader owns epoch while writer holds native row locks: capture may read the prior committed snapshot without deadlock.
  const blocker = await sourceBarrier(pet);
  const pendingWriter = sqlSession();
  pendingWriter.process.stdin!.write("begin;set application_name='owned-recap-blocked-writer';" + nativeAuth + editProblem("Later fictional history", problem.version + 1) + "select 'UPDATED';\n");
  await observeWait(blocker.pid, "Later fictional history", "reader-first native writer waits at epoch");
  // Same blocker transaction runs capture on its own lock; no native FOR SHARE/FK lock may be taken.
  blocker.process.stdin!.write("select public.clinical_recap_collect('" + pet + "','" + JSON.stringify(allSelection).replaceAll("'", "''") + "'::jsonb);select 'CAPTURED';\n");
  await until(() => blocker.output().includes("CAPTURED"), "reader capture without native-lock deadlock");
  await blocker.release();
  await until(() => pendingWriter.output().includes("UPDATED"), "released real source writer");
  await pendingWriter.release();
  // Addendum membership changes stale the whole manifest, while frozen citation content remains unchanged.
  await rpc(first.db, "add_clinical_addendum", { p_encounter_id: signed.id, p_content: "Fictional later correction: cough duration was owner reported, not examined." });
  const stale = await read(jobId);
  check(stale.current.source_status, "stale");
  check(stale.current.reasons.includes("addenda_changed"), true);
  const frozen = await rpc(first.db, "read_clinical_recap_citation", { p_actor_id: first.id, p_job_id: jobId, p_source_ref: "src_0001" });
  check(frozen.source.fields.subjective, fictional);
  const unreviewed = await read(secondJob);
  await assert.rejects(rpc(first.db, "save_clinical_recap_review", { p_actor_id: first.id, p_id: randomUUID(), p_request: { ...reviewRequest, job_id: secondJob, output_id: unreviewed.output.id, expected_output_hash: unreviewed.output.payload_sha256, manifest_sha256: unreviewed.manifest.sha256 } })); apiChecks++;
  const rejected = await rpc(first.db, "save_clinical_recap_review", { p_actor_id: first.id, p_id: randomUUID(), p_request: { ...reviewRequest, job_id: secondJob, output_id: unreviewed.output.id, expected_output_hash: unreviewed.output.payload_sha256, manifest_sha256: unreviewed.manifest.sha256, decision: "rejected", accepted_claims: [], review_note: "Source changed; retain old evidence, do not accept." } });
  check(rejected.review.decision, "rejected");
  const addendumWriter = sqlSession();
  addendumWriter.process.stdin!.write("begin;set application_name='owned-recap-addendum-writer';select pg_backend_pid();" + nativeAuth + "select public.add_clinical_addendum('" + signed.id + "','Fictional second appended correction after the selected visit date.');select 'LOCKED';\n");
  await until(() => addendumWriter.output().includes("LOCKED"), "native addendum writer holds epoch");
  const addendumPid = Number(addendumWriter.output().trim().split("\n")[0]);
  const pendingAddenda = preview(selection);
  await observeWait(addendumPid, "preview_clinical_recap", "new addendum phantom included after writer commit");
  await addendumWriter.release();
  const completeAddenda = await pendingAddenda;
  check(completeAddenda.source_set.sources.filter((s: { kind: string }) => s.kind === "addendum").length, 2);
  check(completeAddenda.source_set.membership.addenda_by_encounter[0].source_ids.length, 2);
  const uiSelection = { ...selection, encounter_ids: [uiSigned.id] };
  const uiSnapshot = await preview(uiSelection, uiPet);
  const uiRequest = () => requestFor(uiSnapshot, uiPet, uiSelection);
  // Explicit cancellation wins over a delayed first request while the independent processing gate is off.
  const disabledJob = randomUUID(); await reserve(disabledJob, uiRequest());
  const disabledIntent = intent(disabledJob);
  processingEnabled = false;
  const disabled = await send(first, disabledIntent);
  check(disabled.status, 503);
  check((await disabled.json()).error.code, "processing_disabled");
  const cancelledAttempt = await rpc(first.db, "cancel_clinical_recap_attempt", { p_actor_id: first.id, p_id: disabledIntent.attempt_id, p_job_id: disabledJob, p_retry_of: null, p_reason: "", p_ack_cost: false });
  check(cancelledAttempt.cancelled, true);
  processingEnabled = true;
  const paidBeforeCancellation = providerRequests;
  check((await send(first, disabledIntent)).status, 409);
  check(providerRequests, paidBeforeCancellation);

  // The original session is checked after an observed policy-lock wait, before paid dispatch.
  const revoked = await actor(false), revokedJob = randomUUID(), revokedAttempt = randomUUID();
  await reserve(revokedJob, uiRequest(), revoked);
  await rpc(revoked.db, "claim_clinical_recap", { p_actor_id: revoked.id, p_id: revokedAttempt, p_job_id: revokedJob, p_retry_of: null, p_reason: "", p_ack_cost: false });
  const policyBlocker = sqlSession();
  policyBlocker.process.stdin!.write("begin;set application_name='owned-recap-policy-blocker';select pg_backend_pid();select pg_advisory_xact_lock(hashtextextended('clinical-recap-policy',0));select 'LOCKED';\n");
  await until(() => policyBlocker.output().includes("LOCKED"), "owned recap policy barrier");
  const policyPid = Number(policyBlocker.output().trim().split("\n")[0]);
  const pendingDispatch = rpc(service, "dispatch_clinical_recap", { p_id: revokedAttempt }).then((value) => ({ value, denied: false }), () => ({ value: false, denied: true }));
  await observeWait(policyPid, "dispatch_clinical_recap", "revoked originating session after policy wait");
  sql("delete from auth.sessions where user_id='" + revoked.id + "';");
  await policyBlocker.release();
  const dispatchOutcome = await pendingDispatch;
  check(dispatchOutcome.denied || dispatchOutcome.value === false, true);
  // A worker must revalidate both originating sessions even when capture and attempt used different logins.
  for (const revokedSide of ["job", "attempt"] as const) {
    const author = await actor(false), separateJob = randomUUID();
    await reserve(separateJob, uiRequest(), author);
    const operator = await author.signInAgain(), separateAttempt = randomUUID();
    const jobSession = JSON.parse(Buffer.from(author.session.access_token.split(".")[1], "base64url").toString()).session_id;
    const attemptSession = JSON.parse(Buffer.from(operator.session.access_token.split(".")[1], "base64url").toString()).session_id;
    assert.notEqual(jobSession, attemptSession); apiChecks++;
    await rpc(operator.db, "claim_clinical_recap", { p_actor_id: operator.id, p_id: separateAttempt, p_job_id: separateJob, p_retry_of: null, p_reason: "", p_ack_cost: false });
    const barrier = sqlSession();
    barrier.process.stdin!.write("begin;select pg_backend_pid();select pg_advisory_xact_lock(hashtextextended('clinical-recap-policy',0));select 'LOCKED';\n");
    await until(() => barrier.output().includes("LOCKED"), "separate-session policy barrier");
    const barrierPid = Number(barrier.output().trim().split("\n")[0]);
    const dispatch = rpc(service, "dispatch_clinical_recap", { p_id: separateAttempt }).then(() => "admitted", (error) => error.code);
    await observeWait(barrierPid, "dispatch_clinical_recap", "revoked distinct " + revokedSide + " session after wait");
    sql("delete from auth.sessions where id='" + (revokedSide === "job" ? jobSession : attemptSession) + "';");
    await barrier.release();
    check(await dispatch, "PT403");
    check(sql("select state from clinical_recap_attempts where id='" + separateAttempt + "';"), "claimed");
  }

  // A policy change during a received response retains only sanitized metadata, never raw claims.
  const policyRaceJob = randomUUID(); await reserve(policyRaceJob, uiRequest());
  const beforePolicyProvider = providerRequests;
  providerHold = new Promise<void>((resolve) => { releaseProvider = resolve; });
  const policyRaceIntent = intent(policyRaceJob), policyRaceResponse = send(first, policyRaceIntent);
  await until(() => providerRequests === beforePolicyProvider + 1, "policy race provider admission");
  const changed = await rpc(first.db, "save_clinical_recap_policy", { p_actor_id: first.id, p_id: randomUUID(), p_request: { ...policyRequest, expected_version: policy.version, status: "draft", attest_reviewed: false } });
  providerHold = null; releaseProvider();
  const sanitized = await policyRaceResponse;
  check(sanitized.status, 409);
  check((await sanitized.json()).error.code, "policy_changed");
  check((await read(policyRaceJob)).output, null);
  check(sql("select count(*)from clinical_recap_outputs where job_id='" + policyRaceJob + "';"), "0");
  policy = (await rpc(first.db, "save_clinical_recap_policy", { p_actor_id: first.id, p_id: randomUUID(), p_request: { ...policyRequest, expected_version: changed.policy.version } })).policy;

  const changingPet = await patient("Synthetic source-change recap"), changingEncounter = await encounter(changingPet);
  const changingSelection = { ...selection, encounter_ids: [changingEncounter.id] };
  const changingSnapshot = await preview(changingSelection, changingPet), changingJob = randomUUID();
  await reserve(changingJob, requestFor(changingSnapshot, changingPet, changingSelection));
  const sourceRaceBefore = providerRequests;
  providerHold = new Promise<void>((resolve) => { releaseProvider = resolve; });
  const sourceRaceResponse = send(first, intent(changingJob));
  await until(() => providerRequests === sourceRaceBefore + 1, "source-change provider admission");
  await rpc(first.db, "add_clinical_addendum", { p_encounter_id: changingEncounter.id, p_content: "Fictional subsequent clarification while generation was running." });
  providerHold = null; releaseProvider();
  const sourceRace = await sourceRaceResponse;
  check(sourceRace.status, 200);
  const retainedStale = recapJobReadSchema.parse(await sourceRace.json());
  check(retainedStale.current.source_status, "stale");
  assert.ok(retainedStale.output); apiChecks++;
  check(retainedStale.manifest.source_set.sources.length, 1);

  const offboarded = await actor(false), offboardedJob = randomUUID();
  await reserve(offboardedJob, uiRequest(), offboarded);
  const offboardedBefore = providerRequests;
  providerHold = new Promise<void>((resolve) => { releaseProvider = resolve; });
  const offboardedResponse = send(offboarded, intent(offboardedJob));
  await until(() => providerRequests === offboardedBefore + 1, "offboarding provider admission");
  sql("delete from auth.sessions where user_id='" + offboarded.id + "';");
  providerHold = null; releaseProvider();
  check((await offboardedResponse).status, 403);
  check((await read(offboardedJob)).output, null);
  check(sql("select count(*)from clinical_recap_outputs where job_id='" + offboardedJob + "';"), "0");

  const cancelRaceJob = randomUUID(), cancelRaceIntent = intent(cancelRaceJob);
  await reserve(cancelRaceJob, uiRequest());
  const jobBarrier = sqlSession();
  jobBarrier.process.stdin!.write("begin;set application_name='owned-recap-job-blocker';select pg_backend_pid();select id from clinical_recap_jobs where id='" + cancelRaceJob + "'for update;select 'LOCKED';\n");
  await until(() => jobBarrier.output().includes("LOCKED"), "owned job-row barrier");
  const jobBarrierPid = Number(jobBarrier.output().trim().split("\n")[0]);
  const cancelRaceArgs = { p_actor_id: first.id, p_id: cancelRaceIntent.attempt_id, p_job_id: cancelRaceJob, p_retry_of: null, p_reason: "", p_ack_cost: false };
  const concurrentCancel = Promise.allSettled([rpc(first.db, "claim_clinical_recap", cancelRaceArgs), rpc(first.db, "cancel_clinical_recap_attempt", cancelRaceArgs)]);
  await observeWait(jobBarrierPid, "clinical_recap", "claim and cancel contend on actual job row");
  await jobBarrier.release();
  const canceledRace = await concurrentCancel;
  check(canceledRace[1].status, "fulfilled");
  if (canceledRace[1].status === "fulfilled") check(canceledRace[1].value.cancelled, true);
  const beforeLateClaim = providerRequests;
  check((await send(first, cancelRaceIntent)).status, 409);
  check(providerRequests, beforeLateClaim);

  // An owner-inserted short-lived synthetic attempt tests expiry across an observed wait without editing immutable identities.
  const expiringJob = randomUUID(), expiringAttempt = randomUUID();
  const expiringCapture = await reserve(expiringJob, uiRequest());
  const expires = Number(sql("insert into clinical_recap_attempts(id,job_id,actor_id,session_id,sequence,model,state,intent,lease_until)values('" + expiringAttempt + "','" + expiringJob + "','" + first.id + "','" + claims.session_id + "',1,'gpt-6-luna','sending','" + JSON.stringify({ job_id: expiringJob, retry_of: null, reason: "", ack_cost: false }) + "',clock_timestamp()+interval'5 seconds')returning(extract(epoch from lease_until)*1000)::bigint;"));
  const leaseBarrier = await sourceBarrier(uiPet);
  const expiringResult = { ...output.output.provider_manifest, manifest_sha256: expiringCapture.manifest.sha256, payload: output.output.payload };
  const finishAfterWait = rpc(service, "finish_clinical_recap", { p_id: expiringAttempt, p_result: expiringResult }).then(() => "completed", (failure) => failure.code);
  await observeWait(leaseBarrier.pid, "finish_clinical_recap", "finish lease expires during source wait");
  await until(() => Date.now() > expires + 50, "synthetic finish lease deadline");
  await leaseBarrier.release();
  check(await finishAfterWait, "PT409");
  check((await read(expiringJob)).output, null);
  await rpc(service, "fail_clinical_recap", { p_id: expiringAttempt, p_uncertain: true, p_code: "result_save_unconfirmed", p_details: {} });
  const retryAttempt = randomUUID();
  await rpc(first.db, "claim_clinical_recap", { p_actor_id: first.id, p_id: retryAttempt, p_job_id: expiringJob, p_retry_of: expiringAttempt, p_reason: "uncertain_outcome_duplicate_charge_authorized", p_ack_cost: true });
  check((await read(expiringJob)).job.attempts.map((a: { id: string }) => a.id), [retryAttempt, expiringAttempt]);
  check(await rpc(service, "dispatch_clinical_recap", { p_id: retryAttempt }), true);
  check(await rpc(service, "dispatch_clinical_recap", { p_id: retryAttempt }), false);
  const allKinds = await preview({ ...selection, include_native_problems: true });
  const allKindsJob = randomUUID();
  await reserve(allKindsJob, requestFor(allKinds, pet, { ...selection, include_native_problems: true }));
  const uncertainAttempt = randomUUID();
  await rpc(first.db, "claim_clinical_recap", { p_actor_id: first.id, p_id: uncertainAttempt, p_job_id: allKindsJob, p_retry_of: null, p_reason: "", p_ack_cost: false });
  await rpc(service, "dispatch_clinical_recap", { p_id: uncertainAttempt });
  await rpc(service, "fail_clinical_recap", { p_id: uncertainAttempt, p_uncertain: true, p_code: "provider_uncertain", p_details: {} });
  const canceledPolicy = randomUUID();
  check((await rpc(first.db, "cancel_clinical_recap_policy", { p_actor_id: first.id, p_id: canceledPolicy })).cancelled, true);
  const reviewRaceJob = randomUUID();
  await reserve(reviewRaceJob, uiRequest());
  const reviewRaceResponse = await send(first, intent(reviewRaceJob));
  check(reviewRaceResponse.status, 200);
  const reviewRaceOutput = recapJobReadSchema.parse(await reviewRaceResponse.json());
  assert.ok(reviewRaceOutput.output);
  const reviewRaceStaff = await actor(false), reviewRaceId = randomUUID();
  const reviewRaceRequest = { ...reviewRequest, job_id: reviewRaceJob, output_id: reviewRaceOutput.output.id, expected_output_hash: reviewRaceOutput.output.payload_sha256, manifest_sha256: reviewRaceOutput.manifest.sha256 };
  const reviewBarrier = sqlSession();
  reviewBarrier.process.stdin!.write("begin;select pg_backend_pid();select pg_advisory_xact_lock(hashtextextended('clinical-recap-policy',0));select 'LOCKED';\n");
  await until(() => reviewBarrier.output().includes("LOCKED"), "review policy barrier");
  const reviewBarrierPid = Number(reviewBarrier.output().trim().split("\n")[0]);
  const pendingReview = rpc(reviewRaceStaff.db, "save_clinical_recap_review", { p_actor_id: reviewRaceStaff.id, p_id: reviewRaceId, p_request: reviewRaceRequest }).then(() => "accepted", (error) => error.code);
  await observeWait(reviewBarrierPid, "save_clinical_recap_review", "reviewer revoked during observed acceptance wait");
  sql("delete from auth.sessions where user_id='" + reviewRaceStaff.id + "';");
  await reviewBarrier.release();
  check(await pendingReview, "PT403");
  check((await read(reviewRaceJob)).review, null);

  const demoted = await actor(true), demotedAction = randomUUID(), demotionBarrier = sqlSession();
  demotionBarrier.process.stdin!.write("begin;select pg_backend_pid();select pg_advisory_xact_lock(hashtextextended('clinical-recap-policy',0));select 'LOCKED';\n");
  await until(() => demotionBarrier.output().includes("LOCKED"), "policy-save demotion barrier");
  const demotionPid = Number(demotionBarrier.output().trim().split("\n")[0]);
  const pendingPolicy = rpc(demoted.db, "save_clinical_recap_policy", { p_actor_id: demoted.id, p_id: demotedAction, p_request: { ...policyRequest, expected_version: policy.version, status: "draft", attest_reviewed: false } }).then(() => "saved", (error) => error.code);
  await observeWait(demotionPid, "save_clinical_recap_policy", "ADMIN demoted during observed policy-save wait");
  sql("delete from user_roles where user_id='" + demoted.id + "'and role='ADMIN';insert into user_roles(user_id,role)values('" + demoted.id + "','STAFF')on conflict do nothing;");
  await demotionBarrier.release();
  check(await pendingPolicy, "PT403");
  check(await rpc(demoted.db, "recover_clinical_recap_policy", { p_actor_id: demoted.id, p_id: demotedAction }), null);
  check((await rpc(demoted.db, "cancel_clinical_recap_policy", { p_actor_id: demoted.id, p_id: demotedAction })).cancelled, true);
  const historicalPet = await patient("Synthetic historical recap patient"), historicalEncounter = await encounter(historicalPet);
  const historicalSelection = { ...selection, encounter_ids: [historicalEncounter.id] };
  const historicalBefore = await preview(historicalSelection, historicalPet);
  await rpc(first.db, "save_patient", { p_id: historicalPet, p_client_id: client, p_expected_version: historicalBefore.source_set.patient.version, p_name: "Synthetic historical recap patient", p_species: "Dog", p_breed: "Mixed", p_dob: null, p_birth_date_precision: "unknown", p_color: "", p_sex: "unknown", p_neuter_status: "unknown", p_microchip_id: null, p_archived_at: new Date().toISOString(), p_deceased_at: "2026-10-02" });
  const historicalAfter = await preview(historicalSelection, historicalPet);
  check(historicalAfter.source_set.patient.deceased_at, "2026-10-02");
  check(Boolean(historicalAfter.source_set.patient.archived_at), true);
  check(historicalAfter.source_set.sources.length, 1);
  check(Object.hasOwn(historicalAfter.source_set.patient, "client_id"), false);
  check(JSON.stringify(historicalAfter.source_set).includes("synthetic-recap@example.test"), false);
  assert.notEqual(historicalAfter.source_fingerprint, historicalBefore.source_fingerprint); apiChecks++;
  const historicalJob = await reserve(randomUUID(), requestFor(historicalAfter, historicalPet, historicalSelection));
  // Later patient corrections must not replace the saved recap's unknown DOB or archive timestamp.
  await rpc(first.db, "save_patient", { p_id: historicalPet, p_client_id: client, p_expected_version: historicalAfter.source_set.patient.version, p_name: "Synthetic historical recap patient", p_species: "Dog", p_breed: "Mixed", p_dob: "2017-03-04", p_birth_date_precision: "estimated", p_color: "", p_sex: "unknown", p_neuter_status: "unknown", p_microchip_id: null, p_archived_at: new Date().toISOString(), p_deceased_at: "2026-10-02" });
  check((await read(historicalJob.job.id)).manifest.source_set.patient, historicalAfter.source_set.patient);
  // Exercise the migration's table-lock boundary with a real native patient writer.
  const rolloutBarrier = sqlSession();
  rolloutBarrier.process.stdin!.write("begin;select pg_backend_pid();lock table public.pets in share row exclusive mode;select 'LOCKED';\n");
  await until(() => rolloutBarrier.output().includes("LOCKED"), "patient backfill table-lock barrier");
  const rolloutPid = Number(rolloutBarrier.output().trim().split("\n")[0]);
  const concurrentPatient = patient("Synthetic rollout-boundary patient");
  await observeWait(rolloutPid, "save_patient", "native patient insert waits outside protected backfill");
  rolloutBarrier.process.stdin!.write("select 'COVERAGE='||(select count(*)from pets p where not exists(select 1 from clinical_recap_epochs e where e.pet_id=p.id));\n");
  await until(() => rolloutBarrier.output().includes("COVERAGE=0"), "complete epoch coverage inside protected snapshot");
  await rolloutBarrier.release();
  const initializedPatient = await concurrentPatient;
  check(sql("select count(*)from clinical_recap_epochs where pet_id='" + initializedPatient + "';"), "1");

  // Review cancellation is durable and policy-independent; the late exact action cannot commit.
  const cancelledReview = randomUUID();
  check((await rpc(second.db, "cancel_clinical_recap_review", { p_actor_id: second.id, p_id: cancelledReview, p_job_id: jobId })).cancelled, true);
  await assert.rejects(rpc(second.db, "save_clinical_recap_review", { p_actor_id: second.id, p_id: cancelledReview, p_request: reviewRequest })); apiChecks++;
  // Real Patient 360 at desktop and phone widths, with committed responses deliberately dropped.
  const origin = "http://127.0.0.1:65281";
  vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "65281", "--strictPort"], {
    env: { ...process.env, VITE_SUPABASE_URL: status.API_URL, VITE_SUPABASE_PUBLISHABLE_KEY: status.ANON_KEY }, stdio: "ignore",
  });
  await until(async () => { try { return (await fetch(origin)).ok; } catch { return false; } }, "owned recap browser app");
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await context.route("**/*", (route) => [origin, status.API_URL].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
  await context.addInitScript((session) => {
    if (!localStorage.getItem("synthetic:recap-bootstrap")) { localStorage.setItem("sb-127-auth-token", JSON.stringify(session)); localStorage.setItem("synthetic:recap-bootstrap", "true"); }
  }, first.session);
  const page = await context.newPage();
  page.setDefaultTimeout(60000); page.setDefaultNavigationTimeout(90000);
  const browserErrors: string[] = [];
  page.on("pageerror", (e) => browserErrors.push(e.message));
  let lostReservation = false, lostGeneration = false, lostReview = false;
  for (const [rpcName, lost, mark] of [
    ["reserve_clinical_recap", () => lostReservation, () => { lostReservation = true; }],
    ["save_clinical_recap_review", () => lostReview, () => { lostReview = true; }],
  ] as const) {
    await page.route("**/rest/v1/rpc/" + rpcName, async (route) => {
      try {
        const response = await route.fetch();
        if (!lost() && response.ok()) { mark(); await route.abort("failed"); } else await route.fulfill({ response });
      } catch { browserErrors.push("Synthetic committed-response interception failed."); await route.abort("failed").catch(() => {}); }
    });
  }
  await page.route("**/functions/v1/clinical-recap-process", async (route) => {
    try {
      const request = route.request();
      const response = await fetch(bridgeUrl, { method: request.method(), headers: request.headers(), body: request.postData() });
      const body = await response.text();
      if (!lostGeneration && response.ok && JSON.parse(body).output) { lostGeneration = true; await route.abort("failed"); }
      else await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body });
    } catch { browserErrors.push("Synthetic generation bridge interception failed."); await route.abort("failed").catch(() => {}); }
  });
  const recapUrl = origin + "/hub/patient/" + uiPet + "?tab=medical&section=recap";
  await page.goto(recapUrl, { waitUntil: "domcontentloaded" });
  let panel = page.getByRole("region", { name: "Records recap", exact: true });
  await panel.waitFor();
  const select = panel.getByRole("region", { name: "Recap source selection", exact: true });
  await select.getByRole("checkbox", { name: /^Visit / }).check();
  await select.getByRole("button", { name: "Preview selected recap sources", exact: true }).click();
  await panel.getByLabel("Recap source and permission", { exact: true }).fill("Fictional browser permission; do not persist this text in browser storage.");
  await panel.getByRole("checkbox", { name: /^I verified the patient, selected records/ }).check();
  await panel.getByRole("button", { name: "Capture selected records for recap", exact: true }).click();
  await until(() => lostReservation, "committed capture response deliberately dropped");
  await panel.getByRole("region", { name: "Unconfirmed recap action", exact: true }).waitFor();
  browserCheck(lostReservation, true);
  browserCheck(await page.evaluate((text) => !Object.values(sessionStorage).some((s) => s.includes(text)), fictional), true);
  page.once("dialog", (dialog) => dialog.accept());
  await page.reload({ waitUntil: "domcontentloaded" });
  panel = page.getByRole("region", { name: "Records recap", exact: true });
  await panel.getByRole("button", { name: "Recover original recap action", exact: true }).click();
  await panel.getByRole("region", { name: "Unconfirmed recap action", exact: true }).waitFor({ state: "hidden" });
  await panel.getByRole("checkbox", { name: /^I authorize sending this frozen record selection/ }).check();
  const browserPaidBefore = providerRequests;
  await panel.getByRole("button", { name: "Generate records recap", exact: true }).click();
  await panel.getByRole("region", { name: "Unconfirmed recap action", exact: true }).waitFor();
  await until(() => lostGeneration, "committed browser generation response dropped");
  await panel.getByRole("button", { name: "Recover original recap action", exact: true }).click();
  await panel.getByRole("region", { name: "Recap claim review", exact: true }).waitFor();
  browserCheck(providerRequests, browserPaidBefore + 1);
  const citation = panel.getByRole("button", { name: /^Open frozen citation src_0001/ });
  await citation.click();
  await panel.getByLabel("Captured citation source", { exact: true }).waitFor();
  browserCheck((await panel.getByLabel("Captured citation source", { exact: true }).textContent())!.includes(fictional), true);
  await citation.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${browserEvidence}/desktop.png`, fullPage: false });
  await page.setViewportSize({ width: 390, height: 844 });
  await citation.scrollIntoViewIfNeeded();
  browserCheck(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: `${browserEvidence}/mobile.png`, fullPage: false });
  const reviewPanel = panel.getByRole("region", { name: "Recap claim review", exact: true });
  const edited = "Fictional browser review: the owner reported a two-day cough.";
  await reviewPanel.getByRole("checkbox", { name: "Retain claim_001", exact: true }).check();
  await reviewPanel.getByLabel("Reviewed wording for claim_001", { exact: true }).fill(edited);
  await reviewPanel.getByRole("checkbox", { name: /^I reviewed the patient attribution, dated claims/ }).check();
  await reviewPanel.getByRole("button", { name: "Retain selected claims as reviewed recap", exact: true }).click();
  await until(() => lostReview, "committed review response deliberately dropped");
  await panel.getByRole("region", { name: "Unconfirmed recap action", exact: true }).waitFor();
  browserCheck(lostReview, true);
  browserCheck(await page.evaluate((text) => !Object.values(sessionStorage).some((s) => s.includes(text)), edited), true);
  page.once("dialog", (dialog) => dialog.accept());
  await page.reload({ waitUntil: "domcontentloaded" });
  panel = page.getByRole("region", { name: "Records recap", exact: true });
  await panel.getByRole("button", { name: "Recover original recap action", exact: true }).click();
  await panel.getByText("Reviewed wording: " + edited, { exact: true }).waitFor();
  browserCheck(sql("select subjective||'|'||status from clinical_encounters where id='" + uiSigned.id + "';"), fictional + "|signed");
  const staleUiPet = await patient("Synthetic stale-review browser"), staleUiEncounter = await encounter(staleUiPet);
  await page.goto(origin + "/hub/patient/" + staleUiPet + "?tab=medical&section=recap", { waitUntil: "domcontentloaded" });
  panel = page.getByRole("region", { name: "Records recap", exact: true });
  await panel.getByRole("region", { name: "Recap source selection", exact: true }).getByRole("checkbox", { name: /^Visit / }).check();
  await panel.getByRole("button", { name: "Preview selected recap sources", exact: true }).click();
  await panel.getByLabel("Recap source and permission", { exact: true }).fill("Fictional stale-review source permission");
  await panel.getByRole("checkbox", { name: /^I verified the patient, selected records/ }).check();
  await panel.getByRole("button", { name: "Capture selected records for recap", exact: true }).click();
  await panel.getByRole("checkbox", { name: /^I authorize sending this frozen record selection/ }).check();
  await panel.getByRole("button", { name: "Generate records recap", exact: true }).click();
  const staleReviewPanel = panel.getByRole("region", { name: "Recap claim review", exact: true });
  await staleReviewPanel.waitFor();
  await staleReviewPanel.getByRole("checkbox", { name: "Retain claim_001", exact: true }).check();
  const unsavedReview = "Fictional reviewer edit retained through a source conflict.";
  await staleReviewPanel.getByLabel("Reviewed wording for claim_001", { exact: true }).fill(unsavedReview);
  await staleReviewPanel.getByRole("checkbox", { name: /^I reviewed the patient attribution, dated claims/ }).check();
  await page.getByRole("button", { name: "Schedule", exact: true }).first().click();
  const leavePrompt = page.getByRole("alertdialog", { name: "Leave with unsaved changes?", exact: true });
  await leavePrompt.waitFor();
  await leavePrompt.getByRole("button", { name: "Keep editing", exact: true }).click();
  browserCheck(new URL(page.url()).pathname, "/hub/patient/" + staleUiPet);
  await rpc(first.db, "add_clinical_addendum", { p_encounter_id: staleUiEncounter.id, p_content: "Fictional update after browser review started." });
  await staleReviewPanel.getByRole("button", { name: "Retain selected claims as reviewed recap", exact: true }).click();
  await panel.getByRole("region", { name: "Unconfirmed recap action", exact: true }).waitFor();
  browserCheck(await staleReviewPanel.getByLabel("Reviewed wording for claim_001", { exact: true }).inputValue(), unsavedReview);
  await panel.getByRole("button", { name: "Cancel unconfirmed recap review", exact: true }).click();
  await panel.getByRole("region", { name: "Unconfirmed recap action", exact: true }).waitFor({ state: "hidden" });
  browserCheck(await staleReviewPanel.getByLabel("Reviewed wording for claim_001", { exact: true }).inputValue(), unsavedReview);
  browserCheck(await page.evaluate((text) => !Object.values(sessionStorage).some((s) => s.includes(text)), unsavedReview), true);
  await staleReviewPanel.getByLabel("Review note (required for rejection)", { exact: true }).fill("Source changed; retain the old output as rejected history.");
  await staleReviewPanel.getByRole("checkbox", { name: /^I reviewed the patient attribution, dated claims/ }).check();
  await staleReviewPanel.getByRole("button", { name: "Reject recap", exact: true }).click();
  await panel.getByText(/Decision: rejected/).waitFor();

  // Read a real saved historical snapshot through Patient 360, independently of later live patient edits.
  const historicalProviderBefore = providerRequests;
  await page.goto(origin + "/hub/patient/" + historicalPet + "?tab=medical&section=recap", { waitUntil: "domcontentloaded" });
  panel = page.getByRole("region", { name: "Records recap", exact: true });
  await panel.getByRole("region", { name: "Recap history", exact: true }).getByRole("button", { name: /^Captured / }).click();
  const historicalSaved = panel.getByRole("region", { name: "Saved records recap", exact: true });
  const frozenPatient = historicalSaved.getByRole("region", { name: "Frozen patient context", exact: true }).first();
  const expectedPatientDetails = ["Not recorded", "unknown", "2026-10-02", historicalAfter.source_set.patient.archived_at];
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await frozenPatient.waitFor({ state: "visible" });
    browserCheck(await frozenPatient.locator("dd").allTextContents(), expectedPatientDetails);
    browserCheck((await frozenPatient.textContent())!.includes("2017-03-04"), false);
    browserCheck(await historicalSaved.getByRole("region", { name: "Captured recap sources", exact: true }).isVisible(), false);
    await frozenPatient.scrollIntoViewIfNeeded();
    browserCheck(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: `${browserEvidence}/historical-header-${width}.png`, fullPage: false });
    const frozenManifest = historicalSaved.locator("summary").filter({ hasText: "Review frozen source manifest" });
    await frozenManifest.click();
    const frozenPreview = historicalSaved.getByRole("region", { name: "Captured recap sources", exact: true });
    const previewPatient = frozenPreview.getByRole("region", { name: "Frozen patient context", exact: true });
    await previewPatient.waitFor({ state: "visible" });
    browserCheck(await previewPatient.locator("dd").allTextContents(), expectedPatientDetails);
    await previewPatient.scrollIntoViewIfNeeded();
    browserCheck(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: `${browserEvidence}/historical-manifest-${width}.png`, fullPage: false });
    await frozenManifest.click();
  }
  browserCheck(providerRequests, historicalProviderBefore);
  browserCheck(browserErrors, []);
  await context.close();

  // Populate a rejected/accepted output, policy versions, canceled action families and stale snapshots before restore.
  const snapshot = "set timezone='UTC';create temp table recap_snapshot(name text,value jsonb);do $$declare r record;v jsonb;begin for r in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','auth','storage','extensions')and c.relkind in('r','p')order by 1,2 loop execute format('select jsonb_build_object(''count'',count(*),''hash'',md5(coalesce(string_agg(to_jsonb(t)::text,''|''order by to_jsonb(t)::text),'''')))from %I.%I t',r.nspname,r.relname)into v;insert into recap_snapshot values(r.nspname||'.'||r.relname,v);end loop;end$$;select jsonb_object_agg(name,value)from recap_snapshot;";
  const catalog = "select jsonb_build_object('routines',(select jsonb_agg(jsonb_build_object('identity',p.oid::regprocedure::text,'body',pg_get_functiondef(p.oid),'acl',(select jsonb_agg(jsonb_build_object('grantee',case when a.grantee=0 then 'PUBLIC'else pg_get_userbyid(a.grantee)end,'grantor',pg_get_userbyid(a.grantor),'privilege',a.privilege_type,'grantable',a.is_grantable)order by a.grantee,a.grantor,a.privilege_type)from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a),'settings',p.proconfig,'owner',pg_get_userbyid(p.proowner))order by p.oid::regprocedure::text)from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.prokind='f'),'relations',(select jsonb_agg(jsonb_build_object('name',c.relname,'rls',c.relrowsecurity,'forced',c.relforcerowsecurity,'acl',(select jsonb_agg(jsonb_build_object('grantee',case when a.grantee=0 then 'PUBLIC'else pg_get_userbyid(a.grantee)end,'grantor',pg_get_userbyid(a.grantor),'privilege',a.privilege_type,'grantable',a.is_grantable)order by a.grantee,a.grantor,a.privilege_type)from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a),'owner',pg_get_userbyid(c.relowner))order by c.relname)from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'and c.relkind in('r','p')),'triggers',(select jsonb_agg(pg_get_triggerdef(t.oid)order by c.relname,t.tgname)from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'and not t.tgisinternal),'constraints',(select jsonb_agg(jsonb_build_object('table',c.relname,'name',k.conname,'definition',pg_get_constraintdef(k.oid,true))order by c.relname,k.conname)from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'),'policies',(select jsonb_agg(to_jsonb(p)order by tablename,policyname)from pg_policies p where schemaname='public'));";
  const before = JSON.parse(sql(snapshot)), beforeCatalog = JSON.parse(sql(catalog));
  let dump = execFileSync("docker", ["exec", container, "pg_dump", "-U", "postgres", "--no-owner", "--schema=public", "--schema=auth", "--schema=storage", "--schema=extensions", "postgres"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
  dump = dump.split("\n").filter((line) => !line.startsWith("ALTER DEFAULT PRIVILEGES")).join("\n").replace("CREATE SCHEMA extensions;", "CREATE SCHEMA IF NOT EXISTS extensions;");
  const clone = "owned_recap_restore_" + randomUUID().replaceAll("-", "").slice(0, 10), marker = randomUUID();
  sql("create database " + clone + ";comment on database " + clone + " is '" + marker + "';");
  try {
    sql('drop schema public;create schema extensions;create extension pgcrypto with schema extensions;create extension "uuid-ossp"with schema extensions;', clone);
    sql(dump, clone);
    restoreCheck(JSON.parse(sql(snapshot, clone)), before);
    restoreCheck(JSON.parse(sql(catalog, clone)), beforeCatalog);
    const restoredRead = JSON.parse(sql("begin;" + nativeAuth + "select public.read_clinical_recap_job('" + first.id + "','" + jobId + "');rollback;", clone).split("\n").at(-1)!);
    restoreCheck(restoredRead.output.payload_sha256, output.output.payload_sha256);
    restoreCheck(restoredRead.review.accepted_claims[0].reviewed_text, reviewRequest.accepted_claims[0].text);
    restoreCheck(JSON.parse(sql(snapshot)), before);
  } finally {
    assert.equal(sql("select shobj_description(oid,'pg_database')from pg_database where datname='" + clone + "';"), marker);
    sql("drop database " + clone + " with(force);");
    restoreCheck(sql("select count(*)from pg_database where datname='" + clone + "';"), "0");
  }
  check((await read(jobId, second)).review.reviewer_id, second.id);
  sql("delete from auth.sessions where user_id='" + second.id + "';");
  await assert.rejects(read(jobId, second)); apiChecks++;
  const proof = { apiAssertions: apiChecks, browserAssertions: browserChecks, restoreAssertions: restoreChecks, restoredRelations: Object.keys(before).length, observedLockWaits: observedWaits, fakeProviderRequests: providerRequests, realProviderRequests: 0, droppedCommittedBrowserResponses: Number(lostReservation) + Number(lostGeneration) + Number(lostReview) };
  writeFileSync(`${evidenceBase}-roundtrip.json`, JSON.stringify(proof, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify(proof));
} catch (failure) {
  const page = browser?.contexts()[0]?.pages()[0];
  if (page) {
    await page.screenshot({ path: `${browserEvidence}/failure.png`, fullPage: false }).catch(() => {});
    writeFileSync(`${browserEvidence}/failure.html`, await page.content().catch(() => "Unavailable"), { mode: 0o600 });
  }
  throw failure;
} finally {
  if (browser) { for (const context of browser.contexts()) await context.unrouteAll({ behavior: "ignoreErrors" }); await browser.close(); }
  if (vite && vite.exitCode === null) { const stopped = once(vite, "exit"); vite.kill("SIGTERM"); await stopped; }
  bridge.closeAllConnections();
  await new Promise<void>((resolve) => bridge.close(() => resolve()));
}
