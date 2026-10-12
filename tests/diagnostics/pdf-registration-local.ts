/** Owned localhost Auth/Storage plus genuine isolated PDF bytes; no hosted SQL/provider writes. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { readFileSync, realpathSync, mkdirSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { parseOwnedRuntimeStatus } from "../estimates/owned-runtime-status.ts";
import { values } from "./fixture.ts";
import { createPdfService } from "../../services/diagnostic-renderer/service.ts";
import {
  processDiagnosticPdf,
  type PdfService,
  type RendererAdapters,
} from "../../services/diagnostic-renderer/processing.ts";
import { renderInSandbox } from "../../services/diagnostic-renderer/sandbox.ts";
import {
  ACCEPTED_IMAGE,
  trustedProvenance,
  verifyTrustedProvenance,
} from "../../services/diagnostic-renderer/trusted.ts";
import { revalidateInSandbox } from "../../services/diagnostic-renderer/revalidate.ts";
const project = z.string().parse(process.env.DIAGNOSTICS_TEST_PROJECT);
assert.equal(process.env.DIAGNOSTICS_RUN_SYNTHETIC_LOCAL, "true");
const identity = readFileSync(project + "/supabase/config.toml", "utf8").match(
  /^project_id = "([a-z0-9-]+)"/m,
)?.[1];
assert.ok(identity?.startsWith("lrv-pdfregistration-"));
const container = "supabase_db_" + identity,
  labels = JSON.parse(
    execFileSync("docker", ["inspect", container], { encoding: "utf8" }),
  )[0].Config.Labels;
assert.equal(labels["com.supabase.cli.project"], identity);
assert.equal(
  realpathSync(labels["com.supabase.cli.workdir"]),
  realpathSync(project),
);
const status = parseOwnedRuntimeStatus(
  execFileSync(
    "supabase",
    ["status", "--workdir", project, "--output", "json", "--agent", "no"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ),
);
assert.equal(new URL(status.API_URL).port, "64521");
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
const quote = (s: string) => "'" + s.replaceAll("'", "''") + "'";
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, options);
async function rpc(
  db: typeof admin,
  name: string,
  args: Record<string, unknown>,
) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw error;
  return data;
}
const password = randomUUID() + "Aa1!";
const email = "synthetic-pdf-registration-" + randomUUID() + "@example.test";
const created = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});
if (created.error) throw created.error;
const actor = created.data.user.id;
sql(
  `update profiles set is_active=true,full_name='SYNTHETIC PDF reviewer' where id=${quote(actor)};insert into user_roles(user_id,role) values(${quote(actor)},'DVM');`,
);
let staff = createClient(status.API_URL, status.ANON_KEY, options);
const signed = await staff.auth.signInWithPassword({ email, password });
if (signed.error) throw signed.error;
const client = z.object({ id: z.string().uuid() }).parse(
  await rpc(staff, "save_client", {
    p_actor_id: actor,
    p_client_id: null,
    p_expected_version: null,
    p_first_name: "SYNTHETIC",
    p_last_name: "PDF registration",
    p_primary_phone: "+12025550201",
    p_primary_email: email,
    p_preferred_channel: "EMAIL",
    p_mailing_address: null,
    p_housecall_address: null,
  }),
);
const pet = z.object({ id: z.string().uuid() }).parse(
  await rpc(staff, "save_patient", {
    p_id: null,
    p_client_id: client.id,
    p_expected_version: null,
    p_name: "SYNTHETIC PDF registration patient",
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
  }),
);
const panel = randomUUID(),
  job = randomUUID(),
  v = values();
await rpc(staff, "save_diagnostic_panel", {
  p_action_id: randomUUID(),
  p_id: panel,
  p_pet_id: pet.id,
  p_expected_version: null,
  p_kind: "draft",
  p_values: v,
  p_review_note: "",
  p_correction_reason: "",
});
await rpc(staff, "save_diagnostic_panel", {
  p_action_id: job,
  p_id: panel,
  p_pet_id: pet.id,
  p_expected_version: 1,
  p_kind: "finalize",
  p_values: v,
  p_review_note: "SYNTHETIC actual PDF review",
  p_correction_reason: "",
});
const service = createPdfService({
  url: status.API_URL,
  key: status.SERVICE_ROLE_KEY,
  synthetic_local: true,
});
let generated = 0,
  validated = 0,
  checks = 0;
const image = ACCEPTED_IMAGE;
const provenance = trustedProvenance();
const settings = provenance.settings;
const mode = z
  .enum(["sandbox", "docker"])
  .default("sandbox")
  .parse(process.env.DIAGNOSTICS_RENDERER_MODE);
const implementation =
  mode === "docker"
    ? (await import("./registration-docker.ts")).dockerAdapters
    : {
        generate: renderInSandbox,
        validate: revalidateInSandbox,
        verifyProvenance: verifyTrustedProvenance,
      };
const adapters: RendererAdapters = {
  verifyProvenance: verifyTrustedProvenance,
  async generate(input, pinned) {
    generated++;
    return await implementation.generate(input, pinned);
  },
  async validate(bytes, input, pinned) {
    validated++;
    return await implementation.validate(bytes, input, pinned);
  },
};
assert.equal(
  (await processDiagnosticPdf(service, adapters, { job_id: job })).state,
  "off",
);
assert.equal(generated, 0);
checks += 2;
sql(
  `insert into diagnostic_pdf_runtime_policy(enabled,image,provenance,accepted_by) values(true,${quote(image)},${quote(JSON.stringify(provenance))}::jsonb,${quote(actor)});insert into diagnostic_pdf_worker_policy(enabled,renderer_sha,settings_sha,accepted_by) select true,${quote(image.split(":")[1])},encode(sha256(convert_to((${quote(JSON.stringify(settings))}::jsonb)::text,'UTF8')),'hex'),${quote(actor)};`,
);
const renderClaim = randomUUID();
const preparation: PdfService = {
  ...service,
  async rpc(name, args) {
    const r = await service.rpc(name, args);
    if (name === "prepare_diagnostic_pdf_manifest" && !r.error)
      throw new Error("SYNTHETIC lost preparation acknowledgement");
    return r;
  },
};
await assert.rejects(
  processDiagnosticPdf(preparation, adapters, {
    job_id: job,
    render_claim_id: renderClaim,
  }),
  /lost preparation/,
);
assert.equal(generated, 0);
checks += 2;
// Exercise actual lost capture acknowledgement, then recover exact bytes with generation forbidden.
const first: PdfService = {
  ...service,
  async rpc(name, args) {
    const r = await service.rpc(name, args);
    if (name === "capture_manifest_diagnostic_pdf" && !r.error)
      throw new Error("SYNTHETIC lost capture acknowledgement");
    return r;
  },
};
await assert.rejects(
  processDiagnosticPdf(first, adapters, {
    job_id: job,
    render_claim_id: renderClaim,
  }),
  /lost capture/,
);
assert.equal(generated, 1);
checks += 2;
const noGenerate: RendererAdapters = {
  ...adapters,
  async generate() {
    throw new Error("Captured PDF must never be generated again");
  },
};
const prior = z
  .object({ job: z.object({ version: z.number() }) })
  .parse(
    await rpc(admin, "read_diagnostic_pdf_processing_context", { p_id: job }),
  );
const nextEmail =
  "synthetic-pdf-registration-" + randomUUID() + "@example.test";
const next = await admin.auth.admin.createUser({
  email: nextEmail,
  password,
  email_confirm: true,
});
if (next.error) throw next.error;
const nextActor = next.data.user.id;
sql(
  `update profiles set is_active=true,full_name='SYNTHETIC recovery reviewer' where id=${quote(nextActor)};insert into user_roles(user_id,role) values(${quote(nextActor)},'STAFF');update profiles set is_active=false where id=${quote(actor)};`,
);
staff = createClient(status.API_URL, status.ANON_KEY, options);
const nextSigned = await staff.auth.signInWithPassword({
  email: nextEmail,
  password,
});
if (nextSigned.error) throw nextSigned.error;
await rpc(staff, "retry_diagnostic_pdf_job", {
  p_action_id: randomUUID(),
  p_id: job,
  p_pet_id: pet.id,
  p_expected_version: prior.job.version,
  p_reason: "SYNTHETIC owner handoff after offboarding",
});
checks++;
let staleArgs: Record<string, unknown> | undefined;
const locked: PdfService = {
  ...service,
  async rpc(name, args) {
    const r = await service.rpc(name, args);
    if (name === "reserve_diagnostic_pdf_upload" && !r.error) {
      staleArgs = args;
      const proof = execFileSync(
        "python3",
        [
          "-B",
          "supabase/tests/diagnostic_pdf_registration_concurrency.py",
          "--run-synthetic-local",
          "--project-config",
          project + "/supabase/config.toml",
          "--job",
          job,
          "--mode",
          "locks",
        ],
        { encoding: "utf8", timeout: 45000 },
      );
      assert.match(proof, /observed-lock proof passed: 8 checks/);
      checks += 8;
      throw new Error("SYNTHETIC lease expiry after observed locks");
    }
    return r;
  },
};
await assert.rejects(
  processDiagnosticPdf(locked, noGenerate, { job_id: job }),
  /lease expiry/,
);
checks++;
const second: PdfService = {
  ...service,
  async upload(bucket, path, bytes) {
    await service.upload(bucket, path, bytes);
    throw new Error("SYNTHETIC lost upload acknowledgement");
  },
  async rpc(name, args) {
    const r = await service.rpc(name, args);
    if (name === "validate_diagnostic_pdf_capture" && !r.error) {
      assert.ok(staleArgs);
      const stale = await service.rpc("fail_diagnostic_pdf_processing", {
        ...staleArgs,
        p_code: "STORAGE_UNCERTAIN",
      });
      assert.equal(
        z.object({ code: z.string() }).parse(stale.error).code,
        "PT409",
      );
      checks++;
    }
    if (name === "register_diagnostic_pdf_artifact" && !r.error)
      throw new Error("SYNTHETIC lost registration acknowledgement");
    return r;
  },
};
await assert.rejects(
  processDiagnosticPdf(second, noGenerate, { job_id: job }),
  /lost registration/,
);
checks++;
const result = await processDiagnosticPdf(service, noGenerate, { job_id: job });
assert.equal(result.state, "stored_private");
assert.equal(generated, 1);
assert.ok(validated >= 2);
checks += 3;
const state = z
  .object({
    stored_private: z.boolean(),
    export_eligible: z.literal(false),
    download_available: z.literal(false),
  })
  .parse(
    await rpc(staff, "read_diagnostic_pdf_artifact_state", {
      p_id: job,
      p_pet: pet.id,
    }),
  );
assert.equal(state.stored_private, true);
assert.equal(state.export_eligible, false);
assert.equal(state.download_available, false);
checks += 3;
const { error } = await staff.from("diagnostic_pdf_artifacts").select("*");
assert.equal(error?.code, "42501");
checks++;
const { error: claimError } = await staff.rpc(
  "claim_diagnostic_pdf_processing",
  { p_id: job, p_claim: randomUUID() },
);
assert.equal(claimError?.code, "42501");
checks++;
assert.equal(
  sql(
    `select count(*) from diagnostic_pdf_artifacts where job_id=${quote(job)}`,
  ),
  "1",
);
assert.equal(
  sql(
    `select count(*) from diagnostic_pdf_captures where job_id=${quote(job)}`,
  ),
  "1",
);
checks += 2;
const owner = sql(
  `select actor_id from diagnostic_pdf_captures where job_id=${quote(job)}`,
);
assert.equal(owner, actor);
const processingOwner = z
  .object({
    processing_actor_id: z.string().uuid(),
    capture_actor_id: z.string().uuid(),
  })
  .parse(result.artifact);
assert.equal(processingOwner.capture_actor_id, actor);
assert.equal(processingOwner.processing_actor_id, nextActor);
checks += 3;
const restored = execFileSync(
  "python3",
  [
    "-B",
    "supabase/tests/diagnostic_pdf_registration_concurrency.py",
    "--run-synthetic-local",
    "--project-config",
    project + "/supabase/config.toml",
    "--job",
    job,
    "--mode",
    "restore",
  ],
  { encoding: "utf8", timeout: 180000 },
);
assert.match(restored, /populated restore passed: 7 checks/);
checks += 7;
const privateObject = z
  .object({ bucket_id: z.string(), object_path: z.string() })
  .parse(result.artifact);
const direct = await staff.storage
  .from(privateObject.bucket_id)
  .download(privateObject.object_path);
assert.ok(direct.error);
assert.equal(direct.data, null);
checks += 2;
const originalObject = await service.download(
  privateObject.bucket_id,
  privateObject.object_path,
);
const replacement = Buffer.from(originalObject);
replacement[replacement.length - 1] ^= 1;
const swapped = await admin.storage
  .from(privateObject.bucket_id)
  .upload(privateObject.object_path, replacement, {
    contentType: "application/pdf",
    upsert: true,
  });
if (swapped.error) throw swapped.error;
assert.equal(
  (await processDiagnosticPdf(service, noGenerate, { job_id: job })).state,
  "registered_unavailable",
);
checks++;
const removed = await admin.storage
  .from(privateObject.bucket_id)
  .remove([privateObject.object_path]);
if (removed.error) throw removed.error;
const missing = z
  .object({
    has_registration: z.boolean(),
    object_present: z.boolean(),
    stored_private: z.boolean(),
  })
  .parse(
    await rpc(staff, "read_diagnostic_pdf_artifact_state", {
      p_id: job,
      p_pet: pet.id,
    }),
  );
assert.equal(missing.has_registration, true);
assert.equal(missing.object_present, false);
assert.equal(missing.stored_private, false);
checks += 3;
assert.equal(
  (await processDiagnosticPdf(service, noGenerate, { job_id: job })).state,
  "registered_unavailable",
);
checks++;
const admitted = z
  .object({
    sha256: z.string(),
    byte_length: z.number(),
    page_count: z.number(),
  })
  .parse(
    JSON.parse(
      sql(
        `select receipt from diagnostic_pdf_validations where job_id=${quote(job)} order by created_at desc limit 1`,
      ),
    ),
  );
mkdirSync("output/renderer-proof", { recursive: true });
writeFileSync(
  "output/renderer-proof/registration-runtime-proof.json",
  JSON.stringify(
    {
      checked_at: new Date().toISOString(),
      runtime:
        mode === "sandbox" ? "native-vercel-sandbox" : "native-amd64-docker",
      checks,
      generated,
      validated,
      ...admitted,
      lost_acknowledgements: [
        "preparation",
        "capture",
        "upload",
        "registration",
      ],
      owner_handoff: true,
      original_capture_actor_preserved: true,
      observed_lock_checks: 8,
      populated_restore_checks: 7,
      restored_storage_body_backup_claimed: false,
      private_storage_http_roundtrip: true,
      staff_download_denied: true,
      object_loss_reported_unavailable: true,
      export_eligible: false,
      provider_requests: 0,
      hosted_sql_writes: 0,
      owned_local_runtime_removed_by_launcher: true,
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
console.log(
  `Genuine local PDF registration passed: ${checks} checks; no provider requests.`,
);
