/** Synthetic review copy; no database, real patient or provider access. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { renderNativePrescriptionV2 } from "../../supabase/functions/_shared/native-dispense-corrections.ts";
import { correctionFixture } from "../../tests/prescriptions/correction-fixture.ts";
const sources = ["supabase/functions/_shared/native-dispense-corrections.ts", "supabase/functions/_shared/native-prescription-renderer.ts", "tests/prescriptions/correction-fixture.ts", "tests/prescriptions/renderer-fixture.ts"];
const fingerprints = sources.map(path => `${path}: ${createHash("sha256").update(readFileSync(new URL(`../../${path}`, import.meta.url))).digest("hex")}`).join("<br>");
const html = renderNativePrescriptionV2(correctionFixture()).replace("<body>", `<body><aside><strong>SYNTHETIC REVIEW EXAMPLE — NOT A CLINICAL RECORD</strong><p>For Dr. Susan Edler: review distinction between clinical annotation and a new prescription, preservation of original pickup, and the disputed/corrected handoff wording. All medication values and recipients are fictional. No prescribing, dispensing or delivery occurred.</p><p>${fingerprints}</p></aside>`);
writeFileSync(new URL("native-dispense-corrections-example.html", import.meta.url), html);
console.log("Generated synthetic native correction review example.");
