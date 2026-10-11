/** Local feasibility proof only. No hosted keys, registry, provider calls or public renderer API. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { chromium } from "playwright";
import { z } from "zod";
import { nativeReleaseArtifact } from "../../tests/record-releases/native-prescription-fixture.ts";
import { renderRecordRelease } from "../../supabase/functions/_shared/record-release-renderer.ts";
import { certificate } from "../../tests/certificates/fixture.ts";

const playwrightVersion = createRequire(import.meta.url)(
  "playwright/package.json",
).version;
assert.equal(
  playwrightVersion,
  "1.63.0",
  "Use the reviewed repository lockfile/browser pair",
);
const output = new URL("../../output/pdf/diagnostics-proof/", import.meta.url);
const MAX_HTML = 2 * 1024 * 1024;
const MAX_PDF = 8 * 1024 * 1024;
const DEADLINE_MS = 60_000;
const digest = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const manifestSchema = z
  .object({
    version: z.literal(1),
    job_id: z.string().uuid(),
    source_hash: z.string().regex(/^[a-f0-9]{64}$/),
    html_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    html_bytes: z.number().int().positive().max(MAX_HTML),
    renderer: z.literal("local-playwright-feasibility-v1"),
  })
  .strict();
const artifact = nativeReleaseArtifact(true);
const s = artifact.preview.snapshot;
s.schema_version = 13;
s.native_prescriptions = [];
s.native_dispenses = [];
s.selection!.native_prescription_ids = [];
s.selection!.native_dispense_ids = [];
s.patient.name = "SYNTHETIC Juniper <script>alert(1)</script>";
const encounter = structuredClone(s.encounters[0]);
s.encounters = Array.from({ length: 8 }, (_, i) => ({
  ...structuredClone(encounter),
  id: `synthetic-soap-${i + 1}`,
  subjective:
    `SYNTHETIC SOAP ${i + 1}. ` +
    "Caregiver-provided history retained as documentary text. ".repeat(7),
  objective:
    "SYNTHETIC numeric zero = 0; qualitative finding = not detected; units: µmol/L and °C. " +
    "Recorded observations, not an automatic diagnosis. ".repeat(4),
  assessment:
    "Synthetic clinician-authored assessment; no diagnostic inference by software.",
  plan: "Synthetic documentary plan for PDF layout verification.",
}));
s.anesthesia_records![0].observations = Array.from({ length: 45 }, (_, i) => ({
  at: `2026-09-12T18:${String(i).padStart(2, "0")}:00Z`,
  label: `SYNTHETIC observation ${String(i + 1).padStart(2, "0")}`,
  value: i === 0 ? 0 : 80 + i,
  unit: "bpm",
  notes: "Documentary measurement retained with original unit",
}));
s.certificates.push(structuredClone(certificate));
artifact.package_context = {
  manifest_id: randomUUID(),
  manifest_hash: "c".repeat(64),
  ordinal: 1,
  package_count: 1,
  captured_at: "2026-10-11T15:00:00Z",
  recipient_kind: "client",
  recipient_name: null,
  authorization: null,
};
// The current renderer consumes a reviewed snapshot; this synthetic identity is not a DB release.
const html = renderRecordRelease(artifact);
assert.match(html, /<svg/);
assert.ok(!html.includes("PRIVATE-STORAGE-PATH"));
assert.ok(!html.includes("<script>"));
const manifest = manifestSchema.parse({
  version: 1,
  job_id: randomUUID(),
  source_hash: artifact.preview.source_hash,
  html_sha256: digest(html),
  html_bytes: Buffer.byteLength(html),
  renderer: "local-playwright-feasibility-v1",
});
const verifyInput = (text: string) => {
  assert.equal(Buffer.byteLength(text), manifest.html_bytes);
  assert.equal(digest(text), manifest.html_sha256);
};
verifyInput(html);
assert.throws(() => verifyInput(html + "changed"));
const started = performance.now();
const browser = await chromium.launch({ headless: true });
const timer = setTimeout(() => {
  void browser.close();
}, DEADLINE_MS);
let blockedRequests = 0;
try {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    serviceWorkers: "block",
  });
  await context.route("**/*", async (route) => {
    blockedRequests++;
    await route.abort("blockedbyclient");
  });
  const page = await context.newPage();
  await page.setContent(html, { waitUntil: "load", timeout: 15_000 });
  const attemptsBefore = blockedRequests;
  const settings = {
    preferCSSPageSize: true,
    printBackground: true,
    scale: 1,
    displayHeaderFooter: true,
    headerTemplate:
      '<div style="font-size:8px;width:100%;text-align:center">SYNTHETIC ENGINEERING PROOF - NOT A PATIENT RECORD</div>',
    footerTemplate:
      '<div style="font-size:8px;width:100%;text-align:center">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
  };
  const first = await page.pdf(settings);
  const second = await page.pdf(settings);
  assert.equal(first.subarray(0, 5).toString(), "%PDF-");
  assert.ok(first.length > 100 && first.length <= MAX_PDF);
  assert.ok(second.length <= MAX_PDF);
  assert.equal(
    attemptsBefore,
    0,
    "Trusted renderer HTML must not request external resources",
  );
  // Challenge the application-level guard separately; this does not prove OS/network isolation.
  const challenge = await context.newPage();
  await challenge.setContent(
    '<p id="proof">UNMODIFIED</p><script>document.getElementById("proof").textContent="EXECUTED"</script><img src="https://example.test/proof"><img src="http://169.254.169.254/proof">',
    { waitUntil: "load", timeout: 15_000 },
  );
  assert.equal(await challenge.locator("#proof").textContent(), "UNMODIFIED");
  assert.equal(blockedRequests, 2);
  await mkdir(output, { recursive: true });
  await writeFile(new URL("synthetic-records.pdf", output), first);
  await writeFile(new URL("synthetic-records.html", output), html);
  const evidence = {
    proof: "local-engine-only",
    manifest,
    browser: browser.version(),
    playwright: playwrightVersion,
    node: process.version,
    platform: process.platform,
    settings_sha256: digest(JSON.stringify(settings)),
    html_bytes: manifest.html_bytes,
    pdf_bytes: first.length,
    pdf_sha256: digest(first),
    second_render_sha256: digest(second),
    fresh_renders_identical: digest(first) === digest(second),
    elapsed_ms: Math.round(performance.now() - started),
    node_rss_bytes: process.memoryUsage().rss,
    blocked_requests: blockedRequests,
    javascript_disabled: true,
    service_workers_blocked: true,
    provider_requests: 0,
    fonts: "local system fonts; not pinned",
    os_network_isolation_proven: false,
    hosted_runtime_proven: false,
    private_registration_recovery_proven: false,
  };
  await writeFile(
    new URL("proof.json", output),
    JSON.stringify(evidence, null, 2) + "\n",
  );
  console.log(JSON.stringify(evidence));
} finally {
  clearTimeout(timer);
  await browser.close();
}
