// Run with Node 22.12+: node --experimental-strip-types docs/clinical-review/generate-examples.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { renderRecordRelease } from "../../src/hub/features/record-releases/print.ts";
import { renderVaccineCertificate } from "../../src/hub/features/certificates/print.ts";
import { renderInvoiceDocument } from "../../src/hub/features/billing/invoice-document.ts";
import { provenanceArtifact } from "../../tests/record-releases/provenance-fixture.ts";
import { sourceProvenanceArtifact } from "../../tests/record-releases/source-provenance-fixture.ts";
import { clinicalHistoryArtifact } from "../../tests/record-releases/clinical-history-fixture.ts";
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
const historyWithoutNarrative = clinicalHistoryArtifact();
historyWithoutNarrative.preview.snapshot.imported_histories = [];
for (const extraction of historyWithoutNarrative.preview.snapshot.problem_source_extractions) {
  for (const source of extraction.sources) source.narrative_included = false;
  for (const review of extraction.discrepancy.review_history) {
    for (const source of review.sources) source.narrative_included = false;
  }
}
const examples = [
  [
    "records-example.html",
    "Selected records and chart history",
    "tests/record-releases/provenance-fixture.ts + history-fixture.ts + charts-fixture.ts + fixture.ts",
    renderRecordRelease(provenanceArtifact()),
  ],
  [
    "sources-example.html",
    "Selected lab and external-original provenance",
    "tests/record-releases/source-provenance-fixture.ts",
    renderRecordRelease(sourceProvenanceArtifact()),
  ],
  [
    "imported-history-example.html",
    "Imported history and locally reviewed problems",
    "tests/record-releases/clinical-history-fixture.ts",
    renderRecordRelease(clinicalHistoryArtifact()),
  ],
  [
    "imported-history-references-example.html",
    "Selected problem with source references and no full imported narrative",
    "tests/record-releases/clinical-history-fixture.ts (full narratives explicitly omitted)",
    renderRecordRelease(historyWithoutNarrative),
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
  const description = {
    "imported-history-example.html": "This schema-6 example separates outside narrative and raw references, administrator source approval, local clinical extraction, later local edits and source discrepancies. It does not establish an outside signature, clinical agreement or complete patient migration.",
    "imported-history-references-example.html": "This schema-6 partial-release example retains the selected problem's source references and clinical decisions while explicitly omitting the full imported narratives. Source-reference disclosure does not mean the original narrative was included or the patient migration is complete.",
    "sources-example.html": "This schema-5 example distinguishes verified original bytes, staff-reviewed source identity, historical replacements and exact-version DVM acknowledgments. It does not establish provider authenticity, clinical agreement or complete patient migration.",
    "records-example.html": "This schema-4 example adds reviewed imported-weight provenance to selected diagnosis, allergy and treatment histories; selection coverage still requires clinician review.",
    "certificate-example.html": "This certificate example requires separate review of vaccine metadata, issuer authority and signature disclosure; it does not establish a valid issued certificate.",
    "invoice-example.html": "This invoice example requires separate review of charges, credits and payment-status disclosure; it does not create an invoice or payment.",
  }[name];
  const banner = `<aside role="note"><h1>SYNTHETIC REVIEW DRAFT — NOT APPROVED</h1><p>${escape(title)}. No real patient, clinician signature, invoice or authorization. Source: ${escape(source)}. Code revision: ${revision}.</p><p>Fixture values are documentary test inputs, not suggested normal values, treatment or practice defaults. Escaped script-like strings deliberately test display safety. ${escape(description)}</p></aside>`;
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
  `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Dr. Edler clinical review — draft examples</title><style>:root{--paper:#fff;--ink:#222;--line:#bbb}body{max-width:90rem;margin:2rem auto;padding:0 1rem;background:var(--paper);color:var(--ink);font:18px Georgia,serif;line-height:1.5}iframe{width:100%;height:65rem;border:1px solid var(--line)}section{margin:3rem 0}p{max-width:75ch}@media print{iframe{height:90rem}}</style><h1>Clinical review examples — draft, not approved</h1><p>Prepared for Dr. Susan Edler. All values and signature names below are synthetic fixtures. No approval, clinical normal range, payment, message delivery or external authorization is implied. Code revision: ${revision}.</p><p>Use README.md and forms-and-decisions.md for the editable acceptance register and coverage limits. The standalone examples below embed the current application renderers without external assets or network requests. Schema-4 imported-weight, schema-5 selected lab/external-original provenance and schema-6 imported-history/local-problem examples are included; clinical acceptance remains pending.</p>${frames}</html>`,
);
console.log(
  `Generated ${examples.length + 1} draft HTML artifacts from ${revision}`,
);
