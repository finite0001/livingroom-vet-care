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
    "https://livingroom-vet-care-1442bptsq-daves-projects-e0da43ba.vercel.app";
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
        localStorage.setItem(
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
    assert.equal(errors, 0);
    checks++;
    mkdirSync("output/renderer-proof", { recursive: true });
    await page.screenshot({
      path: "output/renderer-proof/pdf-review-hosted-mobile.png",
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
