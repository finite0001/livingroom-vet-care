import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { prescriptionArtifact } from "./prescription-fixture.ts";
import { vaccinationArtifact } from "./vaccination-fixture.ts";
import { renderRecordRelease } from "../../supabase/functions/_shared/record-release-renderer.ts";
import type { ReleaseImportedPrescription } from "../../supabase/functions/_shared/record-release-renderer.ts";
import { reconcilePrescriptionItems } from "../../supabase/functions/ezyvet-import/prescription-reconciliation.ts";
test("schema8 composes outside prescription history with literal source text, partial disclosure and earlier histories", () => {
  const a = prescriptionArtifact(),
    html = renderRecordRelease(a);
  for (const phrase of [
    "Clinician-reviewed outside prescription history",
    "Clinician-reviewed outside vaccination history",
    "Imported outside history",
    "outside units",
    "&lt;script&gt;outside prose&lt;/script&gt;",
    "Parent source list not supplied",
    "uninterpreted",
    "catalog match does not establish the historical quantity unit",
    "unreviewed context",
  ])
    assert.ok(html.includes(phrase), phrase);
  assert.ok(!html.includes("<script>"));
  a.preview.snapshot.imported_prescriptions = [];
  a.preview.snapshot.selection!.imported_prescription_ids = [];
  assert.ok(!renderRecordRelease(a).includes("outside units"));
});
test("schema8 rejects malformed identity, observations, interpretation, reconciliation and corrections", () => {
  const mutations: Array<(p: ReleaseImportedPrescription) => void> = [
    (p) => {
      p.client_id = "other";
    },
    (p) => {
      p.context.source.animal_id = "other";
    },
    (p) => {
      p.context.parent.original.id = "other";
    },
    (p) => {
      p.items[0].source.original.qty = "edited";
    },
    (p) => {
      p.context.reviewed.prescribed_on = "2026-02-31";
      p.context.reviewed.prescription_date_status = "date";
    },
    (p) => {
      p.context.reviewed.prescription_date_status = "date";
    },
    (p) => {
      p.context.reviewed.completeness = "complete";
      p.context.reviewed.partial_reason = null;
    },
    (p) => {
      p.context.reviewed.partial_reason = null;
    },
    (p) => {
      p.context.reconciliation.observedIds = [];
    },
    (p) => {
      p.context.omitted_items = [p.context.items[0]];
    },
    (p) => {
      p.context.items = [];
    },
    (p) => {
      p.context.consult = { status: "resolved" };
    },
    (p) => {
      p.context.parent.original.consult_id = "999";
    },
    (p) => {
      p.correction_history = [];
    },
    (p) => {
      p.correction_history[0].reason = "Changed";
    },
    (p) => {
      p.correction_history[0].version = 2;
    },
    (p) => {
      p.current.is_latest = false;
    },
    (p) => {
      p.current.identity_valid = false;
    },
    (p) => {
      p.items[0].product!.kind = "vaccine";
      p.context.selected_items = structuredClone(p.items);
    },
  ];
  for (const mutate of mutations) {
    const a = prescriptionArtifact();
    mutate(a.preview.snapshot.imported_prescriptions![0]);
    assert.throws(
      () => renderRecordRelease(a),
      /Imported prescription provenance/,
    );
  }
  const a = prescriptionArtifact();
  a.preview.snapshot.selection!.imported_prescription_ids = [];
  assert.throws(
    () => renderRecordRelease(a),
    /Imported prescription provenance/,
  );
});
test("schema8 displays omitted original evidence as unreviewed context and permits complete reconciled history", () => {
  const a = prescriptionArtifact(),
    p = a.preview.snapshot.imported_prescriptions![0],
    c = p.context;
  c.omitted_items = structuredClone(c.items);
  p.items = [];
  c.selected_items = [];
  assert.ok(
    renderRecordRelease(a).includes(
      "Observed item not selected for interpretation",
    ),
  );
  c.selected_items = p.items = structuredClone(
    prescriptionArtifact().preview.snapshot.imported_prescriptions![0].items,
  );
  c.omitted_items = [];
  c.parent.original.prescription_item_list = [501];
  c.reconciliation = reconcilePrescriptionItems([501], ["501"], true);
  c.reviewed.completeness = "complete";
  c.reviewed.partial_reason = null;
  assert.ok(renderRecordRelease(a).includes("complete"));
});
test("schema8 binds correction to exact predecessor and preserves schema7 output bytes", () => {
  const a = prescriptionArtifact(),
    p = a.preview.snapshot.imported_prescriptions![0],
    old = structuredClone(p.correction_history[0]);
  p.id = "b8000000-0000-4000-8000-000000000090";
  p.version = 2;
  p.version_hash = "a".repeat(64);
  p.replaces_id = old.id;
  p.expected_predecessor_hash = old.version_hash;
  p.correction_history.push({
    ...old,
    id: p.id,
    version: 2,
    version_hash: p.version_hash,
    replaces_id: old.id,
  });
  a.preview.snapshot.selection!.imported_prescription_ids = [p.id];
  assert.ok(renderRecordRelease(a).includes("Reviewed version 2"));
  p.expected_predecessor_hash = "f".repeat(64);
  assert.throws(
    () => renderRecordRelease(a),
    /Imported prescription provenance/,
  );
  assert.equal(
    createHash("sha256")
      .update(renderRecordRelease(vaccinationArtifact()))
      .digest("hex"),
    "e64b7a2247d0e3d20d8dead1a626d40b6acd2a6da084748e54cb5881eeeb51bd",
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
  const emailHtml = Buffer.from(
    emailResult.attachments[0].content,
    "base64",
  ).toString();
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

test("schema8 preserves repeated observed item references as partial evidence and accepts an explicitly empty optional consult", () => {
  const a = prescriptionArtifact(),
    c = a.preview.snapshot.imported_prescriptions![0].context;
  c.parent.original.consult_id = "";
  c.consult.reference = "";
  c.items.push({ ...structuredClone(c.items[0]), page: 2 });
  c.reconciliation = reconcilePrescriptionItems(null, ["501", "501"], true);
  assert.ok(renderRecordRelease(a).includes("duplicateObservedIds"));
  c.reconciliation.duplicateObservedIds = [];
  assert.throws(
    () => renderRecordRelease(a),
    /Imported prescription provenance/,
  );
});
