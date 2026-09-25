import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  stripVercelSystemPublicEnv,
  verifyDeploymentEnvironment,
} from "../../scripts/deployment-environment.mjs";

const project = "mgadheotkdnrsatfivjy";
const staging = "abcdefghijklmnopqrst";
const valid = () => ({
  VERCEL_ENV: "production",
  VITE_SUPABASE_PROJECT_ID: project,
  VITE_SUPABASE_URL: `https://${project}.supabase.co`,
  VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic_test_only",
});
const jwt = (role: string, ref = project) => [
  Buffer.from('{"alg":"HS256"}').toString("base64url"),
  Buffer.from(JSON.stringify({ role, ref })).toString("base64url"),
  "synthetic_signature",
].join(".");

test("explicit production and isolated preview configuration pass", () => {
  assert.equal(verifyDeploymentEnvironment(valid(), valid()).target, "production");
  const env = { ...valid(), VERCEL_ENV: "preview", VITE_SUPABASE_PROJECT_ID: staging, VITE_SUPABASE_URL: `https://${staging}.supabase.co` };
  assert.equal(verifyDeploymentEnvironment(env, env).target, "preview");
  const legacy = { ...valid(), VITE_SUPABASE_PUBLISHABLE_KEY: jwt("anon") };
  assert.equal(verifyDeploymentEnvironment(legacy, legacy).project, project);
});

test("repository fallback and unknown deployment targets fail before building", () => {
  for (const name of ["VITE_SUPABASE_PROJECT_ID", "VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY"]) {
    const env: Record<string, string> = valid();
    delete env[name];
    assert.throws(() => verifyDeploymentEnvironment(env, valid()), /explicitly/);
  }
  assert.throws(() => verifyDeploymentEnvironment({ ...valid(), VERCEL_ENV: "development" }, valid()), /VERCEL_ENV/);
  assert.throws(() => verifyDeploymentEnvironment({ ...valid(), NODE_ENV: "development" }, valid()), /NODE_ENV/);
  assert.throws(() => verifyDeploymentEnvironment(valid(), { ...valid(), VITE_SUPABASE_URL: "https://wrong.example" }), /differs/);
});

test("cross-environment and misleading backend URLs are rejected", () => {
  const cases = [
    { VERCEL_ENV: "preview" },
    { VITE_SUPABASE_PROJECT_ID: staging, VITE_SUPABASE_URL: `https://${staging}.supabase.co` },
    { VITE_SUPABASE_PROJECT_ID: "ugpyjacqganaqtsiekay", VITE_SUPABASE_URL: "https://ugpyjacqganaqtsiekay.supabase.co" },
    ...["/", "?key=hidden", ".attacker.example", ":443"].map((suffix) => ({ VITE_SUPABASE_URL: `${valid().VITE_SUPABASE_URL}${suffix}` })),
    { VITE_SUPABASE_URL: "http://127.0.0.1:56321" },
  ];
  for (const delta of cases) {
    const env = { ...valid(), ...delta };
    assert.throws(() => verifyDeploymentEnvironment(env, env));
  }
});

test("secret, service-role, mismatched and malformed keys never appear in errors", () => {
  for (const key of ["sb_secret_NEVER_PRINT_THIS", jwt("service_role"), jwt("anon", staging), "malformed.NEVER_PRINT_THIS.token", " sb_publishable_whitespace"]) {
    const env = { ...valid(), VITE_SUPABASE_PUBLISHABLE_KEY: key };
    assert.throws(() => verifyDeploymentEnvironment(env, env), (error: Error) => {
      assert.ok(!error.message.includes(key));
      assert.ok(!error.message.includes("NEVER_PRINT_THIS"));
      return true;
    });
  }
  assert.throws(() => verifyDeploymentEnvironment(valid(), { ...valid(), VITE_PROVIDER_SECRET: "NEVER_PRINT_THIS" }), (error: Error) => {
    assert.match(error.message, /unreviewed VITE_/);
    assert.match(error.message, /VITE_PROVIDER_SECRET/);
    assert.ok(!error.message.includes("NEVER_PRINT_THIS"));
    return true;
  });
});

test("contact configuration cannot route a new site's inquiries into another backend", () => {
  const configured = { ...valid(), VITE_CONTACT_INTAKE_URL: `${valid().VITE_SUPABASE_URL}/functions/v1/public-contact`, VITE_CONTACT_TURNSTILE_SITE_KEY: "synthetic_public_site_key" };
  assert.equal(verifyDeploymentEnvironment(configured, configured).contactEnabled, true);
  for (const delta of [
    { VITE_CONTACT_TURNSTILE_SITE_KEY: "" },
    { VITE_CONTACT_INTAKE_URL: "" },
    { VITE_CONTACT_INTAKE_URL: "https://other.example/intake" },
  ]) {
    const env = { ...configured, ...delta };
    assert.throws(() => verifyDeploymentEnvironment(env, env));
  }
});

test("vercel system VITE metadata is stripped before public allowlist checks", () => {
  const env = {
    ...valid(),
    VITE_VERCEL_BRANCH_URL: "livingroom-vet-care-git-main.example.vercel.app",
    VITE_VERCEL_DEPLOYMENT_ID: "dpl_synthetic",
    VITE_VERCEL_ENV: "production",
    VITE_VERCEL_GIT_COMMIT_SHA: "46cb15e",
    VITE_VERCEL_OBSERVABILITY_CLIENT_CONFIG: "synthetic-observability",
    VITE_VERCEL_PROJECT_ID: "prj_synthetic",
    VITE_VERCEL_URL: "livingroom-vet-care.example.vercel.app",
  };
  stripVercelSystemPublicEnv(env);
  assert.deepEqual(
    Object.keys(env).filter((name) => name.startsWith("VITE_VERCEL_")),
    [],
  );
  assert.equal(verifyDeploymentEnvironment(env, env).target, "production");
});

test("actual deployment entry point ignores a complete .env fallback and exits without Vite building", () => {
  const directory = mkdtempSync(join(tmpdir(), "lrv-deployment-guard-"));
  try {
    writeFileSync(join(directory, ".env"), Object.entries(valid()).map(([name, value]) => `${name}=${value}`).join("\n"));
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("VITE_") && name !== "VERCEL_ENV"));
    const child = spawnSync(process.execPath, [new URL("../../scripts/build-deployment.mjs", import.meta.url).pathname], {
      cwd: directory,
      env: { ...env, VERCEL_ENV: "production" },
      encoding: "utf8",
    });
    assert.equal(child.status, 1);
    assert.match(child.stderr, /explicitly/);
    assert.ok(!child.stdout.includes("building"));
    assert.ok(!`${child.stdout}${child.stderr}`.includes("synthetic_test_only"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
