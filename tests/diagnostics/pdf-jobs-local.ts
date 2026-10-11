/** Owned localhost only: real Auth, PostgREST and private originals; no provider calls. */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { readFileSync, realpathSync, mkdirSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import {
  pdfJobDetailSchema,
  pdfClaimSchema,
  pdfClaimContextSchema,
  captureMetadataSchema,
  pdfCaptureSchema,
} from "../../src/hub/features/diagnostics/pdf-jobs/model.ts";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { parseOwnedRuntimeStatus } from "../estimates/owned-runtime-status.ts";
import {
  detailSchema,
  pageSchema,
  historySchema,
  trendsSchema,
  type DiagnosticValues,
} from "../../src/hub/features/diagnostics/model.ts";
import { values } from "./fixture.ts";
const project = process.env.DIAGNOSTICS_TEST_PROJECT;
assert.ok(
  project && process.env.DIAGNOSTICS_RUN_SYNTHETIC_LOCAL === "true",
  "Explicit owned local opt-in required",
);
const identity = readFileSync(`${project}/supabase/config.toml`, "utf8").match(
  /^project_id\s*=\s*"([a-zA-Z0-9_-]+)"/m,
)?.[1];
assert.ok(identity?.startsWith("lrv-pdfjobs-"));
const container = "supabase_db_" + identity;
const labels = JSON.parse(
  execFileSync("docker", ["inspect", container], { encoding: "utf8" }),
)[0].Config.Labels;
assert.equal(labels["com.supabase.cli.project"], identity);
assert.equal(
  realpathSync(labels["com.supabase.cli.workdir"]),
  realpathSync(project),
);
function safeStatus(): string {
  try {
    return execFileSync(
      "supabase",
      ["status", "--workdir", project, "--output", "json", "--agent", "no"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch {
    throw new Error(
      "Owned local status discovery failed; private output withheld",
    );
  }
}
const status = parseOwnedRuntimeStatus(safeStatus());
const sql = (query: string) =>
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      container,
      "psql",
      "-X",
      "-qAt",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { input: query, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  ).trim();
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
  sql(
    `update profiles set is_active=true,full_name='Synthetic ${role} diagnostic reviewer' where id='${id}';insert into user_roles(user_id,role) values('${id}','${role}') on conflict do nothing;`,
  );
  const login = await db.auth.signInWithPassword({ email, password });
  if (login.error) throw login.error;
  const result = { id, db, session: login.data.session };
  actors.push(result);
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
  const client = await rpc(staff.db, "save_client", {
    p_actor_id: staff.id,
    p_client_id: null,
    p_expected_version: null,
    p_first_name: "Synthetic",
    p_last_name: "Diagnostics Auth",
    p_primary_phone: "+12025550199",
    p_primary_email: "synthetic-diagnostics-auth@example.test",
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
  const pet = await rpc(staff.db, "save_patient", patientArgs),
    sibling = await rpc(staff.db, "save_patient", {
      ...patientArgs,
      p_name: "Synthetic diagnostics Auth sibling",
    });
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
  sql("update diagnostic_pdf_worker_policy set enabled=false;");
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
  // Full real Patient 360 page against this exact owned backend. No mocks, sends or private keys in browser.
  const net = await import("node:net");
  await new Promise<void>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(64381, "127.0.0.1", () => server.close(() => resolve()));
  });
  vite = spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "--host",
      "127.0.0.1",
      "--port",
      "64381",
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
      const r = await fetch("http://127.0.0.1:64381");
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
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1200, height: 1000 },
  });
  await context.addInitScript(
    ({ session, key }) => {
      localStorage.setItem(key, JSON.stringify(session));
    },
    { session: dvm.session, key: "sb-127-auth-token" },
  );
  const p = await context.newPage();
  await p.goto(`http://127.0.0.1:64381/hub/patient/${pet.id}?tab=medical`);
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
  mkdirSync("output/pdf-jobs", { recursive: true });
  await p
    .getByRole("heading", { name: "In-house diagnostics", exact: true })
    .scrollIntoViewIfNeeded();
  await p.screenshot({ path: "output/pdf-jobs/desktop.png" });
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
  await p.screenshot({ path: "output/pdf-jobs/mobile.png" });
  console.log(
    `Genuine local PDF jobs/Auth/byte recovery/Patient 360 browser passed: ${checks} assertions; no provider requests.`,
  );
} finally {
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
  for (const a of actors) {
    try {
      const signout = await a.db.auth.signOut({ scope: "global" });
      if (signout.error) cleanupErrors.push(signout.error);
    } catch (e) {
      cleanupErrors.push(e);
    }
  }
}
if (cleanupErrors.length)
  throw new AggregateError(cleanupErrors, "Owned diagnostics cleanup failed");
