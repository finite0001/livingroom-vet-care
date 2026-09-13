import test from "node:test";
import assert from "node:assert/strict";
import { clinicalHistoryArtifact } from "./clinical-history-fixture.ts";
import {
  type ReleaseBundle,
  renderRecordRelease,
} from "../../supabase/functions/_shared/record-release-renderer.ts";
import { sourceOriginalBytes } from "./source-provenance-fixture.ts";
import { buildReleaseEmailPayload } from "../../supabase/functions/_shared/release-email-payload.ts";
import { buildDocumentLinkArtifacts } from "../../supabase/functions/_shared/document-link-artifacts.ts";
test("schema6 separates outside history, administrator review and local DVM decisions", () => {
  const a = clinicalHistoryArtifact(), html = renderRecordRelease(a);
  for (
    const phrase of [
      "Outside clinician &lt;reference&gt;",
      "unknown-source-date",
      "Source imported and reviewed by administrator",
      "Local DVM decision",
      "subsequently edited",
      "Local review is still required",
      "original narrative is included",
      "&lt;script&gt;unsafe()&lt;/script&gt;",
    ]
  ) assert.ok(html.includes(phrase), phrase);
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("Source signed"));
  a.preview.snapshot.imported_histories = [];
  a.preview.snapshot.problem_source_extractions![0].sources[0]
    .narrative_included = false;
  const partial = renderRecordRelease(a);
  assert.ok(partial.includes("original narrative was not selected"));
  assert.ok(!partial.includes("unsafe()"));
  assert.ok(partial.includes("Local DVM decision"));
});
test("schema6 validates source/extraction identity, exact selection flags and local edit history", () => {
  for (
    const change of [
      (
        s: ReturnType<typeof clinicalHistoryArtifact>["preview"]["snapshot"],
      ) => {
        delete s.imported_histories;
      },
      (
        s: ReturnType<typeof clinicalHistoryArtifact>["preview"]["snapshot"],
      ) => {
        s.imported_histories![0].pet_id = "wrong";
      },
      (
        s: ReturnType<typeof clinicalHistoryArtifact>["preview"]["snapshot"],
      ) => {
        s.problem_source_extractions![0].sources[0].version_hash = "f".repeat(
          64,
        );
      },
      (
        s: ReturnType<typeof clinicalHistoryArtifact>["preview"]["snapshot"],
      ) => {
        s.problem_source_extractions![0].sources[0].narrative_included = false;
      },
      (
        s: ReturnType<typeof clinicalHistoryArtifact>["preview"]["snapshot"],
      ) => {
        s.problem_source_extractions![0].locally_edited = false;
      },
      (
        s: ReturnType<typeof clinicalHistoryArtifact>["preview"]["snapshot"],
      ) => {
        s.imported_histories![0].current.is_current = true;
      },
      (
        s: ReturnType<typeof clinicalHistoryArtifact>["preview"]["snapshot"],
      ) => {
        delete s.imported_histories![0].consult.snapshot_id;
      },
    ]
  ) {
    const a = clinicalHistoryArtifact();
    change(a.preview.snapshot);
    assert.throws(() => renderRecordRelease(a), /Imported history provenance/);
  }
});
test("schema6 both builders retain schema5 original byte checks without inventing text attachments", async () => {
  const a = clinicalHistoryArtifact();
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
  assert.equal(
    emailResult.attachments.length,
    a.preview.snapshot.attachments.length + 1,
  );
  assert.equal(
    linkResult.artifacts.length,
    a.preview.snapshot.attachments.length + 1,
  );
});

test("schema6 history-only release has no fabricated attachment or signature", () => {
  const a = clinicalHistoryArtifact(), s = a.preview.snapshot;
  for (const key of Object.keys(s)) {
    if (
      key !== "imported_histories" && Array.isArray(s[key as keyof typeof s])
    ) {
      (s as unknown as Record<string, unknown>)[key] = [];
    }
  }
  s.imported_histories![0].original.timestamp = null;
  s.imported_histories![0].original.vet_id = { outside: "<unresolved>" };
  const html = renderRecordRelease(a);
  assert.ok(html.includes("Imported outside history"));
  assert.ok(html.includes("&lt;unresolved&gt;"));
  assert.ok(!html.includes("Original attachment manifest"));
  assert.ok(!html.includes("Signed clinical encounter"));
  assert.ok(!html.includes("Local DVM decision"));
});

test("schema6 accepts authoritative consult or mapping discrepancy even when the history head itself matches", () => {
  const a = clinicalHistoryArtifact(),
    h = a.preview.snapshot.imported_histories![0];
  h.current.snapshot_id = h.snapshot_id;
  h.current.head_version = h.observed_head_version;
  assert.doesNotThrow(() => renderRecordRelease(a));
});
