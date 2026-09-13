import test from "node:test";
import assert from "node:assert/strict";
import { prescriptionArtifact } from "./prescription-fixture.ts";
import { renderRecordRelease } from "../../supabase/functions/_shared/record-release-renderer.ts";
test("schema8 renders approved prescription evidence alongside vaccination, narrative and original-file provenance", () => {
  const html = renderRecordRelease(prescriptionArtifact());
  for (
    const phrase of [
      "Clinician-reviewed outside prescription history",
      "Clinician-reviewed outside vaccination history",
      "Imported outside history",
      "Partial historical account",
      "Parent source list not supplied",
      "outside units",
      "&lt;script&gt;outside prose&lt;/script&gt;",
      "Source provenance appendix",
      "Optional local catalog match",
      "No dose or refill inferred",
    ]
  ) {
    assert.ok(html.includes(phrase), phrase);
  }
  assert.ok(!html.includes("<script>"));
});
test("schema8 rejects mismatched prescription selection, identity, dates, partial evidence and correction lineage", () => {
  for (
    const mutate of [
      (a: ReturnType<typeof prescriptionArtifact>) => {
        delete a.preview.snapshot.imported_prescriptions;
      },
      (a: ReturnType<typeof prescriptionArtifact>) => {
        a.preview.snapshot.selection!.imported_prescription_ids = [];
      },
      (a: ReturnType<typeof prescriptionArtifact>) => {
        a.preview.snapshot.imported_prescriptions![0].client_id = "wrong";
      },
      (a: ReturnType<typeof prescriptionArtifact>) => {
        a.preview.snapshot.imported_prescriptions![0].context.parent.original
          .id = 999;
      },
      (a: ReturnType<typeof prescriptionArtifact>) => {
        a.preview.snapshot.imported_prescriptions![0].context.reviewed
          .partial_reason = null;
      },
      (a: ReturnType<typeof prescriptionArtifact>) => {
        a.preview.snapshot.imported_prescriptions![0].context.reviewed
          .completeness = "complete";
      },
      (a: ReturnType<typeof prescriptionArtifact>) => {
        a.preview.snapshot.imported_prescriptions![0].context.reviewed
          .prescribed_on = "2026-02-31";
        a.preview.snapshot.imported_prescriptions![0].context.reviewed
          .prescription_date_status = "date";
      },
      (a: ReturnType<typeof prescriptionArtifact>) => {
        a.preview.snapshot.imported_prescriptions![0].items[0].source.original
          .qty = "altered";
      },
      (a: ReturnType<typeof prescriptionArtifact>) => {
        a.preview.snapshot.imported_prescriptions![0].correction_history[0]
          .reason = "changed";
      },
      (a: ReturnType<typeof prescriptionArtifact>) => {
        a.preview.snapshot.imported_prescriptions![0]
          .expected_predecessor_hash = "a".repeat(64);
      },
      (a: ReturnType<typeof prescriptionArtifact>) => {
        a.preview.snapshot.imported_prescriptions![0].context.consult.status =
          "resolved";
      },
    ]
  ) {
    const a = prescriptionArtifact();
    mutate(a);
    assert.throws(
      () => renderRecordRelease(a),
      /Imported prescription provenance/,
    );
  }
});
test("schema8 explicitly renders omitted source observations without inventing clinical interpretation", () => {
  const a = prescriptionArtifact(),
    v = a.preview.snapshot.imported_prescriptions![0];
  const omitted = structuredClone(v.context.items[0]);
  omitted.snapshot_id = "b8000000-0000-4000-8000-000000000001";
  omitted.external_id = "502";
  omitted.original.id = 502;
  omitted.original.instructions = "Omitted <uninterpreted> source instruction";
  v.context.items.push(omitted);
  v.context.omitted_items.push(structuredClone(omitted));
  const html = renderRecordRelease(a);
  assert.ok(
    html.includes("Observed items omitted from clinical interpretation"),
  );
  assert.ok(html.includes("Omitted &lt;uninterpreted&gt; source instruction"));
  v.context.omitted_items = [];
  assert.throws(
    () => renderRecordRelease(a),
    /Imported prescription provenance/,
  );
});

import type { ReleaseBundle } from "../../supabase/functions/_shared/record-release-renderer.ts";
import { sourceOriginalBytes } from "./source-provenance-fixture.ts";
import { buildReleaseEmailPayload } from "../../supabase/functions/_shared/release-email-payload.ts";
import { buildDocumentLinkArtifacts } from "../../supabase/functions/_shared/document-link-artifacts.ts";
test("schema8 both builders retain schema5 original byte checks without inventing text attachments", async () => {
  const a = prescriptionArtifact();
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
    emailHtml.includes("Clinician-reviewed outside prescription history"),
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

import { readFileSync } from "node:fs";
import type { ReleasePreview } from "../../supabase/functions/_shared/record-release-renderer.ts";
test("actual PostgreSQL prescription-only schema8 snapshot renders without fabricated additional selections", () => {
  const preview: ReleasePreview = JSON.parse(readFileSync(new URL("./prescription-database.fixture.json", import.meta.url), "utf8"));
  const html = renderRecordRelease({ preview });
  assert.ok(html.includes("Clinician-reviewed outside prescription history"));
  assert.ok(html.includes("Omitted original evidence"));
  assert.ok(!html.includes("Clinician-reviewed outside vaccination history"));
});
