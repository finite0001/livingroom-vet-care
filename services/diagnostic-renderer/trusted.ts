import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sha256 } from "./sandbox.ts";
import { provenanceSchema } from "./processing.ts";
/** Accepted #241 image; changing executable/template provenance requires a reviewed rollout. */
export const ACCEPTED_IMAGE =
  "lrv-diagnostic-pdf@sha256:e74492886124237c6fdeb1b887709f9dd08778f0713ef7998dee9f1a1d1520c0";
export function trustedProvenance() {
  const files = {
    "template.ts":
      "683ae492a698f06eabcdca24d7023c96c60ae5d8bb311fa9783b41b2a1f9b5d4",
    "pdf_admission.py":
      "ac1f2695539b0fc2d0ab72d423c21091f5c97071693f94738d239846a635bdc2",
    "worker.mjs":
      "9cc103aa331e71e6160ba92b705152d6da514bc95a2a66333b535fbfd3b6fd5f",
  };
  for (const [file, accepted] of Object.entries(files))
    assert.equal(
      sha256(readFileSync(new URL(file, import.meta.url))),
      accepted,
      "Accepted renderer source differs",
    );
  return provenanceSchema.parse({
    template_sha: sha256(
      readFileSync(new URL("./template.ts", import.meta.url)),
    ),
    validator_sha: sha256(
      readFileSync(new URL("./pdf_admission.py", import.meta.url)),
    ),
    worker_sha: sha256(readFileSync(new URL("./worker.mjs", import.meta.url))),
    font_sha:
      "89c3c497f618fdaa0b2d1e98fef93582f28c71debd2c4a8cdf41f190ced2909d",
    settings: {
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
    },
  });
}
export function verifyTrustedProvenance(raw: unknown, image: string) {
  assert.equal(image, ACCEPTED_IMAGE);
  assert.deepEqual(provenanceSchema.parse(raw), trustedProvenance());
}
