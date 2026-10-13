/** Exact preview and deployed Edge transport; synthetic sessions exist only in memory. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { z } from "zod";
import type { DiagnosticValues } from "../../src/hub/features/diagnostics/model.ts";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
interface Input {
  url: string;
  anon: string;
  session: Session;
  reader: SupabaseClient;
  actor: string;
  owner: string;
  ownerDb: SupabaseClient;
  job: string;
  pet: string;
  panel: string;
  values: DiagnosticValues;
  bytes: Uint8Array;
  sql(s: string): Array<Record<string, unknown>>;
}
export async function proveHostedPdfReview(a: Input) {
  const origin =
    "https://livingroom-vet-care-bh3l920ro-daves-projects-e0da43ba.vercel.app";
  const token = z.string().min(20).parse(process.env.VERCEL_OIDC_TOKEN);
  assert.equal(a.url, "https://kothoqicubowyhwfsrte.supabase.co");
  const q = (s: string) => "'" + s.replaceAll("'", "''") + "'";
  let checks = 0;
  const request = (
    id = randomUUID(),
    pet = a.pet,
    access: string | null = a.session.access_token,
  ) =>
    fetch(a.url + "/functions/v1/download-diagnostic-pdf", {
      method: "POST",
      headers: {
        apikey: a.anon,
        "Content-Type": "application/json",
        ...(access ? { Authorization: "Bearer " + access } : {}),
      },
      body: JSON.stringify({ id, job_id: a.job, pet_id: pet }),
    });
  assert.equal((await request(randomUUID(), a.pet, null)).status, 401);
  checks++;
  assert.equal((await request()).status, 409);
  checks++;
  a.sql(
    `insert into diagnostic_pdf_staff_disclosure_policy(enabled,accepted_by) values(true,${q(a.owner)});update profiles set is_active=false where id=${q(a.owner)};`,
  );
  const stable = randomUUID();
  const first = await request(stable);
  assert.equal(first.status, 200);
  checks++;
  assert.deepEqual(
    new Uint8Array(await first.arrayBuffer()),
    new Uint8Array(a.bytes),
  );
  checks++;
  assert.match(first.headers.get("cache-control")!, /no-store/);
  checks++;
  assert.equal((await request(stable)).status, 200);
  checks++;
  assert.equal(
    a.sql(
      `select count(*)::integer as n from diagnostic_pdf_download_responses where authority_id=${q(stable)};`,
    )[0].n,
    1,
  );
  checks++;
  assert.equal((await request(randomUUID(), randomUUID())).status, 404);
  checks++;
  a.sql(`update profiles set is_active=false where id=${q(a.actor)};`);
  assert.equal((await request(stable)).status, 404);
  checks++;
  a.sql(
    `update profiles set is_active=true where id=${q(a.actor)};update diagnostic_pdf_staff_disclosure_policy set enabled=false where accepted_by=${q(a.owner)};`,
  );
  assert.equal((await request(stable)).status, 409);
  checks++;
  a.sql(
    `update diagnostic_pdf_staff_disclosure_policy set enabled=true,revision=gen_random_uuid() where accepted_by=${q(a.owner)};`,
  );
  assert.equal((await request(stable)).status, 409);
  checks++;
  const expiry = randomUUID();
  const authorized = await a.reader.rpc("authorize_diagnostic_pdf_download", {
    p_id: expiry,
    p_job: a.job,
    p_pet: a.pet,
  });
  if (authorized.error) throw authorized.error;
  const expires = z
    .object({ expires_at: z.string().datetime({ offset: true }) })
    .passthrough()
    .parse(authorized.data).expires_at;
  // Genuine 30-second authority, no expiry edits. Browser work consumes this interval.
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 1000 },
    });
    await context.route(origin + "/**", (route) =>
      route.continue({
        headers: {
          ...route.request().headers(),
          "x-vercel-trusted-oidc-idp-token": token,
        },
      }),
    );
    await context.addInitScript(
      ({ session }) =>
        window.top === window && localStorage.setItem(
          "sb-kothoqicubowyhwfsrte-auth-token",
          JSON.stringify(session),
        ),
      { session: a.session },
    );
    const page = await context.newPage();
    let errors = 0;
    page.on("pageerror", () => errors++);
    const response = await page.goto(
      origin + `/hub/patient/${a.pet}?tab=medical`,
    );
    assert.equal(response?.status(), 200);
    checks++;
    const entry = await page
      .locator('script[src*="/assets/index-"]')
      .getAttribute("src");
    assert.ok(entry);
    const bundle = await context.request.get(origin + entry, {
      headers: { "x-vercel-trusted-oidc-idp-token": token },
    });
    const body = await bundle.text();
    assert.ok(
      body.includes("kothoqicubowyhwfsrte.supabase.co") &&
        !body.includes("mgadheotkdnrsatfivjy.supabase.co"),
    );
    checks++;
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
    checks++;
    assert.equal(await scope.locator("li").count(), 2);
    checks++;
    await scope
      .getByText(
        "Sharing this PDF would also disclose the other listed panels. That additional scope must be reviewed before inclusion in a record package.",
        { exact: true },
      )
      .waitFor();
    checks++;
    const current = await a.reader.rpc("read_diagnostic_pdf_release_scope", {
      p_job: a.job,
      p_pet: a.pet,
      p_mode: "current",
    });
    if (current.error) throw current.error;
    assert.equal(current.data.scope_expansion_required, true);
    assert.equal(current.data.export_available, false);
    assert.equal(current.data.embedded_versions.length, 2);
    checks += 3;
    const rawBinding = a.sql(
      `select diagnostic_pdf_release_binding(${q(a.job)},${q(a.pet)},'current') as binding;`,
    )[0].binding;
    a.sql(
      `select verify_diagnostic_pdf_release_bytes(${q(JSON.stringify(rawBinding))}::jsonb,decode(${q(Buffer.from(a.bytes).toString("base64"))},'base64'));`,
    );
    checks++;
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      const event = page.waitForEvent("download");
      const button = section.getByRole("button", {
        name: "Download verified PDF",
        exact: true,
      });
      await button.click();
      const download = await event;
      assert.equal(await download.failure(), null);
      checks++;
      assert.equal(download.suggestedFilename(), `diagnostic-${a.job}.pdf`);
      checks++;
      const path = await download.path();
      assert.ok(path);
      assert.deepEqual(
        new Uint8Array(readFileSync(path)),
        new Uint8Array(a.bytes),
      );
      checks++;
      const box = await button.boundingBox();
      assert.ok(box && box.height >= 44);
      checks++;
    }
    const packageRequest = String(Object.values(a.sql(
      `select r.id from record_requests r join record_request_manifests m on m.id=r.active_manifest_id where r.pet_id=${q(a.pet)} and r.recipient_kind='client' and r.channel='EMAIL' and exists(select 1 from record_request_packages p where p.manifest_id=m.id and p.selection->'diagnostic_pdf_ids' @> jsonb_build_array(${q(a.job)}::text)) order by r.id limit 1;`,
    )[0])[0]);
    assert.match(packageRequest, /^[a-f0-9-]{36}$/);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(
        origin + `/hub/tools/record-requests/${packageRequest}`,
      );
      await page
        .getByRole("button", { name: "Review package 1", exact: true })
        .click();
      const review = page.getByRole("region", {
        name: "Numbered package review",
        exact: true,
      });
      const frame = review.frameLocator(
        'iframe[title="Medical-record release artifact"]',
      );
      await frame
        .getByText("Current reviewed selection", { exact: false })
        .waitFor();
      await frame
        .getByRole("heading", {
          name: "INVALIDATED RELEASE — HISTORICAL COPY",
          exact: true,
        })
        .waitFor();
      const open = review.getByRole("button", {
        name: "Open original",
        exact: true,
      });
      const downloadEvent = page.waitForEvent("download");
      await open.click();
      const saved = await downloadEvent;
      const path = await saved.path();
      assert.ok(path);
      assert.deepEqual(
        new Uint8Array(readFileSync(path)),
        new Uint8Array(a.bytes),
      );
      const bounds = await open.boundingBox();
      assert.ok(bounds && bounds.height >= 44);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        true,
      );
      checks += 4;
    }

    assert.equal(errors, 0);
    checks++;
    mkdirSync("output/renderer-proof", { recursive: true });
    await page.screenshot({
      path: "output/renderer-proof/pdf-package-hosted-mobile.png",
      fullPage: false,
    });
  } finally {
    await browser.close();
  }
  const delay = Date.parse(expires) - Date.now() + 250;
  if (delay > 0) await new Promise((r) => setTimeout(r, delay));
  assert.equal((await request(expiry)).status, 409);
  checks++;
  a.sql(`update profiles set is_active=true where id=${q(a.owner)};`);
  const version = z
    .object({ version: z.number() })
    .parse(
      a.sql(`select version from diagnostic_panels where id=${q(a.panel)};`)[0],
    ).version;
  const corrected = {
    ...a.values,
    interpretation: "SYNTHETIC hosted historical correction",
  };
  for (const [kind, expected] of [
    ["draft", version],
    ["finalize", version + 1],
  ] as const) {
    const result = await a.ownerDb.rpc("save_diagnostic_panel", {
      p_action_id: randomUUID(),
      p_id: a.panel,
      p_pet_id: a.pet,
      p_expected_version: expected,
      p_kind: kind,
      p_values: corrected,
      ...(kind === "finalize"
        ? {
            p_review_note: "SYNTHETIC historical acceptance",
            p_correction_reason: "SYNTHETIC correction",
          }
        : {}),
    });
    if (result.error) throw result.error;
  }
  a.sql(
    `update profiles set is_active=false where id=${q(a.owner)};update pets set archived_at=clock_timestamp(),deceased_at=clock_timestamp() where id=${q(a.pet)};`,
  );
  const historical = await a.reader.rpc("read_diagnostic_pdf_review", {
    p_job: a.job,
    p_pet: a.pet,
  });
  if (historical.error) throw historical.error;
  assert.equal(historical.data.historical, true);
  checks++;
  const staleScope = await a.reader.rpc("read_diagnostic_pdf_release_scope", {
    p_job: a.job,
    p_pet: a.pet,
    p_mode: "current",
  });
  assert.equal(staleScope.error?.code, "PT409");
  checks++;
  const retainedScope = await a.reader.rpc(
    "read_diagnostic_pdf_release_scope",
    { p_job: a.job, p_pet: a.pet, p_mode: "historical" },
  );
  if (retainedScope.error) throw retainedScope.error;
  assert.equal(retainedScope.data.version, 1);
  assert.equal(retainedScope.data.export_available, false);
  assert.equal(retainedScope.data.embedded_versions.length, 2);
  checks += 3;

  const retained = await request();
  assert.equal(retained.status, 200);
  assert.deepEqual(
    new Uint8Array(await retained.arrayBuffer()),
    new Uint8Array(a.bytes),
  );
  checks += 2;
  return {
    checks,
    native_deployed_edge: true,
    browser: ["desktop", "mobile"],
    byte_equality: true,
    page_errors: 0,
    original_owner_inactive: true,
    historical_retained: true,
    real_expiry_seconds: 30,
    token_in_receipt: false,
    protection_changed: false,
    origin,
  };
}
