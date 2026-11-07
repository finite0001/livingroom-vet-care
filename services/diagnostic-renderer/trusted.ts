import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sha256 } from "./sandbox.ts";
import { provenanceSchema } from "./processing.ts";
/** Accepted dependency refresh: docs/evidence/beta-renderer-uuid-proof-2026-11-06.json.
 * The historical #241 image/proof remains unchanged; runtime admission stays exact. */
export const ACCEPTED_IMAGE =
  "lrv-diagnostic-pdf@sha256:a8ce75e5241a44d1f566eafde611c77414e2f9106e6ee58f3fad34ce319bf22b";
export function trustedProvenance() {
  const files = {
    "template.ts":
      "683ae492a698f06eabcdca24d7023c96c60ae5d8bb311fa9783b41b2a1f9b5d4",
    "pdf_admission.py":
      "ac1f2695539b0fc2d0ab72d423c21091f5c97071693f94738d239846a635bdc2",
    "worker.mjs":
      "0ceed44d2e9941f23e6eeb066fa07531cb52b661d6abab1afd195e39a29186ce",
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
