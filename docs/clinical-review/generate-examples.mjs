// Run with Node 22.12+: node --experimental-strip-types docs/clinical-review/generate-examples.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { renderRecordRelease } from "../../src/hub/features/record-releases/print.ts";
import { renderVaccineCertificate } from "../../src/hub/features/certificates/print.ts";
import { renderInvoiceDocument } from "../../src/hub/features/billing/invoice-document.ts";
import { chartArtifact } from "../../tests/record-releases/charts-fixture.ts";
import { certificate } from "../../tests/certificates/fixture.ts";
const root = fileURLToPath(new URL("../../", import.meta.url));
const revision = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
const escape = (s) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
// Reuse the exact declarative fixture prefix without importing/executing its test cases.
const testSource = readFileSync(
  new URL("../../tests/billing/invoice-document.test.ts", import.meta.url),
  "utf8",
);
const declaration = testSource.slice(
  testSource.indexOf("const id ="),
  testSource.indexOf("\ntest("),
);
const { sample, practice } = Function(
  `${declaration}\nreturn {sample, practice};`,
)();
const examples = [
  [
    "records-example.html",
    "Selected records and chart history",
    "tests/record-releases/charts-fixture.ts + fixture.ts",
    renderRecordRelease(structuredClone(chartArtifact)),
  ],
  [
    "certificate-example.html",
    "Rabies certificate signature disclosure",
    "tests/certificates/fixture.ts",
    renderVaccineCertificate(structuredClone(certificate), []),
  ],
  [
    "invoice-example.html",
    "Invoice disclosure",
    "tests/billing/invoice-document.test.ts (sample + practice)",
    renderInvoiceDocument(sample, practice),
  ],
];
for (const [name, title, source, html] of examples) {
  const banner = `<aside role="note"><h1>SYNTHETIC REVIEW DRAFT — NOT APPROVED</h1><p>${escape(title)}. No real patient, clinician signature, invoice or authorization. Source: ${escape(source)}. Code revision: ${revision}.</p><p>Fixture values are documentary test inputs, not suggested normal values, treatment or practice defaults. Escaped script-like strings deliberately test display safety. This example is not proof of complete release coverage.</p></aside>`;
  writeFileSync(
    new URL(name, import.meta.url),
    html.replace(/<body[^>]*>/, (match) => match + banner),
  );
}
const frames = examples
  .map(
    ([name, title, , html]) =>
      `<section><h2>${escape(title)}</h2><p>Standalone file: ${escape(name)}</p><iframe title="${escape(title)}" sandbox srcdoc="${escape(html.replace(/<body[^>]*>/, (match) => match + "<h1>SYNTHETIC REVIEW DRAFT — NOT APPROVED</h1>"))}"></iframe></section>`,
  )
  .join("\n");
writeFileSync(
  new URL("review-examples.html", import.meta.url),
  `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Dr. Edler clinical review — draft examples</title><style>:root{--paper:#fff;--ink:#222;--line:#bbb}body{max-width:90rem;margin:2rem auto;padding:0 1rem;background:var(--paper);color:var(--ink);font:18px Georgia,serif;line-height:1.5}iframe{width:100%;height:65rem;border:1px solid var(--line)}section{margin:3rem 0}p{max-width:75ch}@media print{iframe{height:90rem}}</style><h1>Clinical review examples — draft, not approved</h1><p>Prepared for Dr. Susan Edler. All values and signature names below are synthetic fixtures. No approval, clinical normal range, payment, message delivery or external authorization is implied. Code revision: ${revision}.</p><p>Use README.md and forms-and-decisions.md for the editable acceptance register and coverage limits. The standalone examples below embed the current application renderers without external assets or network requests. Release coverage extension remains pending review.</p>${frames}</html>`,
);
console.log(`Generated four draft HTML artifacts from ${revision}`);
