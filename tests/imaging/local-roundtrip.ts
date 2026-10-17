/** Owned localhost only; real Auth/PostgREST/Storage. Vendor navigation is stubbed. */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createClient, type SupabaseClient, type Session } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { parseOwnedRuntimeStatus } from "../estimates/owned-runtime-status.ts";
import { detailSchema, type ImagingValues } from "../../src/hub/features/imaging/model.ts";

const project = process.env.IMAGING_TEST_PROJECT;
assert.ok(project && process.env.IMAGING_RUN_SYNTHETIC_LOCAL === "true");
const identity = readFileSync(project + "/supabase/config.toml", "utf8").match(/^project_id = "(lrv-imaging-[a-f0-9]+)"/m)?.[1];
assert.ok(identity);
const container = "supabase_db_" + identity;
const labels = JSON.parse(execFileSync("docker", ["inspect", container], { encoding: "utf8" }))[0].Config.Labels;
assert.equal(labels["com.supabase.cli.project"], identity);
assert.equal(realpathSync(labels["com.supabase.cli.workdir"]), realpathSync(project));
const status = parseOwnedRuntimeStatus(execFileSync("supabase", ["status", "--workdir", project, "--output", "json", "--agent", "no"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
assert.equal(status.API_URL, "http://127.0.0.1:65021");
function sql(query: string, database = "postgres") {
  try { return execFileSync("docker", ["exec", "-i", container, "psql", "-X", "-qAt", "-U", "postgres", "-d", database, "-v", "ON_ERROR_STOP=1"], { input: query, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 }).trim(); }
  catch { throw new Error("Owned imaging SQL failed; private output withheld"); }
}
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(status.API_URL, status.SERVICE_ROLE_KEY, options), anon = createClient(status.API_URL, status.ANON_KEY, options);
interface Actor { id: string; db: SupabaseClient; session: Session }
async function actor(name: string): Promise<Actor> {
  const email = "synthetic-imaging-" + randomUUID() + "@example.test", password = randomUUID() + randomUUID();
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const id = created.data.user!.id, db = createClient(status.API_URL, status.ANON_KEY, options);
  sql(`update profiles set is_active=true,full_name='Synthetic imaging ${name}'where id='${id}';insert into user_roles(user_id,role)values('${id}','STAFF')on conflict do nothing;`);
  const signed = await db.auth.signInWithPassword({ email, password });
  if (signed.error) throw signed.error;
  return { id, db, session: signed.data.session! };
}
async function rpc(db: SupabaseClient, name: string, args: Record<string, unknown>) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw Object.assign(new Error("Owned RPC failed: " + name), { code: error.code });
  return data;
}
let apiChecks = 0, browserChecks = 0, restoreChecks = 0;
function check(actual: unknown, expected: unknown) { assert.deepEqual(actual, expected); apiChecks++; }
async function until(test: () => Promise<boolean>) { for (let i = 0; i < 400; i++) { if (await test()) return; await new Promise(resolve => setTimeout(resolve, 25)); } throw new Error("Owned condition not observed"); }
let vite: ReturnType<typeof spawn> | null = null, browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
mkdirSync("tmp/imaging-browser", { recursive: true });
try {
  check(sql("select count(*)from supabase_migrations.schema_migrations;"), "202");
  const first = await actor("First"), second = await actor("Second");
  const client = (await rpc(first.db, "save_client", { p_actor_id: first.id, p_client_id: null, p_expected_version: null, p_first_name: "Synthetic", p_last_name: "Imaging", p_primary_phone: "+13035555582", p_primary_email: "synthetic-imaging@example.test", p_preferred_channel: "EMAIL", p_housecall_address: null, p_mailing_address: null })).id;
  async function pet(name: string) { return (await rpc(first.db, "save_patient", { p_id: null, p_client_id: client, p_expected_version: null, p_name: name, p_species: "Dog", p_breed: "Mixed", p_dob: null, p_birth_date_precision: "unknown", p_color: "", p_sex: "unknown", p_neuter_status: "unknown", p_microchip_id: null, p_archived_at: null, p_deceased_at: null })).id as string; }
  const apiPet = await pet("Synthetic API Imaging"), uiPet = await pet("Synthetic Browser Imaging"), otherPet = await pet("Synthetic Other Imaging");
  const values: ImagingValues = { account_label: "Synthetic practice", vendor_patient_id: "SYNTH-API", external_study_id: "SYNTH-API-STUDY", accession: "", study_date: "2026-10-16", modality: "DX", description: "Synthetic thorax", body_region: "Thorax", viewer_url: "https://pacs5.vetrocket.net/view.html?link=SYNTHETIC_ONLY", encounter_id: null, encounter_version: null, document_id: null, document_version: null, identity_verified: true, review_note: "Synthetic patient ID and study date checked." };
  function action(petId = apiPet, value = values) { return { p_actor_id: first.id, p_action_id: randomUUID(), p_id: randomUUID(), p_pet_id: petId, p_expected_version: null as number | null, p_kind: "record", p_values: value as ImagingValues | null, p_reason: "" }; }
  const a = action();
  const both = await Promise.all([rpc(first.db, "save_imaging_study", a), rpc(first.db, "save_imaging_study", a)]);
  check(both[0], both[1]); check(detailSchema.parse(both[0]).study.version, 1);
  check(sql(`select count(*)from imaging_study_revisions where study_id='${a.p_id}';`), "1");
  check((await second.db.rpc("recover_imaging_action", { ...a, p_actor_id: second.id })).error?.code, "23505");
  check((await first.db.rpc("save_imaging_study", { ...a, p_actor_id: second.id })).error?.code, "42501");
  check((await anon.rpc("list_imaging_studies", { p_actor_id: first.id, p_pet_id: apiPet })).error?.code, "42501");
  check((await service.rpc("list_imaging_studies", { p_actor_id: first.id, p_pet_id: apiPet })).error?.code, "42501");
  check(await rpc(first.db, "read_imaging_study", { p_actor_id: first.id, p_pet_id: otherPet, p_id: a.p_id }), null);
  const correction = { ...a, p_action_id: randomUUID(), p_expected_version: 1, p_kind: "correct", p_values: { ...values, description: "Synthetic corrected thorax" }, p_reason: "Synthetic correction" };
  const writers = await Promise.all([first.db.rpc("save_imaging_study", correction), first.db.rpc("save_imaging_study", { ...correction, p_action_id: randomUUID() })]);
  check(writers.filter(r => !r.error).length, 1); check(writers.find(r => r.error)?.error?.code, "PT409");
  check(sql(`select count(*)from imaging_study_revisions where study_id='${a.p_id}';`), "2");
  const cancelled = action(apiPet, { ...values, external_study_id: "SYNTH-CANCEL" });
  check((await rpc(first.db, "cancel_imaging_action", cancelled)).cancelled, true);
  check((await first.db.rpc("save_imaging_study", cancelled)).error?.code, "PT409");
  check(await rpc(first.db, "read_imaging_study", { p_actor_id: first.id, p_pet_id: apiPet, p_id: cancelled.p_id }), null);
  // A simultaneous cancel/save has exactly one terminal result, regardless of lock winner.
  const raced = action(apiPet, { ...values, external_study_id: "SYNTH-RACE" });
  const race = await Promise.all([first.db.rpc("save_imaging_study", raced), first.db.rpc("cancel_imaging_action", raced)]);
  check(Boolean(race[0].data) !== Boolean(race[1].data?.cancelled), true);
  check(sql(`select count(*)from imaging_study_actions where id='${raced.p_action_id}';`), "1");
  const pdf = Buffer.from("%PDF-1.4\n% Synthetic imaging report; local test only\n%%EOF\n");
  const document = await rpc(first.db, "prepare_patient_document", { p_id: randomUUID(), p_pet_id: uiPet, p_encounter_id: null, p_file_name: "synthetic-imaging.pdf", p_mime_type: "application/pdf", p_file_size: pdf.length, p_category: "medical_record", p_source: "Synthetic imaging proof", p_document_date: "2026-10-16", p_visibility: "internal" });
  const uploaded = await first.db.storage.from("patient-documents").upload(document.file_path, pdf, { contentType: "application/pdf", upsert: false });
  if (uploaded.error) throw uploaded.error;
  const ready = await rpc(first.db, "finalize_patient_document", { p_id: document.id });
  check(ready.status, "ready");
  check((await first.db.rpc("save_imaging_study", { ...action(apiPet, { ...values, external_study_id: "WRONG-PDF", document_id: ready.id, document_version: ready.version }) })).error?.code, "23514");

  const origin = "http://127.0.0.1:65081";
  vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "65081", "--strictPort"], { env: { ...process.env, VITE_SUPABASE_URL: status.API_URL, VITE_SUPABASE_PUBLISHABLE_KEY: status.ANON_KEY }, stdio: "ignore" });
  await until(async () => { try { return (await fetch(origin)).ok; } catch { return false; } });
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await context.addInitScript(session => { if (!localStorage.getItem("synthetic:imaging-bootstrap")) { localStorage.setItem("sb-127-auth-token", JSON.stringify(session)); localStorage.setItem("synthetic:imaging-bootstrap", "true"); } }, first.session);
  let vendorLaunches = 0;
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    if ([origin, status.API_URL].includes(url.origin)) return route.continue();
    if (url.hostname === "pacs5.vetrocket.net") { vendorLaunches++; return route.fulfill({ status: 200, contentType: "text/html", body: "<title>Synthetic viewer stub</title>Owned test only" }); }
    return route.abort();
  });
  const page = await context.newPage(); page.setDefaultTimeout(60000); page.setDefaultNavigationTimeout(90000);
  const pageErrors: string[] = []; page.on("pageerror", error => pageErrors.push(error.message));
  let dropped = false, blockNext = false, uiIntent: Record<string, unknown> | null = null;
  let abandonedIntent: Record<string, unknown> | null = null;
  await page.route("**/rest/v1/rpc/save_imaging_study", async route => {
    uiIntent = route.request().postDataJSON();
    if (blockNext) { blockNext = false; abandonedIntent = uiIntent; await route.abort("failed"); return; }
    if (!dropped) { const response = await route.fetch(); assert.equal(response.status(), 200); dropped = true; await route.abort("failed"); }
    else await route.continue();
  });
  await page.goto(origin + "/hub/patient/" + uiPet + "?tab=medical&section=imaging", { waitUntil: "domcontentloaded" });
  const imaging = page.locator("#p360-imaging");
  await imaging.getByRole("button", { name: "Link imaging study", exact: true }).click();
  const form = imaging.getByRole("form", { name: "Imaging study editor" });
  for (const [label, value] of [["VetRocket account / clinic label", "Synthetic practice"], ["Patient ID in VetRocket", "SYNTH-BROWSER"], ["VetRocket study ID", "SYNTH-BROWSER-STUDY"], ["Study date", "2026-10-16"], ["Study description", "Synthetic browser thorax"], ["VetRocket study share link", values.viewer_url]] as const) await form.getByLabel(label, { exact: true }).fill(value);
  await form.getByLabel("Report PDF (optional)").selectOption(ready.id);
  await form.getByLabel("Identity review note", { exact: true }).fill("Synthetic patient identity and source study checked.");
  await form.getByRole("checkbox").check();
  await page.getByRole("tab", { name: /^Documents/ }).click();
  await page.getByRole("tab", { name: /^Medical/ }).click();
  assert.equal(await form.getByLabel("VetRocket study ID", { exact: true }).inputValue(), "SYNTH-BROWSER-STUDY"); browserChecks++;
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true); browserChecks++;
  await imaging.screenshot({ path: "tmp/imaging-browser/mobile-editor.png" });
  await form.getByRole("button", { name: "Save linked study", exact: true }).click();
  await imaging.getByLabel("Unconfirmed imaging request").waitFor();
  await page.reload();
  await imaging.getByLabel("Unconfirmed imaging request").waitFor(); browserChecks++;
  await imaging.getByRole("button", { name: "Check saved work", exact: true }).click();
  await imaging.getByRole("button", { name: "Open VetRocket viewer", exact: true }).waitFor();
  assert.ok(dropped && uiIntent); browserChecks++;
  check(sql(`select count(*)from imaging_studies where pet_id='${uiPet}';`), "1");
  await imaging.getByRole("button", { name: "View history", exact: true }).click();
  await imaging.getByLabel("Imaging history").getByText("Original recorded identity", { exact: true }).waitFor(); browserChecks++;
  const popup = context.waitForEvent("page");
  await imaging.getByRole("button", { name: "Open VetRocket viewer", exact: true }).click();
  const viewer = await popup; await viewer.waitForLoadState();
  assert.equal(await viewer.evaluate(() => window.opener === null), true); browserChecks++;
  await viewer.close(); check(vendorLaunches, 1);
  // An undispatched request must be durably cancelled before editing can resume.
  await imaging.getByRole("button", { name: "Link imaging study", exact: true }).click();
  for (const [label, value] of [["VetRocket account / clinic label", "Synthetic practice"], ["Patient ID in VetRocket", "SYNTH-BROWSER"], ["VetRocket study ID", "SYNTH-BROWSER-CANCEL"], ["Study date", "2026-10-16"], ["Study description", "Synthetic abandoned study"], ["VetRocket study share link", values.viewer_url]] as const) await form.getByLabel(label, { exact: true }).fill(value);
  await form.getByLabel("Identity review note", { exact: true }).fill("Synthetic source checked before cancelled save.");
  await form.getByRole("checkbox").check(); blockNext = true;
  await form.getByRole("button", { name: "Save linked study", exact: true }).click();
  await imaging.getByLabel("Unconfirmed imaging request").waitFor();
  await imaging.getByRole("button", { name: "Check saved work", exact: true }).click();
  await imaging.getByRole("button", { name: "Cancel request and return to editing", exact: true }).click();
  await imaging.getByLabel("Unconfirmed imaging request").waitFor({ state: "hidden" });
  await form.getByRole("checkbox").waitFor();
  assert.equal(await form.getByRole("checkbox").isChecked(), false); browserChecks++;
  assert.ok(abandonedIntent);
  check((await first.db.rpc("save_imaging_study", abandonedIntent)).error?.code, "PT409");
  check(sql(`select count(*)from imaging_studies where pet_id='${uiPet}';`), "1");
  page.once("dialog", dialog => void dialog.accept());
  await form.getByRole("button", { name: "Cancel changes", exact: true }).click();
  await rpc(first.db, "void_patient_document", { p_id: ready.id, p_expected_version: ready.version, p_reason: "Synthetic source void" });
  await page.reload();
  await imaging.getByRole("button", { name: "View study", exact: true }).click();
  await imaging.getByText("Saved PDF changed or is unavailable; its original association is retained", { exact: false }).waitFor();
  assert.equal(await imaging.getByRole("button", { name: "Download current PDF", exact: true }).isDisabled(), true); browserChecks++;
  await page.setViewportSize({ width: 1280, height: 1000 });
  await imaging.screenshot({ path: "tmp/imaging-browser/desktop-study.png" });
  assert.deepEqual(pageErrors, []); browserChecks++;
  await context.close();

  const snapshot = `set timezone='UTC';create temp table imaging_snapshot(name text,value jsonb);do $$declare r record;v jsonb;begin for r in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','auth','storage','extensions')and c.relkind in('r','p')order by 1,2 loop execute format('select jsonb_build_object(''count'',count(*),''hash'',md5(coalesce(string_agg(to_jsonb(t)::text,''|''order by to_jsonb(t)::text),'''')))from %I.%I t',r.nspname,r.relname)into v;insert into imaging_snapshot values(r.nspname||'.'||r.relname,v);end loop;end$$;select jsonb_object_agg(name,value)from imaging_snapshot;`;
  const before = JSON.parse(sql(snapshot));
  let dump = execFileSync("docker", ["exec", container, "pg_dump", "-U", "postgres", "--no-owner", "--schema=public", "--schema=auth", "--schema=storage", "--schema=extensions", "postgres"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
  dump = dump.split("\n").filter(line => !line.startsWith("ALTER DEFAULT PRIVILEGES")).join("\n").replace("CREATE SCHEMA extensions;", "CREATE SCHEMA IF NOT EXISTS extensions;");
  const clone = "owned_imaging_restore_" + randomUUID().replaceAll("-", "").slice(0, 10), marker = randomUUID();
  sql(`create database ${clone};comment on database ${clone} is '${marker}';`);
  try {
    sql('drop schema public;create schema extensions;create extension pgcrypto with schema extensions;create extension "uuid-ossp"with schema extensions;', clone);
    sql(dump, clone);
    assert.deepEqual(JSON.parse(sql(snapshot, clone)), before); restoreChecks++;
    assert.deepEqual(JSON.parse(sql(snapshot)), before); restoreChecks++;
    const sid = sql(`select id from auth.sessions where user_id='${first.id}'order by created_at desc limit 1;`);
    assert.match(sid, /^[a-f0-9-]{36}$/);
    assert.equal(sql(`begin;select set_config('request.jwt.claims','{"role":"authenticated","sub":"${first.id}","session_id":"${sid}"}',true);set local role authenticated;select read_imaging_study('${first.id}','${apiPet}','${a.p_id}')#>>'{study,id}';rollback;`, clone).split("\n").at(-1), a.p_id); restoreChecks++;
  } finally { assert.equal(sql(`select shobj_description(oid,'pg_database')from pg_database where datname='${clone}';`), marker); sql(`drop database ${clone} with(force);`); }
  sql(`delete from auth.sessions where user_id='${second.id}';`);
  check((await second.db.rpc("list_imaging_studies", { p_actor_id: second.id, p_pet_id: apiPet })).error?.code, "42501");
  const proof = { apiAssertions: apiChecks, browserAssertions: browserChecks, restoreAssertions: restoreChecks, restoredRelations: Object.keys(before).length, concurrentDuplicateSave: true, competingCorrections: true, durableCancelSaveRace: true, committedBrowserResponseDroppedAndRecovered: dropped, stubbedViewerLaunches: vendorLaunches, providerRequests: 0, pageErrors, restoreCloneRemoved: true };
  writeFileSync("tmp/imaging-roundtrip.json", JSON.stringify(proof, null, 2) + "\n");
  console.log(JSON.stringify(proof));
} finally {
  if (browser) await browser.close();
  if (vite) { const exited = once(vite, "exit"); vite.kill("SIGTERM"); await exited; }
}
