/** Single bounded synthetic native proof; no real chart, Supabase credential or worker activation. */
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import {
  renderInSandbox,
  renderInputSchema,
} from "../../services/diagnostic-renderer/sandbox.ts";
assert.equal(process.env.LRV_RUN_SYNTHETIC_RUNTIME_PROOF, "true");
const input = renderInputSchema.parse(
  JSON.parse(readFileSync("tmp/renderer-proof/input/input.json", "utf8")),
);
assert.match(input.html, /SYNTHETIC Juniper/);
const image = JSON.parse(
  readFileSync("tmp/renderer-proof/native-image.json", "utf8"),
).image;
const started = performance.now();
try {
  const result = await renderInSandbox(input, image, true);
  assert.ok(result.receipt.network);
  mkdirSync("output/renderer-proof", { recursive: true });
  writeFileSync("output/renderer-proof/native-report.pdf", result.bytes);
  const independent = JSON.parse(
    execFileSync(
      "python3",
      [
        "-c",
        "import sys,json;sys.path.insert(0,'services/diagnostic-renderer');from pdf_admission import validate_file;print(json.dumps(validate_file('output/renderer-proof/native-report.pdf')))",
      ],
      { encoding: "utf8", timeout: 15000, stdio: ["ignore", "pipe", "pipe"] },
    ),
  );
  assert.equal(independent.sha256, result.receipt.validation.sha256);
  writeFileSync(
    "output/renderer-proof/native-proof.json",
    JSON.stringify(
      {
        receipt: result.receipt,
        runtime: result.runtime,
        independent_validation: independent,
        elapsed_ms: Math.round(performance.now() - started),
        clinical_worker_activated: false,
      },
      null,
      2,
    ),
  );
  console.log(
    "Native isolated renderer proof passed;actual bytes independently checked;VM stopped without snapshot.",
  );
} catch (error) {
  let detail = String(
    error instanceof Error ? error.message : "unknown failure",
  );
  for (const [key, value] of Object.entries(process.env))
    if (
      /TOKEN|SECRET|PASSWORD|KEY|SERVICE_ROLE/i.test(key) &&
      value &&
      value.length > 8
    )
      detail = detail.split(value).join("[redacted]");
  writeFileSync(
    "output/renderer-proof/native-failure.json",
    JSON.stringify({ message: detail.slice(0, 6000) }),
    { mode: 0o600 },
  );
  console.error(
    "Native proof failed;no ready artifact or clinical activation.",
  );
  process.exitCode = 1;
}
