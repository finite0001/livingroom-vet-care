/** Synthetic review copy; no database or provider access. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { renderRecordRelease } from "../../supabase/functions/_shared/record-release-renderer.ts";
import { nativeReleaseArtifact } from "../../tests/record-releases/native-prescription-fixture.ts";
const sources = ["supabase/functions/_shared/record-release-renderer.ts", "supabase/functions/_shared/record-release-native-prescriptions.ts", "supabase/functions/_shared/native-prescription-renderer.ts", "tests/record-releases/native-prescription-fixture.ts", "tests/prescriptions/renderer-fixture.ts"];
const fingerprints = sources.map(path => `${path}: ${createHash("sha256").update(readFileSync(new URL(`../../${path}`, import.meta.url))).digest("hex")}`).join("<br>");
const artifact = nativeReleaseArtifact();
const order = artifact.preview.snapshot.native_prescriptions![0];
order.status = { state: "cancelled", head_id: "00000000-0000-4000-8000-000000000040", head_version: 1, event_at: "2026-09-16T11:00:00Z", reason: "Synthetic cancellation after dispensing; original fill remains in the record.", replacement_id: null };
artifact.preview.snapshot.native_dispenses![0].prescription = structuredClone(order);
const html = renderRecordRelease(artifact).replace("<body>", `<body><aside><strong>SYNTHETIC REVIEW EXAMPLE — NOT A CLINICAL RECORD</strong><p>No patient, prescribing, dispensing or delivery action occurred. All clinical values are fictional.</p><p>${fingerprints}</p></aside>`);
writeFileSync(new URL("native-prescription-release-example.html", import.meta.url), html);
console.log("Generated synthetic native record-release review example.");
