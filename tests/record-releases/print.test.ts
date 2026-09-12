import { test } from "node:test";
import assert from "node:assert/strict";
import { renderRecordRelease } from "../../src/hub/features/record-releases/print.ts";
import { releaseArtifact } from "./fixture.ts";
import { certificate } from "../certificates/fixture.ts";
test("review artifact is deterministic and contains only selected structured fields", () => {
  const artifact = structuredClone(releaseArtifact);
  Object.assign(artifact.preview.snapshot.lab_results[0], {
    notes: "INTERNAL LAB NOTE",
  });
  Object.assign(artifact.preview.snapshot.encounters[0], {
    location: "PRIVATE HOME ENTRY CODE",
  });
  const html = renderRecordRelease(artifact);
  assert.equal(html, renderRecordRelease(structuredClone(artifact)));
  for (const value of [
    "REVIEW DRAFT",
    "Owner reports improvement.",
    "Recorded findings.",
    "Reviewed assessment.",
    "Reviewed plan.",
    "original-report.pdf",
    "application/pdf",
    "LAB-1",
    "a".repeat(64),
  ])
    assert.ok(html.includes(value), value);
  for (const value of [
    "INTERNAL LAB NOTE",
    "PRIVATE HOME ENTRY CODE",
    "PRIVATE-STORAGE-PATH",
    "<script>",
    "<img",
  ])
    assert.ok(!html.includes(value), value);
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("&lt;img"));
  assert.ok(html.includes("does not contain their file bytes"));
});
test("confirmed invalidated copies retain contents with explicit delivery prohibition", () => {
  const artifact = structuredClone(releaseArtifact);
  artifact.confirmed = {
    id: "release",
    created_at: "2026-09-12T20:00:00Z",
    created_by: "staff",
    eligible: false,
    ineligibility_reason: "Source changed",
    events: [
      {
        id: "event",
        release_id: "release",
        kind: "source_changed",
        reason: "<b>Correction</b>",
        created_by: "staff",
        created_at: "2026-09-12T21:00:00Z",
      },
    ],
  };
  const html = renderRecordRelease(artifact);
  assert.ok(html.includes("INVALIDATED RELEASE"));
  assert.ok(html.includes("Not eligible for delivery"));
  assert.ok(html.includes("&lt;b&gt;Correction&lt;/b&gt;"));
  assert.ok(html.includes("Owner reports improvement."));
});
test("explicit certificate selection renders its frozen signed content", () => {
  const artifact = structuredClone(releaseArtifact);
  artifact.preview.snapshot.certificates.push(certificate);
  const html = renderRecordRelease(artifact);
  assert.ok(html.includes("Rabies Vaccination Certificate"));
  assert.ok(html.includes("Frozen manufacturer"));
  assert.ok(html.includes("Electronically signed by Dr Test"));
  assert.equal((html.match(/<html /g) || []).length, 1);
  assert.equal((html.match(/<body>/g) || []).length, 1);
});
test("missing preview hash or empty selection cannot be exported", () => {
  const artifact = structuredClone(releaseArtifact);
  artifact.preview.source_hash = "";
  assert.throws(() => renderRecordRelease(artifact), /review hash/);
  artifact.preview.source_hash = "a".repeat(64);
  artifact.preview.snapshot.encounters = [];
  artifact.preview.snapshot.lab_results = [];
  artifact.preview.snapshot.attachments = [];
  assert.throws(() => renderRecordRelease(artifact), /empty release/);
});

test("incomplete original references and invalid byte sizes fail closed", () => {
  const artifact = structuredClone(releaseArtifact);
  artifact.preview.snapshot.attachments = [];
  assert.throws(() => renderRecordRelease(artifact), /missing its original/);
  const malformed = structuredClone(releaseArtifact);
  malformed.preview.snapshot.attachments[0].file_size = NaN;
  assert.throws(() => renderRecordRelease(malformed), /metadata is invalid/);
});

test("schema-v2 chart export includes full signed addenda and corrected body-map history", async () => {
  const { chartArtifact } = await import("./charts-fixture.ts");
  const html = renderRecordRelease(chartArtifact);
  for (const value of [
    "Signed dental chart",
    "Tooth 101",
    "Manual measurement: 2 mm",
    "Signed qualitative QOL observation",
    "Eating normally",
    "Signed anesthesia record",
    "Documentary event",
    "Recovery notes",
    "Body-map history: Mass A",
    "Original measurement corrected",
    "historical measurement",
    "Species-neutral location schematic",
  ])
    assert.ok(html.includes(value), value);
  assert.equal((html.match(/Complete chart addendum/g) || []).length, 3);
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("<svg"));
  assert.ok(!html.includes("PRIVATE-STORAGE-PATH"));
  const bad = structuredClone(chartArtifact);
  bad.preview.snapshot.lesions![0].observations[0].x = Infinity;
  assert.throws(() => renderRecordRelease(bad), /coordinates/);
});

test("select-all never silently truncates a reviewed source family", async () => {
  const { mergeReleaseSelection } =
    await import("../../src/hub/features/record-releases/selection.ts");
  const existing = Array.from({ length: 100 }, (_, i) => String(i));
  assert.deepEqual(mergeReleaseSelection(existing, ["1"]), existing);
  assert.throws(
    () => mergeReleaseSelection(existing, ["new"]),
    /no selections were changed/,
  );
  assert.equal(existing.length, 100);
});
