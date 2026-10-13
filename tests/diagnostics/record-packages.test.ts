import test from "node:test";
import assert from "node:assert/strict";
import {
  renderRecordRelease,
  type ReleaseSnapshot,
} from "../../supabase/functions/_shared/record-release-renderer.ts";
import { validateDiagnosticPdfPackage } from "../../supabase/functions/_shared/record-release-diagnostics.ts";
import { buildReleaseEmailPayload } from "../../supabase/functions/_shared/release-email-payload.ts";
import {
  buildDocumentLinkArtifacts,
  type DocumentLinkGrant,
} from "../../supabase/functions/_shared/document-link-artifacts.ts";
import { selectionSchema } from "../../src/hub/features/records-requests/model.ts";
import {
  fixtureId as id,
  diagnosticFixtureBytes as bytes,
  diagnosticPackageFixture as fixture,
} from "./record-packages-fixture.ts";

test("schema14 renders exact expanded history, as-of limits and escaped historical labels", async () => {
  const b = await fixture("historical");
  const html = renderRecordRelease({ preview: b.release });
  for (const text of [
    "Explicit historical selection",
    "Version 1",
    "Earlier panel",
    "listed 2",
    "Expanded diagnostic history",
    "&lt;script&gt;",
  ])
    assert.ok(html.includes(text));
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("original.pdf"));
});
const mutations: Array<[string, (s: ReleaseSnapshot) => void]> = [
  ["missing SHA", (s) => delete s.attachments[0].content_sha256],
  ["changed SHA", (s) => (s.attachments[0].content_sha256 = "f".repeat(64))],
  [
    "missing census",
    (s) => (s.diagnostic_pdfs![0].binding.embedded_versions = []),
  ],
  [
    "duplicate census root",
    (s) =>
      (s.diagnostic_pdfs![0].binding.embedded_versions[1].panel_id = id(4)),
  ],
  ["wrong patient", (s) => (s.diagnostic_pdfs![0].binding.pet_id = id(99))],
  [
    "missing main version",
    (s) => (s.diagnostic_pdfs![0].binding.embedded_versions[0].id = id(99)),
  ],
  ["wrong version", (s) => s.attachments[0].version++],
  ["ref removed", (s) => delete s.attachments[0].diagnostic_pdf_ref],
  [
    "ordinary bucket downgrade",
    (s) => (s.attachments[0].bucket = "patient-documents"),
  ],
  ["changed path", (s) => (s.attachments[0].file_path = "different.pdf")],
  [
    "missing review context",
    (s) => (s.diagnostic_pdfs![0].review_context = []),
  ],
  [
    "wrong mode",
    (s) => (s.attachments[0].diagnostic_pdf_ref!.mode = "historical"),
  ],
  ["missing explicit selection", (s) => (s.selection!.diagnostic_pdf_ids = [])],
  ["both modes", (s) => (s.selection!.diagnostic_pdf_historical_ids = [id(3)])],
  ["oversize", (s) => (s.diagnostic_pdfs![0].binding.byte_length = 3145729)],
  ["old schema", (s) => (s.schema_version = 13)],
];
for (const [name, mutate] of mutations)
  test(`diagnostic package rejects ${name}`, async () => {
    const s = (await fixture()).release.snapshot;
    mutate(s);
    assert.throws(() => validateDiagnosticPdfPackage(s));
  });
test("records request selection rejects a PDF selected in both modes", () =>
  assert.equal(
    selectionSchema.safeParse({
      diagnostic_pdf_ids: [id(3)],
      diagnostic_pdf_historical_ids: [id(3)],
    }).success,
    false,
  ));
test("email and client protected-link builders preserve exact selected PDF bytes", async () => {
  const b = await fixture();
  const email = await buildReleaseEmailPayload(
    {
      id: id(10),
      release_id: b.release.id,
      actor_id: id(9),
      recipient: b.release.recipient,
      subject: "Synthetic",
      body: "Synthetic",
      release_hash: b.release.source_hash,
    },
    b,
    { from: "Synthetic <sender@example.test>", replyTo: "sender@example.test" },
    async () => bytes,
  );
  assert.deepEqual(
    Buffer.from(
      JSON.parse(email.payload_text).attachments[1].content,
      "base64",
    ),
    Buffer.from(bytes),
  );
  b.release.channel = "SMS";
  b.release.recipient = "+13035550188";
  b.release.snapshot.recipient.channel = "SMS";
  b.release.snapshot.recipient.address = b.release.recipient;
  const grant = {
    id: id(10),
    family: "record_release",
    source_id: b.release.id,
    client_id: b.release.client_id,
    actor_id: id(9),
    recipient: b.release.recipient,
    source_hash: b.release.source_hash,
    source_bundle: b,
  } as DocumentLinkGrant;
  const link = await buildDocumentLinkArtifacts(
    grant,
    { name: "Synthetic", address: "Synthetic", domain: null },
    async () => bytes,
  );
  assert.deepEqual(
    Buffer.from(JSON.parse(link.payload_text).artifacts[1].content, "base64"),
    Buffer.from(bytes),
  );
  const changed = bytes.slice();
  changed[changed.length - 1] ^= 1;
  await assert.rejects(
    buildDocumentLinkArtifacts(
      grant,
      { name: "Synthetic", address: "Synthetic", domain: null },
      async () => changed,
    ),
  );
});
