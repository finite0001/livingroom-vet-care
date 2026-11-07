/** Explicitly invoked synthetic proof for a new immutable dependency candidate.
 * Uses existing project-scoped Vercel authentication only in the trusted parent.
 * Does not update accepted image admission, clinical policy, or historical proof.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { Sandbox } from "@vercel/sandbox";
import { getVercelOidcToken } from "@vercel/oidc";
import { diagnosticRenderInput } from "../../services/diagnostic-renderer/template.ts";
import { renderInSandbox, sha256 } from "../../services/diagnostic-renderer/sandbox.ts";
import { revalidateInSandbox } from "../../services/diagnostic-renderer/revalidate.ts";
import { trustedProvenance } from "../../services/diagnostic-renderer/trusted.ts";
import { longSource } from "../../tests/diagnostics/renderer-fixture.ts";

assert.equal(process.env.LRV_RUN_SYNTHETIC_RUNTIME_PROOF, "true");
const image = process.argv[2], directory = resolve(process.argv[3] ?? "");
assert.match(image ?? "", /^lrv-diagnostic-pdf@sha256:[a-f0-9]{64}$/);
assert.ok(process.argv[3], "Explicit private output directory required");
mkdirSync(directory, { recursive: true, mode: 0o700 });
const project = "prj_Dn1g9AIBEth78S7V3pqhYHueICl7", team = "team_BDI4hvAq1AWGIREoc8sRwNLH";
// Reject an inherited token for another project rather than silently using it.
delete process.env.VERCEL_OIDC_TOKEN;
const token = await getVercelOidcToken({ project, team });
const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
assert.equal(claims.project_id, project); assert.equal(claims.owner_id, team);
process.env.VERCEL_OIDC_TOKEN = token;

const vm = await Sandbox.create({ name: "lrv-pdf-dependency-" + randomUUID(), image,
  resources: { vcpus: 1 }, networkPolicy: "deny-all", ports: [], persistent: false, timeout: 60000, env: {} });
let inventory: Record<string, unknown>;
let admissionOutput = "";
try {
  assert.equal(vm.networkPolicy, "deny-all"); assert.equal(vm.persistent, false);
  assert.equal(vm.currentSnapshotId, undefined); assert.deepEqual(vm.mounts ?? {}, {});
  const session = vm.currentSession();
  const inspected = await session.runCommand({ cmd: "node", args: ["-e", `
    const fs=require('fs'),c=require('crypto'),cp=require('child_process');
    const hash=p=>c.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    const files=['worker.mjs','pdf_admission.py','package.json','package-lock.json'];
    console.log(JSON.stringify({platform:process.platform,arch:process.arch,node:process.version,
      zod:require('/opt/lrv-renderer/node_modules/zod/package.json').version,
      fileSha256:Object.fromEntries(files.map(f=>[f,hash('/opt/lrv-renderer/'+f)])),
      fontSha256:hash('/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf'),
      packages:cp.execFileSync('dpkg-query',['-W','fonts-noto-core','poppler-utils','qpdf','sudo'],{encoding:'utf8'})}));
  `], timeoutMs: 5000 });
  assert.equal(inspected.exitCode, 0); inventory = JSON.parse(await inspected.stdout());
  assert.equal(inventory.platform, "linux"); assert.equal(inventory.arch, "x64"); assert.equal(inventory.zod, "4.6.7");
  assert.equal(inventory.fontSha256, trustedProvenance().font_sha);
  assert.deepEqual(Object.keys(inventory.fileSha256 as Record<string, string>).sort(), ["package-lock.json", "package.json", "pdf_admission.py", "worker.mjs"]);
  for (const [file, actual] of Object.entries(inventory.fileSha256 as Record<string, string>))
    assert.equal(actual, sha256(readFileSync(new URL("../../services/diagnostic-renderer/" + file, import.meta.url))), file);
  const testDirectory = "/home/lrv-render/work/dependency-proof";
  assert.equal((await session.runCommand({ cmd: "mkdir", args: ["-p", testDirectory + "/fixtures"], timeoutMs: 2000 })).exitCode, 0);
  await session.writeFiles([
    { path: testDirectory + "/pdf_admission_test.py", content: readFileSync(new URL("../../tests/diagnostics/pdf_admission_test.py", import.meta.url)), mode: 0o644 },
    { path: testDirectory + "/fixtures/chromium-16-page.pdf", content: readFileSync(new URL("../../tests/diagnostics/fixtures/chromium-16-page.pdf", import.meta.url)), mode: 0o644 },
  ]);
  assert.equal((await session.runCommand({ cmd: "chown", args: ["-R", "12001:12001", testDirectory], timeoutMs: 2000 })).exitCode, 0);
  const tested = await session.runCommand({ cmd: "sudo", args: ["-u", "lrv-render", "--", "/usr/bin/env", "-i", "PATH=/usr/local/bin:/usr/bin:/bin", "HOME=/home/lrv-render", "python3", "-B", testDirectory + "/pdf_admission_test.py"], timeoutMs: 30000 });
  admissionOutput = (await tested.stdout()) + (await tested.stderr());
  assert.equal(tested.exitCode, 0, admissionOutput);
} finally {
  const stopped = await vm.stop(); assert.equal(stopped.snapshot, undefined);
  let final = await Sandbox.get({ name: vm.name, resume: false });
  for (let attempt = 0; final.status !== "stopped" && attempt < 20; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 500)); final = await Sandbox.get({ name: vm.name, resume: false });
  }
  assert.equal(final.status, "stopped"); assert.equal(final.currentSnapshotId, undefined);
}
const input = { ...diagnosticRenderInput(longSource()), job_id: "00000000-0000-0000-0000-000000000001" }; assert.match(input.html, /SYNTHETIC Juniper/);
const rendered = await renderInSandbox(input, image, true);
assert.ok(rendered.receipt.network); assert.equal(rendered.runtime.status, "stopped");
writeFileSync(join(directory, "native-report.pdf"), rendered.bytes, { mode: 0o600 });
const independent = JSON.parse(execFileSync("python3", ["-c", "import sys,json;sys.path.insert(0,'services/diagnostic-renderer');from pdf_admission import validate_file;print(json.dumps(validate_file(sys.argv[1])))", join(directory, "native-report.pdf")], { encoding: "utf8", timeout: 15000 }));
assert.equal(independent.sha256, rendered.receipt.validation.sha256);
const recovered = await revalidateInSandbox(rendered.bytes, input, image);
assert.equal(recovered.sha256, independent.sha256);
// Reuse the original whole-VM descendant/deadline proof against this exact image.
mkdirSync(join(directory, "tmp/renderer-proof"), { recursive: true, mode: 0o700 });
mkdirSync(join(directory, "output/renderer-proof"), { recursive: true, mode: 0o700 });
writeFileSync(join(directory, "tmp/renderer-proof/native-image.json"), JSON.stringify({ image }), { mode: 0o600 });
execFileSync(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL("./native-lifecycle-proof.ts", import.meta.url))],
  { cwd: directory, encoding: "utf8", timeout: 45000 });
const lifecycle = JSON.parse(readFileSync(join(directory, "output/renderer-proof/native-lifecycle-proof.json"), "utf8"));
assert.equal(lifecycle.image, image); assert.equal(lifecycle.status, "stopped"); assert.equal(lifecycle.snapshot_created, false);
writeFileSync(join(directory, "candidate-proof.json"), JSON.stringify({ schemaVersion: 1, image, project, team,
  capturedAt: new Date().toISOString(), inventory: inventory!, admissionCounterexamples: admissionOutput,
  render: { receipt: rendered.receipt, runtime: rendered.runtime }, independent, recovered, lifecycle,
  sourceInputSha256: sha256(JSON.stringify(input)), retainedPostgresUuidPassed: rendered.receipt.job_id === input.job_id, syntheticOnly: true, clinicalWorkerActivated: false,
  acceptanceChanged: false, snapshotsCreated: false }, null, 2) + "\n", { mode: 0o600 });
console.log("Candidate native renderer, malformed-PDF admission and captured-byte recovery passed; all VMs stopped without snapshots.");
