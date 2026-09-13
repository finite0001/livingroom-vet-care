import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { renderRecordRelease } from "../../src/hub/features/record-releases/print.ts";
import { buildReleaseEmailPayload } from "../../supabase/functions/_shared/release-email-payload.ts";
import { releaseArtifact } from "./fixture.ts";
import { chartArtifact } from "./charts-fixture.ts";
import { historyArtifact } from "./history-fixture.ts";
import { provenanceArtifact as artifact } from "./provenance-fixture.ts";
test("v1-v3 renderer output remains byte-for-byte unchanged from parent109b891", () => {
  [releaseArtifact, chartArtifact, historyArtifact].forEach((a, i) =>
    assert.equal(
      createHash("sha256").update(renderRecordRelease(a)).digest("hex"),
      [
        "8d68f3e2b2d07746f377c9ec68d7e6cc4da72598219b3b3bbe960c63a16a5e22",
        "ee3c3cccc1500983e33ed0c9622a4f32ec85ed657fd1e1eaae04a739324b490d",
        "9e633fe22f1745e2066cc57701451aea7be8c0bbbf1c723c8053bde8e8f93662",
      ][i],
    ),
  );
});
test("v4 renderer baseline remains byte-for-byte unchanged before schema5", () => {
  assert.equal(createHash("sha256").update(renderRecordRelease(artifact())).digest("hex"), "e326f81c88dd94fffb65499544fc86e942053fa7ee68baf6d44c5bacc72df28a");
});
test("v4 distinguishes reviewed values, original source and reviewer; escapes notes", () => {
  const html = renderRecordRelease(artifact());
  for (const text of [
    "25 lb",
    "11.34 kg",
    "1788267600",
    "Source clinician unknown",
    "Retain local measurement",
    "do not automatically correct",
    "has not been reviewed",
    "&lt;script&gt;attack",
  ])
    assert.ok(html.includes(text), text);
  assert.ok(!html.includes("<script>attack"));
  const linked = artifact();
  linked.preview.snapshot.weights![0].import_provenance![0].action = "link";
  assert.ok(
    renderRecordRelease(linked).includes("Existing local measurement linked"),
  );
});
test("v4 missing provenance fails closed instead of silently printing incomplete history", () => {
  const a = artifact();
  delete a.preview.snapshot.weights![0].import_provenance;
  assert.throws(() => renderRecordRelease(a), /Incomplete version 4/);
});
test("v4 email attachment freezes truthful HTML containing source reviews", async () => {
  const a = artifact();
  a.preview.snapshot.attachments = [];
  a.preview.snapshot.lab_results = [];
  const release = {
    ...a.preview,
    id: "release",
    pet_id: "pet",
    client_id: "client",
    channel: "EMAIL" as const,
    recipient: "owner@example.test",
    selection: {},
    created_by: "actor",
    created_at: "2026-09-12T18:00:00Z",
  };
  const intent = {
    id: "request",
    release_id: "release",
    actor_id: "actor",
    recipient: release.recipient,
    subject: "Weights",
    body: "Reviewed records attached.",
    release_hash: release.source_hash,
  };
  const bundle = {
    release,
    events: [],
    eligible: true,
    ineligibility_reason: null,
  };
  const built = await buildReleaseEmailPayload(
    intent,
    bundle,
    { from: "care@example.test", replyTo: "care@example.test" },
    async () => {
      throw new Error("No originals selected");
    },
  );
  const payload = JSON.parse(built.payload_text);
  assert.equal(payload.attachments[0].content_type, "text/html");
  assert.ok(payload.attachments[0].filename.endsWith(".html"));
  assert.ok(
    Buffer.from(payload.attachments[0].content, "base64")
      .toString()
      .includes("Retain local measurement"),
  );
  assert.deepEqual(
    await buildReleaseEmailPayload(
      intent,
      bundle,
      { from: "care@example.test", replyTo: "care@example.test" },
      async () => new Uint8Array(),
    ),
    built,
  );
});
