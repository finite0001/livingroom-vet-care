/** Genuine owned Auth/PostgREST/Storage and HTTP handler/browser proof. Not hosted, no provider calls. */
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import {
  createClient,
  type Session,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { finalizedSchema } from "../../src/hub/features/diagnostics/model.ts";
import { chromium } from "playwright";
import { createDiagnosticPdfDownloadHandler } from "../../supabase/functions/_shared/diagnostic-pdf-download.ts";
interface Input {
  url: string;
  anon: string;
  secret: string;
  actor: string;
  session: Session;
  job: string;
  pet: string;
  staff: SupabaseClient;
  admin: SupabaseClient;
  bytes: Uint8Array;
  sql(query: string): string;
  project: string;
}
export async function provePdfDownload(a: Input) {
  assert.equal(a.url, "http://127.0.0.1:64521");
  const quote = (s: string) => "'" + s.replaceAll("'", "''") + "'";
  let checks = 0,
    scopeChecks = 0;
  const handler = createDiagnosticPdfDownloadHandler({
    authenticate: async (token) => {
      const { data, error } = await a.admin.auth.getUser(token);
      if (error || !data.user) return null;
      return {
        actorId: data.user.id,
        db: createClient(a.url, a.anon, {
          auth: { persistSession: false, autoRefreshToken: false },
          global: { headers: { Authorization: `Bearer ${token}` } },
        }),
      };
    },
    service: { rpc: (name, args) => a.admin.rpc(name, args) },
    download: (context) =>
      fetch(
        `${a.url}/storage/v1/object/authenticated/diagnostic-pdfs/${context.object_path}`,
        {
          headers: {
            apikey: a.secret,
            Authorization: `Bearer ${a.secret}`,
            Accept: "application/pdf",
            "Accept-Encoding": "identity",
          },
          redirect: "error",
          signal: AbortSignal.timeout(10000),
        },
      ),
  });
  const make = (id = randomUUID()) =>
    new Request("http://owned.local/functions/v1/download-diagnostic-pdf", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${a.session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id, job_id: a.job, pet_id: a.pet }),
    });
  assert.equal((await handler(make())).status, 409);
  checks++;
  a.sql(
    `insert into diagnostic_pdf_staff_disclosure_policy(enabled,accepted_by) values(true,${quote(a.actor)});`,
  );
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  let vite: ReturnType<typeof spawn> | null = null;
  const gateway = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const c of req) {
        size += c.length;
        if (size > 1100000) throw new Error("Owned request exceeds bound");
        chunks.push(c);
      }
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers))
        if (
          v &&
          !["host", "connection", "content-length", "accept-encoding"].includes(
            k,
          )
        )
          headers.set(k, Array.isArray(v) ? v.join(",") : v);
      const request = new Request(new URL(req.url!, a.url), {
        method: req.method,
        headers,
        ...(req.method === "GET" || req.method === "HEAD"
          ? {}
          : { body: Buffer.concat(chunks) }),
      });
      const response =
        req.url === "/functions/v1/download-diagnostic-pdf"
          ? await handler(request)
          : await fetch(request, { redirect: "error" });
      res.statusCode = response.status;
      response.headers.forEach((v, k) => {
        if (
          !["content-length", "transfer-encoding", "content-encoding"].includes(
            k,
          )
        )
          res.setHeader(k, v);
      });
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      res.statusCode = 503;
      res.end("Owned diagnostic gateway unavailable");
    }
  });
  try {
    const stable = randomUUID();
    const response = await handler(make(stable));
    assert.equal(response.status, 200);
    assert.deepEqual(
      new Uint8Array(await response.arrayBuffer()),
      new Uint8Array(a.bytes),
    );
    checks += 2;
    assert.equal((await handler(make(stable))).status, 200);
    assert.equal(
      a.sql(
        `select count(*) from diagnostic_pdf_download_responses where authority_id=${quote(stable)}`,
      ),
      "1",
    );
    checks += 2;
    a.sql(`update profiles set is_active=false where id=${quote(a.actor)};`);
    assert.equal((await handler(make(stable))).status, 404);
    checks++;
    a.sql(
      `update profiles set is_active=true where id=${quote(a.actor)};update diagnostic_pdf_staff_disclosure_policy set enabled=false;`,
    );
    assert.equal((await handler(make(stable))).status, 409);
    checks++;
    a.sql(
      "update diagnostic_pdf_staff_disclosure_policy set enabled=true,revision=gen_random_uuid();",
    );
    assert.equal((await handler(make(stable))).status, 409);
    checks++;
    // The HTTP gateway forwards Auth/REST/Storage unchanged to the owned backend;
    // only the new Edge route runs its actual shared handler in Node, with genuine getUser and SQL.
    await new Promise<void>((resolve) =>
      gateway.listen(0, "127.0.0.1", resolve),
    );
    const address = gateway.address();
    assert.ok(address && typeof address === "object");
    const backend = `http://127.0.0.1:${address.port}`;
    vite = spawn(
      process.execPath,
      [
        "node_modules/vite/bin/vite.js",
        "--host",
        "127.0.0.1",
        "--port",
        "64581",
        "--strictPort",
      ],
      {
        env: {
          ...process.env,
          VITE_SUPABASE_URL: backend,
          VITE_SUPABASE_PUBLISHABLE_KEY: a.anon,
        },
        stdio: "ignore",
      },
    );
    let ready = false;
    for (let i = 0; i < 100; i++) {
      assert.equal(vite.exitCode, null);
      try {
        if ((await fetch("http://127.0.0.1:64581")).ok) {
          ready = true;
          break;
        }
      } catch {
        /* Owned Vite starting. */
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(ready);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 1000 },
    });
    await context.addInitScript((session) => {
      localStorage.setItem("sb-127-auth-token", JSON.stringify(session));
    }, a.session);
    const page = await context.newPage();
    let pageErrors = 0;
    page.on("pageerror", () => pageErrors++);
    await page.goto(`http://127.0.0.1:64581/hub/patient/${a.pet}?tab=medical`);
    await page
      .getByRole("button", { name: "Open in-house diagnostics", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Open diagnostic panel", exact: true })
      .first()
      .click();
    const section = page
      .getByRole("region", { name: "Diagnostic PDF", exact: true })
      .first();
    await section
      .getByText("Verified PDF stored privately.", { exact: true })
      .waitFor();
    checks++;
    await section
      .getByRole("button", { name: "Review sharing scope", exact: true })
      .click();
    const scope = section.getByRole("region", {
      name: "Diagnostic PDF sharing scope",
      exact: true,
    });
    await scope
      .getByText("Current reviewed PDF · Version 1", { exact: true })
      .waitFor();
    await scope
      .getByText(
        "Sharing is awaiting record-package integration. This review does not authorize sending records.",
        { exact: true },
      )
      .waitFor();
    assert.equal(await scope.locator("li").count(), 1);
    scopeChecks += 3;
    const scopeRaces = execFileSync(
      "python3",
      [
        "-B",
        "supabase/tests/diagnostic_pdf_release_scope_concurrency.py",
        "--run-synthetic-local",
        "--project-config",
        a.project + "/supabase/config.toml",
        "--job",
        a.job,
        "--actor",
        a.actor,
      ],
      { encoding: "utf8", timeout: 45000 },
    );
    assert.match(scopeRaces, /observed-lock proof passed: 4 checks/);
    scopeChecks += 4;
    const binding = a.sql(
      `select diagnostic_pdf_release_binding(${quote(a.job)},${quote(a.pet)},'current')::text;`,
    );
    a.sql(
      `select verify_diagnostic_pdf_release_bytes(${quote(binding)}::jsonb,decode(${quote(Buffer.from(a.bytes).toString("base64"))},'base64'));`,
    );
    scopeChecks++;
    assert.throws(() =>
      a.sql(
        `select verify_diagnostic_pdf_release_bytes(${quote(binding)}::jsonb,decode(${quote(Buffer.from(a.bytes).fill(0, 20, 21).toString("base64"))},'base64'));`,
      ),
    );
    scopeChecks++;
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      const event = page.waitForEvent("download");
      const button = section.getByRole("button", {
        name: "Download verified PDF",
        exact: true,
      });
      await button.click();
      const saved = await event;
      assert.equal(await saved.failure(), null);
      assert.equal(saved.suggestedFilename(), `diagnostic-${a.job}.pdf`);
      const path = await saved.path();
      assert.ok(path);
      assert.deepEqual(
        new Uint8Array(readFileSync(path)),
        new Uint8Array(a.bytes),
      );
      const bounds = await button.boundingBox();
      assert.ok(bounds && bounds.height >= 44);
      checks += 4;
    }
    assert.equal(pageErrors, 0);
    checks++;
    mkdirSync("output/renderer-proof", { recursive: true });
    await page.screenshot({
      path: "output/renderer-proof/pdf-review-mobile.png",
      fullPage: false,
    });
    const source = finalizedSchema.parse(
      JSON.parse(
        a.sql(
          `select snapshot->'diagnostic' from diagnostic_pdf_jobs where id=${quote(a.job)}`,
        ),
      ),
    );
    const correctedValues = {
      ...source.snapshot,
      interpretation: "SYNTHETIC correction for historical-download proof",
    };
    const panelVersion = Number(
      a.sql(
        `select version from diagnostic_panels where id=${quote(source.panel_id)}`,
      ),
    );
    const draft = await a.staff.rpc("save_diagnostic_panel", {
      p_action_id: randomUUID(),
      p_id: source.panel_id,
      p_pet_id: a.pet,
      p_expected_version: panelVersion,
      p_kind: "draft",
      p_values: correctedValues,
    });
    if (draft.error) throw draft.error;
    const correction = await a.staff.rpc("save_diagnostic_panel", {
      p_action_id: randomUUID(),
      p_id: source.panel_id,
      p_pet_id: a.pet,
      p_expected_version: panelVersion + 1,
      p_kind: "finalize",
      p_values: correctedValues,
      p_review_note: "SYNTHETIC corrected diagnostic review",
      p_correction_reason: "SYNTHETIC documentary correction",
    });
    if (correction.error) throw correction.error;
    const historical = await a.staff.rpc("read_diagnostic_pdf_review", {
      p_job: a.job,
      p_pet: a.pet,
    });
    if (historical.error) throw historical.error;
    assert.equal(historical.data.historical, true);
    checks++;
    const currentScope = await a.staff.rpc(
      "read_diagnostic_pdf_release_scope",
      { p_job: a.job, p_pet: a.pet, p_mode: "current" },
    );
    assert.equal(currentScope.error?.code, "PT409");
    scopeChecks++;
    const oldScope = await a.staff.rpc("read_diagnostic_pdf_release_scope", {
      p_job: a.job,
      p_pet: a.pet,
      p_mode: "historical",
    });
    if (oldScope.error) throw oldScope.error;
    assert.equal(oldScope.data.version, 1);
    assert.equal(oldScope.data.mode, "historical");
    assert.equal(oldScope.data.export_available, false);
    scopeChecks += 3;
    assert.throws(() =>
      a.sql(
        `select verify_diagnostic_pdf_release_bytes(${quote(binding)}::jsonb,decode(${quote(Buffer.from(a.bytes).toString("base64"))},'base64'));`,
      ),
    );
    scopeChecks++;

    a.sql(
      `update pets set archived_at=clock_timestamp(),deceased_at=clock_timestamp() where id=${quote(a.pet)};`,
    );
    const retained = await handler(make());
    assert.equal(retained.status, 200);
    assert.deepEqual(
      new Uint8Array(await retained.arrayBuffer()),
      new Uint8Array(a.bytes),
    );
    checks += 2;
    const races = execFileSync(
      "python3",
      [
        "-B",
        "supabase/tests/diagnostic_pdf_download_concurrency.py",
        "--run-synthetic-local",
        "--project-config",
        a.project + "/supabase/config.toml",
        "--job",
        a.job,
        "--actor",
        a.actor,
      ],
      { encoding: "utf8", timeout: 90000 },
    );
    assert.match(races, /observed-lock proof passed: 8 checks/);
    checks += 8;
    writeFileSync(
      "output/renderer-proof/download-runtime-proof.json",
      JSON.stringify(
        {
          checked_at: new Date().toISOString(),
          checks,
          release_scope_checks: scopeChecks,
          genuine_auth: true,
          genuine_private_storage: true,
          http_shared_handler: true,
          native_deno_runtime_claimed: false,
          browser: ["desktop", "mobile"],
          exact_bytes: true,
          sha256: createHash("sha256").update(a.bytes).digest("hex"),
          byte_length: a.bytes.length,
          original_owner_inactive: true,
          audit_outcome: "response_prepared",
          historical_correction_download: true,
          archived_deceased_records_retained: true,
          observed_download_lock_checks: 8,
          page_errors: pageErrors,
          provider_requests: 0,
          hosted_writes: 0,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
  } finally {
    if (browser) await browser.close();
    if (vite && vite.exitCode === null) {
      vite.kill("SIGTERM");
      await new Promise((r) => vite!.once("exit", r));
    }
    await new Promise<void>((resolve) => {
      gateway.close(() => resolve());
      gateway.closeAllConnections();
    });
    a.sql(
      `delete from diagnostic_pdf_staff_disclosure_policy where accepted_by=${quote(a.actor)};`,
    );
  }
  assert.equal(
    a.sql("select count(*) from diagnostic_pdf_staff_disclosure_policy"),
    "0",
  );
  return checks;
}
