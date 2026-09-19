/** Synthetic review copy; no database, real patient or provider access. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { renderNativePrescriptionV3 } from "../../supabase/functions/_shared/native-dispense-returns.ts";
import { returnFixture } from "../../tests/prescriptions/return-fixture.ts";
const sources = ["supabase/functions/_shared/native-dispense-returns.ts", "supabase/functions/_shared/native-prescription-renderer.ts", "tests/prescriptions/return-fixture.ts", "tests/prescriptions/renderer-fixture.ts"];
const fingerprints = sources.map(path => `${path}: ${createHash("sha256").update(readFileSync(new URL(`../../${path}`, import.meta.url))).digest("hex")}`).join("<br>");
const html = renderNativePrescriptionV3(returnFixture()).replace("<body>", `<body><aside><strong>SYNTHETIC REVIEW EXAMPLE — NOT A CLINICAL RECORD</strong><p>For Dr. Susan Edler: review held custody, partial disposal, and the explicit criteria and authority required before returning medication to available stock. The example does not authorize restocking in practice. All medication values and recipients are fictional. No prescribing, dispensing or delivery occurred.</p><p>${fingerprints}</p></aside>`);
writeFileSync(new URL("native-dispense-returns-example.html", import.meta.url), html);
console.log("Generated synthetic native physical return review example.");
