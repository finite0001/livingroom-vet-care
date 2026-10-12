/** Fixed credential-free Linux worker. No caller paths, shell, URLs or print settings. */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { Resolver } from "node:dns/promises";
import { Socket } from "node:net";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { z } from "zod";
const WORK = "/home/lrv-render/work",
  INPUT = "/home/lrv-render/input.json";
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const inputSchema = z
  .object({
    version: z.literal(1),
    job_id: z.string().uuid(),
    source_hash: hash,
    snapshot_hash: hash,
    html_sha256: hash,
    html_bytes: z.number().int().positive().max(524288),
    html: z.string().max(524288),
    expected_texts: z.array(z.string().min(1).max(4000)).min(1).max(500),
  })
  .strict();
const digest = (b) => createHash("sha256").update(b).digest("hex");
const normalize = (s) => s.normalize("NFC").replace(/\s+/gu, " ").trim();
async function tcpDenied(host, port) {
  return await new Promise((resolve) => {
    const s = new Socket();
    let done = false;
    const finish = (denied) => {
      if (!done) {
        done = true;
        s.destroy();
        resolve(denied);
      }
    };
    s.setTimeout(700, () => finish(true));
    s.on("error", () => finish(true));
    s.connect(port, host, () => finish(false));
  });
}
async function proofNetwork() {
  const resolver = new Resolver({ timeout: 700, tries: 1 });
  resolver.setServers(["8.8.8.8"]);
  let dnsDenied = false;
  try {
    await resolver.resolve4("example.com");
  } catch (error) {
    dnsDenied = true;
  }
  const tcp = await tcpDenied("8.8.8.8", 443),
    metadata = await tcpDenied("169.254.169.254", 80);
  assert.ok(dnsDenied && tcp && metadata, "OS network isolation required");
  return { dns_denied: dnsDenied, tcp_denied: tcp, metadata_denied: metadata };
}
let browser = null;
let phase = "isolation";
let sandboxStatus = "";
try {
  assert.equal(process.platform, "linux");
  assert.equal(process.arch, "x64");
  assert.equal(process.getuid(), 12001);
  assert.equal(
    spawnSync("/usr/bin/sudo", ["-n", "true"], {
      stdio: "ignore",
      timeout: 2000,
    }).status,
    1,
    "Renderer user must not gain root privileges",
  );
  const credentialNames = Object.keys(process.env).filter((k) =>
    /TOKEN|SECRET|PASSWORD|API_KEY|SERVICE_ROLE/i.test(k),
  );
  assert.deepEqual(credentialNames, [], "No credentials may enter the VM");
  phase = "input";
  const raw = readFileSync(INPUT);
  assert.ok(raw.length <= 1048576, "Input byte bound");
  const input = inputSchema.parse(JSON.parse(raw.toString("utf8")));
  assert.equal(Buffer.byteLength(input.html), input.html_bytes);
  assert.equal(digest(input.html), input.html_sha256);
  const network = process.argv[2] === "--proof" ? await proofNetwork() : null;
  phase = "browser_launch";
  browser = await chromium.launch({
    headless: true,
    channel: "chromium",
    chromiumSandbox: true,
    timeout: 15000,
  });
  const context = await browser.newContext({
    javaScriptEnabled: false,
    serviceWorkers: "block",
  });
  phase = "browser_sandbox";
  const internalContext = await browser.newContext({
    javaScriptEnabled: true,
    serviceWorkers: "block",
  });
  const internal = await internalContext.newPage();
  await internal.goto("chrome://sandbox", { timeout: 5000 });
  await internal
    .getByText("Seccomp-BPF sandbox", { exact: true })
    .waitFor({ timeout: 5000 });
  const sandbox = await internal.locator("body").innerText();
  sandboxStatus = sandbox;
  assert.match(
    sandbox,
    /Seccomp-BPF sandbox\s+Yes/i,
    "Chromium seccomp sandbox required",
  );
  assert.match(
    sandbox,
    /PID namespaces\s+Yes/i,
    "Chromium PID namespace required",
  );
  await internalContext.close();
  phase = "render";
  let requests = 0;
  await context.route("**/*", async (route) => {
    requests++;
    await route.abort("blockedbyclient");
  });
  const page = await context.newPage();
  await page.setContent(input.html, { waitUntil: "load", timeout: 10000 });
  assert.equal(requests, 0, "Frozen HTML cannot request resources");
  const settings = {
    format: "Letter",
    printBackground: true,
    preferCSSPageSize: false,
    tagged: false,
    outline: false,
    displayHeaderFooter: true,
    margin: { top: "14mm", bottom: "14mm", left: "12mm", right: "12mm" },
    headerTemplate: "<div></div>",
    footerTemplate:
      '<div style="font-size:8px;width:100%;text-align:center">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
  };
  const bytes = await page.pdf(settings);
  assert.ok(
    bytes.length > 15 && bytes.length <= 3145728,
    "PDF capture byte bound",
  );
  writeFileSync(WORK + "/report.pdf", bytes, { mode: 0o600 });
  const browserVersion = browser.version();
  await browser.close();
  browser = null;
  phase = "admission";
  const validation = JSON.parse(
    execFileSync(
      "/usr/bin/python3",
      ["/opt/lrv-renderer/pdf_admission.py", WORK + "/report.pdf"],
      { timeout: 15000, maxBuffer: 16384, stdio: ["ignore", "pipe", "pipe"] },
    ).toString(),
  );
  assert.equal(validation.sha256, digest(bytes));
  assert.equal(validation.byte_length, bytes.length);
  phase = "text_checks";
  execFileSync(
    "/usr/bin/pdftotext",
    ["-layout", WORK + "/report.pdf", WORK + "/report.txt"],
    { timeout: 8000, maxBuffer: 16384, stdio: ["ignore", "pipe", "pipe"] },
  );
  const textBytes = readFileSync(WORK + "/report.txt");
  assert.ok(textBytes.length <= 1048576, "Extracted text bound");
  const text = normalize(textBytes.toString("utf8"));
  for (const expected of input.expected_texts)
    assert.ok(
      text.includes(normalize(expected)),
      "Frozen expected text missing from generated PDF",
    );
  assert.equal(
    digest(readFileSync(WORK + "/report.pdf")),
    validation.sha256,
    "Validation never rewrites captured bytes",
  );
  writeFileSync(
    WORK + "/receipt.json",
    JSON.stringify({
      version: 1,
      job_id: input.job_id,
      source_hash: input.source_hash,
      snapshot_hash: input.snapshot_hash,
      html_sha256: input.html_sha256,
      validation,
      node: process.version,
      chromium: browserVersion,
      browser_sandbox: sandbox,
      uid: process.getuid(),
      credentials_absent: true,
      sudo_denied: true,
      network,
      semantic_text_checks: input.expected_texts.length,
    }),
    { mode: 0o600 },
  );
  console.log("Renderer completed; actual bytes validated.");
} catch (error) {
  if (existsSync(WORK))
    writeFileSync(
      WORK + "/failure.json",
      JSON.stringify({
        code: "render_or_admission_failed",
        phase,
        ...(process.argv[2] === "--proof"
          ? {
              diagnostic: String(error?.message).slice(0, 2000),
              sandbox_status: sandboxStatus.slice(0, 4000),
            }
          : {}),
      }),
      { mode: 0o600 },
    );
  console.error("Renderer failed closed; no ready artifact.");
  if (process.argv[2] === "--proof")
    console.error(
      JSON.stringify({
        phase,
        diagnostic: String(error?.message).slice(0, 2000),
      }),
    );
  process.exitCode = 2;
} finally {
  if (browser) await browser.close();
}
