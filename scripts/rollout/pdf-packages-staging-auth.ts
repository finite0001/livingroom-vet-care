/** Bounded genuine staging PDF review; policies removed and fixtures retired in finally. */
import { proveHostedPdfReview } from "./pdf-packages-staging-browser.ts";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { values } from "../../tests/diagnostics/fixture.ts";
import { createPdfService } from "../../services/diagnostic-renderer/service.ts";
import { processDiagnosticPdf } from "../../services/diagnostic-renderer/processing.ts";
import { renderInSandbox } from "../../services/diagnostic-renderer/sandbox.ts";
import { revalidateInSandbox } from "../../services/diagnostic-renderer/revalidate.ts";
import {
  ACCEPTED_IMAGE,
  trustedProvenance,
  verifyTrustedProvenance,
} from "../../services/diagnostic-renderer/trusted.ts";

assert.equal(process.env.DIAGNOSTICS_RUN_SYNTHETIC_STAGING, "true");
const project = "kothoqicubowyhwfsrte";
const dir = "tmp/pdf-packages-rollout/" + project;
mkdirSync(dir, { recursive: true, mode: 0o700 });
function sql(query: string) {
  const result = JSON.parse(
    execFileSync(
      "supabase",
      [
        "db",
        "query",
        "--linked",
        "--project-ref",
        project,
        "--output-format",
        "json",
        query,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ),
  );
  return (Array.isArray(result) ? result : result.rows) as Array<
    Record<string, unknown>
  >;
}
const raw = JSON.parse(
  execFileSync(
    "supabase",
    [
      "projects",
      "api-keys",
      "--project-ref",
      project,
      "--reveal",
      "--output",
      "json",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ),
);
const keys = z
  .array(z.object({ name: z.string(), api_key: z.string() }).passthrough())
  .parse(Array.isArray(raw) ? raw : raw.rows);
const secret = z
  .string()
  .min(20)
  .parse(keys.find((k) => k.name === "service_role")?.api_key);
const anon = z
  .string()
  .min(20)
  .parse(keys.find((k) => k.name === "anon")?.api_key);
const url = `https://${project}.supabase.co`;
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, secret, options),
  staff = createClient(url, anon, options),
  reader = createClient(url, anon, options);
async function rpc(
  db: typeof admin,
  name: string,
  args: Record<string, unknown>,
) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw error;
  return data;
}
const quote = (s: string) => "'" + s.replaceAll("'", "''") + "'";
const policies = () =>
  sql(
    "select (select count(*) from diagnostic_pdf_runtime_policy) as runtime,(select count(*) from diagnostic_pdf_worker_policy) as worker,(select count(*) from record_release_policy) as release,(select count(*) from record_request_disclosure_policy) as disclosure,(select count(*) from communication_outbox) as outbox;",
  )[0];
assert.deepEqual(policies(), {
  runtime: 0,
  worker: 0,
  release: 0,
  disclosure: 0,
  outbox: 0,
});
let readerActor: string | null = null;
let currentPackageChecks = 0, historicalPackageChecks = 0;
let reviewProof: Record<string, unknown> | null = null;
let actor: string | null = null,
  pet: string | null = null,
  client: string | null = null,
  objectPath: string | null = null;
const job = randomUUID();
let checks = 0,
  generated = 0,
  validated = 0;
const errors: unknown[] = [];
let proof: Record<string, unknown> | null = null;
let failure: unknown = null;
try {
  const candidates=Array.from({length:100},(_,i)=>"+120255501"+String(i).padStart(2,"0"));
  const fixturePhone=candidates.find(phone=>sql(`select count(*)::integer as n from clients where primary_phone=${quote(phone)}`)[0].n===0);
  assert.ok(fixturePhone,"Unused synthetic test number required");
  const email = `synthetic-pdf-staging-${randomUUID()}@example.test`,
    password = randomUUID() + "Aa1!";
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error) throw created.error;
  actor = created.data.user.id;
  writeFileSync(dir + "/fixtures.json", JSON.stringify({ actor, job }), {
    mode: 0o600,
  });
  sql(
    `update profiles set is_active=true,full_name='SYNTHETIC PDF review reviewer' where id=${quote(actor)};insert into user_roles(user_id,role) values(${quote(actor)},'DVM');`,
  );
  const signed = await staff.auth.signInWithPassword({ email, password });
  if (signed.error) throw signed.error;
  client = z.object({ id: z.string().uuid() }).parse(
    await rpc(staff, "save_client", {
      p_actor_id: actor,
      p_client_id: null,
      p_expected_version: null,
      p_first_name: "SYNTHETIC",
      p_last_name: "PDF staging registration",
      p_primary_phone: fixturePhone,
      p_primary_email: email,
      p_preferred_channel: "EMAIL",
      p_mailing_address: null,
      p_housecall_address: null,
    }),
  ).id;
  const patient = {
    p_id: null as string | null,
    p_client_id: client,
    p_expected_version: null as number | null,
    p_name: "SYNTHETIC PDF staging patient",
    p_species: "Dog",
    p_breed: null,
    p_dob: null,
    p_birth_date_precision: "unknown",
    p_color: null,
    p_sex: "unknown",
    p_neuter_status: "unknown",
    p_microchip_id: null,
    p_archived_at: null as string | null,
    p_deceased_at: null,
  };
  pet = z
    .object({ id: z.string().uuid() })
    .parse(await rpc(staff, "save_patient", patient)).id;
  writeFileSync(
    dir + "/fixtures.json",
    JSON.stringify({ actor, job, pet, client }),
    { mode: 0o600 },
  );
  const readerEmail = `synthetic-pdf-reader-${randomUUID()}@example.test`,
    readerPassword = randomUUID() + "Aa1!";
  const madeReader = await admin.auth.admin.createUser({
    email: readerEmail,
    password: readerPassword,
    email_confirm: true,
  });
  if (madeReader.error) throw madeReader.error;
  readerActor = madeReader.data.user.id;
  writeFileSync(
    dir + "/fixtures.json",
    JSON.stringify({ actor, readerActor, job, pet, client }),
    { mode: 0o600 },
  );
  sql(
    `update profiles set is_active=true,full_name='SYNTHETIC alternate PDF reader' where id=${quote(readerActor)};insert into user_roles(user_id,role) values(${quote(readerActor)},'STAFF');`,
  );
  const signedReader = await reader.auth.signInWithPassword({
    email: readerEmail,
    password: readerPassword,
  });
  if (signedReader.error) throw signedReader.error;
  const readerSession = signedReader.data.session;
  assert.ok(readerSession);
  const panel = randomUUID(),
    v = values();
  await rpc(staff, "save_diagnostic_panel", {
    p_action_id: randomUUID(),
    p_id: panel,
    p_pet_id: pet,
    p_expected_version: null,
    p_kind: "draft",
    p_values: v,
  });
  const historyPanel = randomUUID();
  await rpc(staff, "save_diagnostic_panel", {
    p_action_id: randomUUID(),
    p_id: historyPanel,
    p_pet_id: pet,
    p_expected_version: null,
    p_kind: "draft",
    p_values: { ...v, panel_name: "SYNTHETIC earlier chemistry" },
  });
  await rpc(staff, "save_diagnostic_panel", {
    p_action_id: randomUUID(),
    p_id: historyPanel,
    p_pet_id: pet,
    p_expected_version: 1,
    p_kind: "finalize",
    p_values: { ...v, panel_name: "SYNTHETIC earlier chemistry" },
    p_review_note: "SYNTHETIC additional embedded history",
  });
  await rpc(staff, "save_diagnostic_panel", {
    p_action_id: job,
    p_id: panel,
    p_pet_id: pet,
    p_expected_version: 1,
    p_kind: "finalize",
    p_values: v,
    p_review_note: "SYNTHETIC actual PDF review check",
  });
  const service = createPdfService({ url, key: secret });
  const adapters = {
    verifyProvenance: verifyTrustedProvenance,
    generate: async (...a: Parameters<typeof renderInSandbox>) => {
      generated++;
      return renderInSandbox(...a);
    },
    validate: async (...a: Parameters<typeof revalidateInSandbox>) => {
      validated++;
      return revalidateInSandbox(...a);
    },
  };
  assert.equal(
    (await processDiagnosticPdf(service, adapters, { job_id: job })).state,
    "off",
  );
  assert.equal(generated, 0);
  checks += 2;
  const provenance = trustedProvenance();
  sql(
    `insert into diagnostic_pdf_runtime_policy(enabled,image,provenance,accepted_by) values(true,${quote(ACCEPTED_IMAGE)},${quote(JSON.stringify(provenance))}::jsonb,${quote(actor)});insert into diagnostic_pdf_worker_policy(enabled,renderer_sha,settings_sha,accepted_by) select true,${quote(ACCEPTED_IMAGE.split(":")[1])},encode(sha256(convert_to((${quote(JSON.stringify(provenance.settings))}::jsonb)::text,'UTF8')),'hex'),${quote(actor)};`,
  );
  console.log("Synthetic pipeline: generation and registration started");
  const result = await processDiagnosticPdf(service, adapters, { job_id: job });
  assert.equal(result.state, "stored_private");
  assert.equal(generated, 1);
  assert.equal(validated, 2);
  checks += 3;
  objectPath = z
    .string()
    .parse(
      sql(
        `select object_path from diagnostic_pdf_upload_intents where job_id=${quote(job)};`,
      )[0].object_path,
    );
  console.log(
    "Synthetic pipeline: registration returned; HTTP readback started",
  );
  const bytes = await service.download("diagnostic-pdfs", objectPath);
  const stored = sql(
    `select c.metadata->>'sha256' as sha,(c.metadata->>'byte_length')::integer as length,a.object_version,o.version from diagnostic_pdf_captures c join diagnostic_pdf_artifacts a on a.job_id=c.job_id join storage.objects o on o.id=a.object_id where c.job_id=${quote(job)};`,
  )[0];
  assert.equal(createHash("sha256").update(bytes).digest("hex"), stored.sha);
  assert.equal(bytes.length, stored.length);
  assert.equal(stored.object_version, stored.version);
  checks += 3;
  console.log(
    "Synthetic pipeline: exact readback verified; staff denial started",
  );
  const denied = await staff.storage
    .from("diagnostic-pdfs")
    .download(objectPath);
  assert.ok(denied.error);
  checks++;
  const state = await rpc(staff, "read_diagnostic_pdf_artifact_state", {
    p_id: job,
    p_pet: pet,
  });
  assert.equal(state.stored_private, true);
  assert.equal(state.download_available, false);
  assert.equal(state.export_eligible, false);
  checks += 3;
  assert.equal(
    (await processDiagnosticPdf(service, adapters, { job_id: job })).state,
    "stored_private",
  );
  assert.equal(generated, 1);
  checks += 2;
  const { proveDiagnosticRecordPackages } = await import("./pdf-packages-capture-proof.ts");
  const packageArgs = {staff:reader,admin,actor:readerActor,job,pet,bytes,sql:(query:string)=>{
    const row=sql(query)[0];if(!row)return "";const value=Object.values(row)[0];return typeof value === "object" ? JSON.stringify(value):String(value ?? "");
  },project,url,anon,accessToken:readerSession.access_token};
  currentPackageChecks=await proveDiagnosticRecordPackages({...packageArgs,mode:"current"});checks+=currentPackageChecks;
  reviewProof = await proveHostedPdfReview({
    url,
    anon,
    session: readerSession,
    reader,
    actor: readerActor,
    owner: actor,
    ownerDb: staff,
    job,
    pet,
    panel,
    values: v,
    bytes,
    sql,
  });
  checks += Number(reviewProof.checks);
  historicalPackageChecks=await proveDiagnosticRecordPackages({...packageArgs,mode:"historical"});checks+=historicalPackageChecks;
  const removed = await admin.storage
    .from("diagnostic-pdfs")
    .remove([objectPath]);
  if (removed.error) throw removed.error;
  assert.equal(
    (
      await rpc(reader, "read_diagnostic_pdf_artifact_state", {
        p_id: job,
        p_pet: pet,
      })
    ).object_present,
    false,
  );
  checks++;
  sql(`update profiles set is_active=true where id=${quote(actor)};`);
  assert.equal(
    (await processDiagnosticPdf(service, adapters, { job_id: job })).state,
    "registered_unavailable",
  );
  assert.equal(generated, 1);
  checks += 2;
  proof = {
    project,
    checks,
    genuine_auth: true,
    currentPackageChecks, historicalPackageChecks,
    review: reviewProof,
    generated,
    validated,
    byte_length: bytes.length,
    exact_http_readback: true,
    direct_staff_storage_denied: true,
    deleted_object_unavailable: true,
    regeneration: 0,
    provider_requests: 0,
  };
} catch (error) {
  failure = error;
} finally {
  if (actor) {
    for (const table of [
      "diagnostic_pdf_staff_disclosure_policy",
      "diagnostic_pdf_worker_policy",
      "diagnostic_pdf_runtime_policy",
    ])
      try {
        sql(`delete from ${table} where accepted_by=${quote(actor)};`);
      } catch (e) {
        errors.push(e);
      }
    if (!objectPath) {
      const owned = sql(
        `select i.object_path from diagnostic_pdf_upload_intents i join diagnostic_pdf_jobs j on j.id=i.job_id where i.job_id=${quote(job)} and j.created_by=${quote(actor)};`,
      );
      if (owned.length) objectPath = z.string().parse(owned[0].object_path);
    }
    if (objectPath)
      try {
        const removed = await admin.storage
          .from("diagnostic-pdfs")
          .remove([objectPath]);
        if (removed.error) errors.push(removed.error);
      } catch (e) {
        errors.push(e);
      }
    if (pet)
      try {
        sql(
          `update pets set archived_at=coalesce(archived_at,now()) where id=${quote(pet)};`,
        );
      } catch (e) {
        errors.push(e);
      }
    try {
      const out = await staff.auth.signOut({ scope: "global" });
      if (out.error) errors.push(out.error);
      sql(
        `update profiles set is_active=false where id=${quote(actor)};delete from auth.refresh_tokens where user_id=${quote(actor)};update auth.sessions set not_after=now() where user_id=${quote(actor)};`,
      );
      const ban = await admin.auth.admin.updateUserById(actor, {
        ban_duration: "876000h",
      });
      if (ban.error) errors.push(ban.error);
    } catch (e) {
      errors.push(e);
    }
  }
  if (readerActor) {
    try {
      const out = await reader.auth.signOut({ scope: "global" });
      if (out.error) errors.push(out.error);
      sql(
        `update profiles set is_active=false where id=${quote(readerActor)};delete from auth.refresh_tokens where user_id=${quote(readerActor)};update auth.sessions set not_after=now() where user_id=${quote(readerActor)};`,
      );
      const ban = await admin.auth.admin.updateUserById(readerActor, {
        ban_duration: "876000h",
      });
      if (ban.error) errors.push(ban.error);
    } catch (e) {
      errors.push(e);
    }
  }
  assert.deepEqual(policies(), {
    runtime: 0,
    worker: 0,
    release: 0,
    disclosure: 0,
    outbox: 0,
  });
}
if (errors.length)
  throw new AggregateError(
    [failure, ...errors].filter(Boolean),
    "Synthetic staging cleanup failed",
  );
if (failure) throw failure;
assert.ok(proof);
const cleanup = sql(
  `select (select count(*) from profiles where id in (${quote(actor!)},${quote(readerActor!)}) and is_active) as active_profiles,(select count(*) from pets where id=${quote(pet!)} and archived_at is null) as active_patients,(select count(*) from auth.sessions where user_id in (${quote(actor!)},${quote(readerActor!)}) and (not_after is null or not_after>now())) as open_sessions,(select count(*) from storage.objects where bucket_id='diagnostic-pdfs' and name=${quote(objectPath!)}) as objects;`,
)[0];
assert.ok(Object.values(cleanup).every((v) => v === 0));
writeFileSync(
  dir + "/auth-proof.json",
  JSON.stringify(
    { ...proof, checks: checks + 4, cleanup, policies: policies() },
    null,
    2,
  ),
  { mode: 0o600 },
);
console.log(
  JSON.stringify({
    ...proof,
    checks: checks + 4,
    cleanup,
    policies: policies(),
  }),
);
