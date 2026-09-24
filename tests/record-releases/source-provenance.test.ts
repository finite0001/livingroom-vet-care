import test from "node:test";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import {
  sourceOriginalBytes,
  sourceProvenanceArtifact,
} from "./source-provenance-fixture.ts";
import {
  type ReleaseBundle,
  renderRecordRelease,
} from "../../supabase/functions/_shared/record-release-renderer.ts";
import { buildReleaseEmailPayload } from "../../supabase/functions/_shared/release-email-payload.ts";
import { buildDocumentLinkArtifacts } from "../../supabase/functions/_shared/document-link-artifacts.ts";
const releaseId = "b5000000-0000-4000-8000-000000009000";
function bundle(channel: "EMAIL" | "SMS" = "EMAIL"): ReleaseBundle {
  const artifact = sourceProvenanceArtifact();
  return {
    release: {
      ...artifact.preview,
      id: releaseId,
      pet_id: artifact.preview.snapshot.patient.id,
      client_id: artifact.preview.snapshot.recipient.client_id,
      channel,
      recipient: channel === "EMAIL" ? "owner@example.test" : "+13035550123",
      selection: {},
      created_by: "b5000000-0000-4000-8000-000000009001",
      created_at: "2026-09-12T12:00:00Z",
    },
    events: [],
    eligible: true,
    ineligibility_reason: null,
  };
}
function email(b: ReleaseBundle, bytes = sourceOriginalBytes) {
  return buildReleaseEmailPayload(
    {
      id: "request",
      release_id: releaseId,
      actor_id: b.release.created_by,
      recipient: b.release.recipient,
      subject: "Records",
      body: "Selected originals",
      release_hash: b.release.source_hash,
    },
    b,
    { from: "care@example.test", replyTo: "care@example.test" },
    async () => bytes,
  );
}
function link(b: ReleaseBundle, bytes = sourceOriginalBytes) {
  return buildDocumentLinkArtifacts(
    {
      id: "grant",
      family: "record_release",
      source_id: releaseId,
      client_id: b.release.client_id,
      actor_id: b.release.created_by,
      recipient: b.release.recipient,
      source_hash: b.release.source_hash,
      source_bundle: b,
      created_at: b.release.created_at,
      expires_at: "2026-09-13T00:00:00Z",
      origin: "https://example.test",
      key_version: "test",
      capability_context: "synthetic",
      message_template: "Review records",
      state: "preparing",
    },
    { name: "Synthetic", address: "Synthetic", domain: null },
    async () => bytes,
  );
}
test("v5 selected source sections describe lineage, acknowledgments and local attribution, escaping source text", () => {
  const a = sourceProvenanceArtifact();
  a.preview.snapshot.lab_reports![0].source.source_report_reference =
    "<script>altered</script>";
  a.preview.snapshot.attachments[0].file_name = "Report <original>.pdf";
  a.preview.snapshot.attachments[1].file_name = "Report <original>.pdf";
  const html = renderRecordRelease(a);
  for (
    const text of [
      "Original attachment 1: Report &lt;original&gt;.pdf",
      "Original attachment 2: Report &lt;original&gt;.pdf",
      "Selected laboratory report provenance",
      "Selected external medical originals",
      "Historical version",
      "corrected",
      "replacement",
      "Exact-version acknowledgment",
      "No exact-version acknowledgment",
      "outside author",
      "&lt;script&gt;altered",
      "Staff-entered laboratory source",
      "Staff-reviewed manual export",
    ]
  ) assert.ok(html.includes(text), text);
  for (
    const text of [
      "<script>",
      "staff_entered_v1",
      "staff_reviewed_manual_export_v1",
      "Capture fingerprint",
      "private/synthetic",
    ]
  ) assert.ok(!html.includes(text), text);
});
test("v5 requires reciprocal exact selected source and original proofs", () => {
  for (
    const change of [
      (b: ReleaseBundle) => {
        delete b.release.snapshot.lab_reports;
      },
      (b: ReleaseBundle) => {
        delete b.release.snapshot.attachments[0].content_sha256;
      },
      (b: ReleaseBundle) => {
        delete b.release.snapshot.attachments[0].provenance_captures;
      },
      (b: ReleaseBundle) => {
        b.release.snapshot.attachments[0].provenance_captures![0].capture_hash =
          "f".repeat(64);
      },
      (b: ReleaseBundle) => {
        b.release.snapshot.lab_reports![0].document_version++;
      },
      (b: ReleaseBundle) => {
        b.release.snapshot.lab_reports![0].acknowledgments[0].capture_hash = "f"
          .repeat(64);
      },
      (b: ReleaseBundle) => {
        b.release.snapshot.lab_reports = [];
      },
      (b: ReleaseBundle) => {
        b.release.snapshot.attachments.push(b.release.snapshot.attachments[0]);
      },
    ]
  ) {
    const b = bundle();
    change(b);
    assert.throws(
      () => renderRecordRelease({ preview: b.release }),
      /version 5/,
    );
  }
});
test("both builders reject same-length altered PDF against frozen source digest and accept exact bytes", async () => {
  const altered = sourceOriginalBytes.slice();
  altered[altered.length - 1] ^= 1;
  assert.equal(altered.length, sourceOriginalBytes.length);
  assert.equal(new TextDecoder().decode(altered.slice(0, 5)), "%PDF-");
  await assert.rejects(email(bundle(), altered), /captured source provenance/);
  await assert.rejects(
    link(bundle("SMS"), altered),
    /captured source provenance/,
  );
  const e = JSON.parse((await email(bundle())).payload_text),
    l = JSON.parse((await link(bundle("SMS"))).payload_text);
  assert.equal(e.attachments.length, 5);
  assert.equal(l.artifacts.length, 5);
  assert.deepEqual(
    Buffer.from(e.attachments[1].content, "base64"),
    Buffer.from(sourceOriginalBytes),
  );
  assert.deepEqual(
    Buffer.from(l.artifacts[1].content, "base64"),
    Buffer.from(sourceOriginalBytes),
  );
});
test("matching selected sources may share one original; conflicting source digests cannot", async () => {
  const b = bundle(),
    s = b.release.snapshot,
    l = s.lab_reports![0],
    e = s.external_records![0],
    old = s.attachments.find((d) => d.id === e.document_id)!;
  e.document_id = l.document_id;
  e.document_version = l.document_version;
  e.content_sha256 = l.content_sha256;
  s.attachments[0].provenance_captures!.push(old.provenance_captures![0]);
  s.attachments = s.attachments.filter((d) => d !== old);
  assert.equal(JSON.parse((await email(b)).payload_text).attachments.length, 4);
  e.content_sha256 = "f".repeat(64);
  await assert.rejects(email(b), /version 5/);
});
test("ordinary-only schema5 retains metadata contract without invented captured proof", async () => {
  const b = bundle();
  b.release.snapshot.lab_reports = [];
  b.release.snapshot.external_records = [];
  for (const d of b.release.snapshot.attachments) {
    delete d.content_sha256;
    delete d.provenance_captures;
  }
  assert.equal(JSON.parse((await email(b)).payload_text).attachments.length, 5);
});

// Frozen before adding schema6 imported history. Legacy documents must not change.
test("schema5 source provenance golden remains unchanged", () => {
  assert.equal(
    createHash("sha256").update(renderRecordRelease(sourceProvenanceArtifact()))
      .digest("hex"),
    "01155bd6efa7ceb8e4f559d1f4f89a7b621f0020144f12baeeae268981061870",
  );
});
