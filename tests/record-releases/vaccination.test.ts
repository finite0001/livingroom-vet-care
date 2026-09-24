import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { vaccinationArtifact } from "./vaccination-fixture.ts";
import { clinicalHistoryArtifact } from "./clinical-history-fixture.ts";
import { sourceProvenanceArtifact } from "./source-provenance-fixture.ts";
import { renderRecordRelease } from "../../supabase/functions/_shared/record-release-renderer.ts";
test("schema7 composes outside vaccination and schema6 narrative/provenance without invented clinical values", () => {
  const a = vaccinationArtifact(), html = renderRecordRelease(a);
  for (
    const phrase of [
      "Imported outside history",
      "Local problem source provenance",
      "Clinician-reviewed outside vaccination history",
      "ambiguous date",
      "uninterpreted",
      "Not recorded",
      "&lt;script&gt;vaccine&lt;/script&gt;",
      "Source provenance appendix",
    ]
  ) assert.ok(html.includes(phrase), phrase);
  assert.ok(!html.includes("<script>"));
  a.preview.snapshot.selection!.imported_vaccination_ids = [];
  a.preview.snapshot.imported_vaccinations = [];
  assert.ok(!renderRecordRelease(a).includes("ambiguous date"));
});
test("schema7 rejects malformed source, selection, date, catalog and revision chains", () => {
  for (
    const mutate of [
      (a: ReturnType<typeof vaccinationArtifact>) => {
        delete a.preview.snapshot.imported_vaccinations;
      },
      (a: ReturnType<typeof vaccinationArtifact>) => {
        a.preview.snapshot.selection!.imported_vaccination_ids = [];
      },
      (a: ReturnType<typeof vaccinationArtifact>) => {
        a.preview.snapshot.imported_vaccinations![0].client_id = "wrong";
      },
      (a: ReturnType<typeof vaccinationArtifact>) => {
        a.preview.snapshot.imported_vaccinations![0].original.consult_id =
          "wrong";
      },
      (a: ReturnType<typeof vaccinationArtifact>) => {
        a.preview.snapshot.imported_vaccinations![0].reviewed.administered_on =
          "2026-02-31";
        a.preview.snapshot.imported_vaccinations![0].reviewed
          .administration_date_status = "date";
      },
      (a: ReturnType<typeof vaccinationArtifact>) => {
        a.preview.snapshot.imported_vaccinations![0].product = {
          id: a.preview.snapshot.imported_vaccinations![0].id,
          version: 1,
          name: "Drug",
          kind: "medication",
        };
      },
      (a: ReturnType<typeof vaccinationArtifact>) => {
        a.preview.snapshot.imported_vaccinations![0].correction_history = [];
      },
      (a: ReturnType<typeof vaccinationArtifact>) => {
        a.preview.snapshot.imported_vaccinations![0].correction_history[0]
          .version_hash = "0".repeat(64);
      },
      (a: ReturnType<typeof vaccinationArtifact>) => {
        a.preview.snapshot.imported_vaccinations![0].correction_history[0]
          .version = 2;
      },
      (a: ReturnType<typeof vaccinationArtifact>) => {
        a.preview.snapshot.imported_vaccinations![0].current
          .consult_head_version++;
      },
    ]
  ) {
    const a = vaccinationArtifact();
    mutate(a);
    assert.throws(
      () => renderRecordRelease(a),
      /Imported vaccination provenance/,
    );
  }
  const a = vaccinationArtifact();
  delete a.preview.snapshot.imported_histories;
  assert.throws(() => renderRecordRelease(a), /Imported history provenance/);
});
test("schema5 and schema6 renderer fingerprints remain stable", () => {
  for (
    const [a, expected] of [[
      sourceProvenanceArtifact(),
      "01155bd6efa7ceb8e4f559d1f4f89a7b621f0020144f12baeeae268981061870",
    ], [
      clinicalHistoryArtifact(),
      "42ba506da7f00dcb5a89742667d41e856a5f0c10320acf363489757c86ba1110",
    ]] as const
  ) {
    assert.equal(
      createHash("sha256").update(renderRecordRelease(a)).digest("hex"),
      expected,
    );
  }
});

import type { ReleaseBundle } from "../../supabase/functions/_shared/record-release-renderer.ts";
import { sourceOriginalBytes } from "./source-provenance-fixture.ts";
import { buildReleaseEmailPayload } from "../../supabase/functions/_shared/release-email-payload.ts";
import { buildDocumentLinkArtifacts } from "../../supabase/functions/_shared/document-link-artifacts.ts";
test("schema7 both builders retain schema5 original byte checks without inventing text attachments", async () => {
  const a = vaccinationArtifact();
  const b: ReleaseBundle = {
    release: {
      ...a.preview,
      id: "b6000000-0000-4000-8000-000000000050",
      pet_id: a.preview.snapshot.patient.id,
      client_id: a.preview.snapshot.recipient.client_id,
      channel: "EMAIL",
      recipient: "owner@example.test",
      selection: {},
      created_by: "b6000000-0000-4000-8000-000000000051",
      created_at: "2026-09-12T12:00:00Z",
    },
    events: [],
    eligible: true,
    ineligibility_reason: null,
  };
  const email = (bytes: Uint8Array) =>
    buildReleaseEmailPayload(
      {
        id: "request",
        release_id: b.release.id,
        actor_id: b.release.created_by,
        recipient: b.release.recipient,
        subject: "Records",
        body: "Selected",
        release_hash: b.release.source_hash,
      },
      b,
      { from: "care@example.test", replyTo: "care@example.test" },
      async () => bytes,
    );
  const link = (bytes: Uint8Array) =>
    buildDocumentLinkArtifacts(
      {
        id: "grant",
        family: "record_release",
        source_id: b.release.id,
        client_id: b.release.client_id,
        actor_id: b.release.created_by,
        recipient: "+13035550123",
        source_hash: b.release.source_hash,
        source_bundle: {
          ...b,
          release: { ...b.release, channel: "SMS", recipient: "+13035550123" },
        },
        created_at: b.release.created_at,
        expires_at: "2026-09-14T00:00:00Z",
        origin: "https://thelivingroom.vet",
        key_version: "test",
        capability_context: "synthetic",
        message_template: "Records",
        state: "preparing",
      },
      { name: "Synthetic", address: "Synthetic", domain: null },
      async () => bytes,
    );
  const altered = sourceOriginalBytes.slice();
  altered[altered.length - 1] ^= 1;
  await assert.rejects(email(altered), /captured source provenance/);
  await assert.rejects(link(altered), /captured source provenance/);
  const emailResult = JSON.parse(
      (await email(sourceOriginalBytes)).payload_text,
    ),
    linkResult = JSON.parse((await link(sourceOriginalBytes)).payload_text);
  const emailHtml = Buffer.from(emailResult.attachments[0].content, "base64")
    .toString();
  assert.ok(
    emailHtml.includes("Clinician-reviewed outside vaccination history"),
  );
  assert.ok(emailHtml.includes("Imported outside history"));
  assert.equal(
    emailResult.attachments.length,
    a.preview.snapshot.attachments.length + 1,
  );
  assert.equal(
    linkResult.artifacts.length,
    a.preview.snapshot.attachments.length + 1,
  );
});

import { mergeReleaseSelection } from "../../src/hub/features/record-releases/selection.ts";
test("vaccination selection preserves an existing choice when the twenty-version bound is exceeded", () => {
  const selected = Array.from({ length: 20 }, (_, n) => String(n));
  assert.throws(
    () => mergeReleaseSelection(selected, ["extra"], 20),
    /exceed 20/,
  );
  assert.equal(selected.length, 20);
  assert.deepEqual(mergeReleaseSelection(selected, ["1"], 20), selected);
});

test("schema7 correction chain binds the selected review to its exact predecessor without releasing its raw record", () => {
  const a = vaccinationArtifact(),
    v = a.preview.snapshot.imported_vaccinations![0];
  const predecessor = structuredClone(v.correction_history[0]);
  v.id = "b7000000-0000-4000-8000-000000000090";
  v.version = 2;
  v.version_hash = "a".repeat(64);
  v.replaces_id = predecessor.id;
  v.expected_predecessor_hash = predecessor.version_hash;
  v.reason = "Explicit reviewed attribution correction";
  v.reviewed.outside_author = "Outside clinician <reviewed>";
  v.correction_history.push({
    id: v.id,
    version: v.version,
    version_hash: v.version_hash,
    replaces_id: v.replaces_id,
    reason: v.reason,
    approved_by: v.approved_by,
    approved_at: v.approved_at,
  });
  a.preview.snapshot.selection!.imported_vaccination_ids = [v.id];
  assert.ok(
    renderRecordRelease(a).includes("Outside clinician &lt;reviewed&gt;"),
  );
  v.expected_predecessor_hash = "f".repeat(64);
  assert.throws(
    () => renderRecordRelease(a),
    /Imported vaccination provenance/,
  );
  v.expected_predecessor_hash = predecessor.version_hash;
  v.correction_history[1].replaces_id = v.id;
  assert.throws(
    () => renderRecordRelease(a),
    /Imported vaccination provenance/,
  );
});
