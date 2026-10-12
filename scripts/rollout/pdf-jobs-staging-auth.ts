/** Explicit staging-only synthetic Auth/Storage/Patient360 proof; no provider calls. */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import {
  detailSchema,
  pageSchema,
  historySchema,
  trendsSchema,
  type DiagnosticValues,
} from "../../src/hub/features/diagnostics/model.ts";
import {pdfJobDetailSchema,pdfClaimSchema,pdfClaimContextSchema,captureMetadataSchema,pdfCaptureSchema} from "../../src/hub/features/diagnostics/pdf-jobs/model.ts";
import { values } from "../../tests/diagnostics/fixture.ts";
const project = "kothoqicubowyhwfsrte";
assert.equal(process.env.DIAGNOSTICS_USE_HOSTED_PREVIEW,"true","Approved deployed preview required");
const hostedPreview=process.env.DIAGNOSTICS_USE_HOSTED_PREVIEW==="true";
const origin=hostedPreview?"https://livingroom-vet-care-ia33hg1t0-daves-projects-e0da43ba.vercel.app":"http://127.0.0.1:64281";
if(hostedPreview){
 assert.ok(process.env.VERCEL_OIDC_TOKEN,"Short-lived scoped Vercel authentication required");
 const response=await fetch(origin,{headers:{"x-vercel-trusted-oidc-idp-token":process.env.VERCEL_OIDC_TOKEN!}});
 assert.equal(response.status,200,"Protected preview origin access required before fixture creation");
 assert.match(await response.text(),/index-BQYSMRvl\.js/,"Exact approved preview bundle required");
}
assert.equal(process.env.DIAGNOSTICS_RUN_SYNTHETIC_STAGING, "true");
const raw = JSON.parse(execFileSync("supabase", ["projects","api-keys","--project-ref",project,"--reveal","--output","json"], {encoding:"utf8",stdio:["ignore","pipe","pipe"]}));
const keys = Array.isArray(raw) ? raw : raw.rows;
const status = {API_URL:`https://${project}.supabase.co`, SERVICE_ROLE_KEY:keys.find(k=>k.name==="service_role")?.api_key || keys.find(k=>k.type==="secret")?.api_key, ANON_KEY:keys.find(k=>k.name==="anon")?.api_key || keys.find(k=>k.type==="publishable")?.api_key};
assert.ok(status.SERVICE_ROLE_KEY && status.ANON_KEY);
const sql = (query:string) => {
 const raw=JSON.parse(execFileSync("supabase",["db","query","--linked","--project-ref",project,query,"--output-format","json"],{encoding:"utf8",stdio:["ignore","pipe","pipe"]}));
 const rows=Array.isArray(raw)?raw:raw.rows;
 return rows.map(r=>Object.values(r).map(v=>typeof v==="object"?JSON.stringify(v):String(v)).join("|")).join("\n");
};
assert.equal(sql("select count(*) from record_release_policy;"),"0");
assert.equal(sql("select count(*) from record_request_disclosure_policy;"),"0");
assert.equal(sql("select count(*) from communication_outbox;"),"0");
assert.equal(sql("select count(*) from diagnostic_pdf_worker_policy;"),"0");
const patients: Array<{id:string;args:Record<string,unknown>}>=[];
let documentId:string|null=null;
let pdfPolicy:{renderer:string;settings:string;actor:string}|null=null;
function removeTestPolicy(){
 if(pdfPolicy){
  sql(`delete from diagnostic_pdf_worker_policy where renderer_sha='${pdfPolicy.renderer}' and settings_sha='${pdfPolicy.settings}' and accepted_by='${pdfPolicy.actor}';`);
  assert.equal(sql("select count(*) from diagnostic_pdf_worker_policy;"),"0");
  pdfPolicy=null;
 }
}
let staffIdentity:Actor|null=null;
function saveFixtureIds(){
 writeFileSync("tmp/pdf-jobs-rollout/staging-fixtures.json",JSON.stringify({project,actors:actors.map(a=>a.id),pets:patients.map(p=>p.id),document_id:documentId},null,2),{mode:0o600});
}
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(status.API_URL, status.SERVICE_ROLE_KEY, options);
interface Actor {
  id: string;
  db: SupabaseClient;
  session: unknown;
}
const actors: Actor[] = [];
async function actor(role: "DVM" | "STAFF" | "ADMIN") {
  const email = `synthetic-diagnostic-${randomUUID()}@example.test`,
    password = randomUUID() + randomUUID();
  const created = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error) throw created.error;
  const id = created.data.user!.id;
  const db = createClient(status.API_URL, status.ANON_KEY, options);
  const result:Actor = {id,db,session:null};
  actors.push(result);saveFixtureIds();
  sql(
    `update profiles set is_active=true,full_name='Synthetic ${role} diagnostic reviewer' where id='${id}';insert into user_roles(user_id,role) values('${id}','${role}') on conflict do nothing;`,
  );
  const login = await db.auth.signInWithPassword({ email, password });
  if (login.error) throw login.error;
  result.session=login.data.session;
  return result;
}
async function rpc(
  db: SupabaseClient,
  name: string,
  args: Record<string, unknown> = {},
) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw error;
  return data;
}
async function denied(
  db: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
  code: string,
) {
  const { error } = await db.rpc(name, args);
  assert.equal(error?.code, code);
  checks++;
}
const cleanupErrors: unknown[] = [];
let checks = 0;
let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
let vite: ReturnType<typeof spawn> | null = null;
try {
  const staff = await actor("STAFF"),
    dvm = await actor("DVM"),
    admin = await actor("ADMIN");
  staffIdentity=staff;
  const client = await rpc(staff.db, "save_client", {
    p_actor_id: staff.id,
    p_client_id: null,
    p_expected_version: null,
    p_first_name: "Synthetic",
    p_last_name: "Diagnostics Auth",
    p_primary_phone: "+12025550199",
    p_primary_email: `synthetic-diagnostics-auth-${randomUUID()}@example.test`,
    p_preferred_channel: "EMAIL",
    p_mailing_address: null,
    p_housecall_address: null,
  });
  const patientArgs = {
    p_id: null,
    p_client_id: client.id,
    p_expected_version: null,
    p_name: "Synthetic diagnostics Auth patient",
    p_species: "Dog",
    p_breed: null,
    p_dob: null,
    p_birth_date_precision: "unknown",
    p_color: null,
    p_sex: "unknown",
    p_neuter_status: "unknown",
    p_microchip_id: null,
    p_archived_at: null,
    p_deceased_at: null,
  };
  const pet=await rpc(staff.db,"save_patient",patientArgs);
  patients.push({id:pet.id,args:patientArgs});saveFixtureIds();
  const sibling=await rpc(staff.db,"save_patient",{...patientArgs,p_name:"Synthetic diagnostics Auth sibling"});
  patients.push({id:sibling.id,args:{...patientArgs,p_name:"Synthetic diagnostics Auth sibling"}});saveFixtureIds();
  const docId = randomUUID(),
    bytes = new TextEncoder().encode(
      "%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n",
    );
  const doc = await rpc(staff.db, "prepare_patient_document", {
    p_id: docId,
    p_pet_id: pet.id,
    p_encounter_id: null,
    p_file_name: "synthetic-diagnostic-original.pdf",
    p_mime_type: "application/pdf",
    p_file_size: bytes.length,
    p_category: "lab_result",
    p_source: "Synthetic manual diagnostic source",
    p_document_date: "2026-10-01",
    p_visibility: "internal",
  });
  documentId=docId;saveFixtureIds();
  const upload = await staff.db.storage
    .from("patient-documents")
    .upload(doc.file_path, bytes, {
      contentType: "application/pdf",
      upsert: false,
    });
  if (upload.error) throw upload.error;
  const original = await rpc(staff.db, "finalize_patient_document", {
    p_id: docId,
  });
  assert.equal(original.version, 2);
  checks++;
  const download = await dvm.db.storage
    .from("patient-documents")
    .download(original.file_path);
  if (download.error) throw download.error;
  assert.deepEqual(new Uint8Array(await download.data.arrayBuffer()), bytes);
  checks++;
  const v: DiagnosticValues = {
    ...values(),
    document_id: docId,
    document_version: original.version,
  };
  const panel = randomUUID(),
    args = {
      p_action_id: randomUUID(),
      p_id: panel,
      p_pet_id: pet.id,
      p_expected_version: null,
      p_kind: "draft",
      p_values: v,
      p_review_note: "",
      p_correction_reason: "",
    };
  const draft = detailSchema.parse(
    await rpc(staff.db, "save_diagnostic_panel", args),
  );
  assert.equal(draft.panel.created_by, staff.id);
  assert.equal(draft.panel.draft?.observations[0].value_number, 0);
  checks += 2;
  assert.deepEqual(
    detailSchema.parse(await rpc(staff.db, "save_diagnostic_panel", args)),
    draft,
  );
  checks++;
  assert.deepEqual(
    detailSchema.parse(await rpc(staff.db, "read_diagnostic_action", args)),
    draft,
  );
  checks++;
  await denied(admin.db, "save_diagnostic_panel", args, "23505");
  await denied(
    staff.db,
    "save_diagnostic_panel",
    {
      ...args,
      p_action_id: randomUUID(),
      p_id: randomUUID(),
      p_pet_id: sibling.id,
    },
    "42501",
  );
  await denied(
    staff.db,
    "save_diagnostic_panel",
    {
      ...args,
      p_action_id: randomUUID(),
      p_id: randomUUID(),
      p_values: { ...v, document_version: 1 },
    },
    "PT409",
  );
  const finalize = {
    ...args,
    p_action_id: randomUUID(),
    p_expected_version: 1,
    p_kind: "finalize",
    p_review_note: "Synthetic exact DVM review",
  };
  await denied(staff.db, "save_diagnostic_panel", finalize, "42501");
  await denied(admin.db, "save_diagnostic_panel", finalize, "42501");
  const reviewed = detailSchema.parse(
    await rpc(dvm.db, "save_diagnostic_panel", finalize),
  );
  const jobId = reviewed.current!.id;
  const job = pdfJobDetailSchema.parse(
    await rpc(staff.db, "read_diagnostic_pdf_job", {
      p_id: jobId,
      p_pet_id: pet.id,
    }),
  );
  assert.equal(job.job.status, "pending");
  assert.equal(job.worker_configured, false);
  checks += 2;
  assert.equal(
    await rpc(service, "claim_diagnostic_pdf_job", {
      p_id: jobId,
      p_claim_id: randomUUID(),
    }),
    null,
  );
  checks++;
  await denied(
    staff.db,
    "claim_diagnostic_pdf_job",
    { p_id: jobId, p_claim_id: randomUUID() },
    "42501",
  );
  assert.equal(
    await rpc(staff.db, "read_diagnostic_pdf_job", {
      p_id: jobId,
      p_pet_id: sibling.id,
    }),
    null,
  );
  checks++;
  const renderer = createHash("sha256")
      .update("synthetic renderer fixture")
      .digest("hex"),
    settings = createHash("sha256")
      .update("synthetic print settings")
      .digest("hex");
  pdfPolicy={renderer,settings,actor:dvm.id};
  sql(
    `insert into diagnostic_pdf_worker_policy(enabled,renderer_sha,settings_sha,accepted_by) values(true,'${renderer}','${settings}','${dvm.id}');`,
  );
  const claimId = randomUUID(),
    claim = pdfClaimSchema.parse(
      await rpc(service, "claim_diagnostic_pdf_job", {
        p_id: jobId,
        p_claim_id: claimId,
      }),
    );
  assert.equal(claim.actor_id, dvm.id);
  checks++;
  const ctx = pdfClaimContextSchema.parse(
    await rpc(service, "read_diagnostic_pdf_claim", {
      p_id: jobId,
      p_claim_id: claimId,
      p_fence: claim.fence,
      p_actor_id: dvm.id,
    }),
  );
  assert.equal(
    ctx.snapshot.diagnostic.snapshot.observations[0].value_number,
    0,
  );
  checks++;
  const captureArgs = {
    p_id: jobId,
    p_claim_id: claimId,
    p_fence: claim.fence,
    p_actor_id: dvm.id,
    p_source_hash: claim.source_hash,
    p_snapshot_hash: claim.snapshot_hash,
    p_renderer_sha: renderer,
    p_settings_sha: settings,
    p_base64: Buffer.from(bytes).toString("base64"),
  };
  const captured = captureMetadataSchema.parse(
    await rpc(service, "capture_diagnostic_pdf_bytes", captureArgs),
  );
  assert.equal(
    captured.sha256,
    createHash("sha256").update(bytes).digest("hex"),
  );
  assert.equal(captured.byte_length, bytes.length);
  assert.equal(captured.validation_status, "not_validated");
  assert.equal(captured.export_eligible, false);
  checks += 4;
  assert.deepEqual(
    captureMetadataSchema.parse(
      await rpc(service, "capture_diagnostic_pdf_bytes", captureArgs),
    ),
    captured,
  );
  checks++;
  await denied(
    service,
    "capture_diagnostic_pdf_bytes",
    {
      ...captureArgs,
      p_base64: Buffer.concat([Buffer.from(bytes), Buffer.from("\n")]).toString(
        "base64",
      ),
    },
    "23505",
  );
  const recover = {
    p_id: jobId,
    p_pet_id: pet.id,
    p_actor_id: dvm.id,
    p_source_hash: claim.source_hash,
    p_snapshot_hash: claim.snapshot_hash,
  };
  const recovered = pdfCaptureSchema.parse(
    await rpc(service, "read_diagnostic_pdf_capture", recover),
  );
  assert.deepEqual(Buffer.from(recovered.base64, "base64"), Buffer.from(bytes));
  checks++;
  await denied(staff.db, "read_diagnostic_pdf_capture", recover, "42501");
  await denied(
    service,
    "read_diagnostic_pdf_capture",
    { ...recover, p_pet_id: sibling.id },
    "42501",
  );
  await denied(
    service,
    "read_diagnostic_pdf_capture",
    { ...recover, p_snapshot_hash: "f".repeat(64) },
    "PT409",
  );
  const closedJob = pdfJobDetailSchema.parse(
    await rpc(staff.db, "read_diagnostic_pdf_job", {
      p_id: jobId,
      p_pet_id: pet.id,
    }),
  );
  assert.equal(closedJob.job.status, "captured_unverified");
  assert.equal(closedJob.pdf_status, "not_available");
  checks += 2;
  removeTestPolicy();
  assert.equal(reviewed.current!.reviewed_by, dvm.id);
  assert.equal(reviewed.current!.entered_by, staff.id);
  assert.equal(reviewed.current!.original_current_available, true);
  checks += 3;
  assert.equal(
    await rpc(dvm.db, "read_diagnostic_panel", {
      p_id: panel,
      p_pet_id: sibling.id,
    }),
    null,
  );
  checks++;
  const census = trendsSchema.parse(
    await rpc(dvm.db, "list_diagnostic_trends", {
      p_pet_id: pet.id,
      p_limit: 1,
    }),
  );
  assert.equal(census.items[0].snapshot.observations[0].value_number, 0);
  checks++;
  const next = structuredClone(v);
  next.observations[0].value_number = 2;
  const savedCorrection = detailSchema.parse(
    await rpc(staff.db, "save_diagnostic_panel", {
      ...args,
      p_action_id: randomUUID(),
      p_expected_version: 2,
      p_values: next,
    }),
  );
  assert.equal(savedCorrection.current!.number, 1);
  checks++;
  const corrected = detailSchema.parse(
    await rpc(dvm.db, "save_diagnostic_panel", {
      ...finalize,
      p_action_id: randomUUID(),
      p_expected_version: 3,
      p_values: next,
      p_correction_reason: "Synthetic transcription correction",
    }),
  );
  assert.equal(corrected.current!.number, 2);
  checks++;
  const history = historySchema.parse(
    await rpc(staff.db, "list_diagnostic_history", {
      p_id: panel,
      p_pet_id: pet.id,
    }),
  );
  assert.deepEqual(
    history.items.map((x) => x.snapshot.observations[0].value_number),
    [2, 0],
  );
  checks++;
  await denied(
    dvm.db,
    "list_diagnostic_trends",
    { p_pet_id: pet.id, p_census_hash: census.census_hash },
    "PT409",
  );
  assert.deepEqual(
    detailSchema.parse(await rpc(dvm.db, "save_diagnostic_panel", finalize)),
    reviewed,
  );
  checks++;
  const page = pageSchema.parse(
    await rpc(staff.db, "list_diagnostic_panels", { p_pet_id: pet.id }),
  );
  assert.equal(page.items.length, 1);
  checks++;
  await rpc(staff.db, "void_patient_document", {
    p_id: docId,
    p_expected_version: original.version,
    p_reason: "Synthetic original voided after review",
  });
  const afterVoid = detailSchema.parse(
    await rpc(dvm.db, "read_diagnostic_panel", {
      p_id: panel,
      p_pet_id: pet.id,
    }),
  );
  assert.equal(afterVoid.current!.original_current_available, false);
  assert.equal(afterVoid.current!.source_context.document!.version, 2);
  checks += 2;
  const anon = createClient(status.API_URL, status.ANON_KEY, options);
  await denied(anon, "list_diagnostic_panels", { p_pet_id: pet.id }, "42501");
  await denied(
    service,
    "list_diagnostic_panels",
    { p_pet_id: pet.id },
    "42501",
  );
  await denied(
    staff.db,
    "diagnostic_detail",
    { p_id: panel, p_pet_id: pet.id },
    "42501",
  );
  assert.equal(sql("select count(*) from communication_outbox;"), "0");
  assert.equal(sql("select count(*) from record_release_policy;"), "0");
  assert.equal(
    sql("select count(*) from record_request_disclosure_policy;"),
    "0",
  );
  checks += 3;
  // Reviewed Patient360 source served by an owned local Vite against genuine staging; hosted bundle is independently verified. No mocks or private browser keys.
  if(!hostedPreview){
  const net = await import("node:net");
  await new Promise<void>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(64281, "127.0.0.1", () => server.close(() => resolve()));
  });
  vite = spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "--host",
      "127.0.0.1",
      "--port",
      "64281",
      "--strictPort",
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        VITE_SUPABASE_URL: status.API_URL,
        VITE_SUPABASE_PUBLISHABLE_KEY: status.ANON_KEY,
      },
      stdio: "ignore",
    },
  );
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (vite.exitCode !== null) throw new Error("Owned Vite exited");
    try {
      const r = await fetch("http://127.0.0.1:64281");
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {
      /* Owned frontend is still starting. */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(ready, "Owned local frontend ready");
  }
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1200, height: 1000 },
  });
  if(hostedPreview) await context.route("**/*",async route=>{
    const headers=route.request().headers();
    if(new URL(route.request().url()).origin===origin)headers["x-vercel-trusted-oidc-idp-token"]=process.env.VERCEL_OIDC_TOKEN!;
    else delete headers["x-vercel-trusted-oidc-idp-token"];
    await route.continue({headers});
  });
  await context.addInitScript(
    ({ session, key }) => {
      localStorage.setItem(key, JSON.stringify(session));
    },
    { session: dvm.session, key: "sb-kothoqicubowyhwfsrte-auth-token" },
  );
  const p = await context.newPage();
  await p.goto(`${origin}/hub/patient/${pet.id}?tab=medical`);
  await p
    .getByRole("heading", { name: "In-house diagnostics", exact: true })
    .waitFor();
  await p
    .getByRole("button", { name: "Open in-house diagnostics", exact: true })
    .click();
  await p
    .getByRole("button", { name: "Open diagnostic panel", exact: true })
    .click();
  await p
    .getByRole("heading", { name: "Reviewed version 2", exact: true })
    .waitFor();
  checks++;
  await p
    .getByRole("button", { name: "New in-house panel", exact: true })
    .click();
  for (const [label, text] of [
    ["Panel name", "Synthetic browser chemistry"],
    ["Specimen", "Serum"],
    ["Method / device", "Synthetic device"],
    ["Manual source", "Manual in-house"],
    ["Collection / observation date", "2026-10-01"],
    ["Report date", "2026-10-02"],
    ["Analyte identity", "synthetic-alt"],
    ["Original analyte label", "ALT"],
    ["Numeric value", "0"],
    ["Original unit (use 1 for dimensionless)", "U/L"],
  ])
    await p.getByLabel(label, { exact: true }).fill(text);
  await p
    .getByRole("button", { name: "Save diagnostic draft", exact: true })
    .click();
  await p
    .getByText("Diagnostic draft saved; clinical review pending.", {
      exact: true,
    })
    .waitFor();
  await p
    .getByLabel("Review note", { exact: true })
    .fill("Synthetic browser veterinarian review");
  await p.getByRole("checkbox", { name: /I reviewed every finding/ }).check();
  await p
    .getByRole("button", {
      name: "Finalize reviewed diagnostic version",
      exact: true,
    })
    .click();
  await p
    .getByText(
      "Reviewed diagnostic version saved. PDF and record sharing are pending.",
      { exact: true },
    )
    .waitFor();
  checks++;
  assert.equal(
    pageSchema.parse(
      await rpc(dvm.db, "list_diagnostic_panels", { p_pet_id: pet.id }),
    ).items.length,
    2,
  );
  checks++;
  await p.reload();
  await p
    .getByRole("heading", { name: "In-house diagnostics", exact: true })
    .waitFor();
  await p.getByRole("img", { name: /ALT reviewed values/ }).waitFor();
  checks++;
  mkdirSync(hostedPreview?"output/pdf-jobs-staging-hosted":"output/diagnostics-staging", { recursive: true });
  await p
    .getByRole("heading", { name: "In-house diagnostics", exact: true })
    .scrollIntoViewIfNeeded();
  await p.screenshot({ path: hostedPreview?"output/pdf-jobs-staging-hosted/desktop.png":"output/diagnostics-staging/desktop.png" });
  await p.setViewportSize({ width: 390, height: 844 });
  await p
    .getByRole("heading", { name: "In-house diagnostics", exact: true })
    .scrollIntoViewIfNeeded();
  assert.ok(
    await p.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  );
  checks++;
  await p.screenshot({ path: hostedPreview?"output/pdf-jobs-staging-hosted/mobile.png":"output/diagnostics-staging/mobile.png" });
  console.log(
    `Genuine staging diagnostics Auth/private Storage/Patient 360 browser core passed: ${checks} assertions; no provider requests.`,
  );
} finally {
  try{removeTestPolicy();}catch(e){cleanupErrors.push(e);}
  if (browser) {
    try {
      await browser.close();
    } catch (e) {
      cleanupErrors.push(e);
    }
  }
  if (vite && vite.exitCode === null) {
    try {
      vite.kill("SIGTERM");
      await new Promise((r) => vite!.once("exit", r));
    } catch (e) {
      cleanupErrors.push(e);
    }
  }
  if(staffIdentity){
    if(documentId){try{
      const d=JSON.parse(sql(`select to_jsonb(d) from patient_documents d where id='${documentId}';`));
      if(d.status==="ready") await rpc(staffIdentity.db,"void_patient_document",{p_id:d.id,p_expected_version:d.version,p_reason:"Synthetic staging diagnostics proof closed"});
      if(d.status==="uploading") await rpc(staffIdentity.db,"abandon_patient_document",{p_id:d.id});
    }catch(e){cleanupErrors.push(e);}}
    for(const patient of patients){try{
      const current=JSON.parse(sql(`select to_jsonb(p) from pets p where id='${patient.id}';`));
      await rpc(staffIdentity.db,"save_patient",{...patient.args,p_id:patient.id,p_expected_version:current.version,p_archived_at:new Date().toISOString(),p_deceased_at:current.deceased_at});
    }catch(e){cleanupErrors.push(e);}}
  }
  for (const a of actors) {
    try {
      const signout = await a.db.auth.signOut({ scope: "global" });
      if (signout.error) cleanupErrors.push(signout.error);
      sql(`update profiles set is_active=false where id='${a.id}';delete from auth.refresh_tokens where user_id='${a.id}';update auth.sessions set not_after=now() where user_id='${a.id}';`);
      const ban=await service.auth.admin.updateUserById(a.id,{ban_duration:"876000h"});
      if(ban.error)cleanupErrors.push(ban.error);
    } catch (e) {
      cleanupErrors.push(e);
    }
  }
}
if (cleanupErrors.length)
  throw new AggregateError(cleanupErrors, "Owned diagnostics cleanup failed");

const actorList=actors.map(a=>`'${a.id}'`).join(",");
const petList=patients.map(p=>`'${p.id}'`).join(",");
const closed=JSON.parse(sql(`select jsonb_build_object('active_profiles',(select count(*) from profiles where id in (${actorList}) and is_active),'open_sessions',(select count(*) from auth.sessions where user_id in (${actorList}) and (not_after is null or not_after>now())),'active_patients',(select count(*) from pets where id in (${petList}) and archived_at is null),'ready_originals',(select count(*) from patient_documents where id='${documentId}' and status in ('ready','uploading')),'worker_policy',(select count(*) from diagnostic_pdf_worker_policy),'outbox',(select count(*) from communication_outbox where client_id in (select client_id from pets where id in (${petList})))) as cleanup;`));
for(const count of Object.values(closed)){assert.equal(count,0);checks++;}
console.log(`Genuine staging PDF jobs final proof: ${checks} assertions; cleanup complete; zero provider requests; worker policy restored empty/off.`);
