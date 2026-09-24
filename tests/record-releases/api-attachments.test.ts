import test from "node:test";
import assert from "node:assert/strict";
import {
  apiAttachmentArtifact,
  apiOriginalBytes,
} from "./api-attachment-fixture.ts";
import {
  renderRecordRelease,
  type ReleaseBundle,
} from "../../supabase/functions/_shared/record-release-renderer.ts";
import { buildReleaseEmailPayload } from "../../supabase/functions/_shared/release-email-payload.ts";
import { buildDocumentLinkArtifacts } from "../../supabase/functions/_shared/document-link-artifacts.ts";

test("schema9 renders API provenance alongside older lab and manual-export originals", () => {
  const a = apiAttachmentArtifact();
  a.preview.snapshot.api_attachments![0].record.title =
    "<script>source</script>";
  const html = renderRecordRelease(a);
  assert.match(html, /Selected ezyVet API originals/);
  assert.match(html, /Selected laboratory report provenance/);
  assert.match(html, /Selected external medical originals/);
  assert.match(html, /&lt;script&gt;source&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(
    html,
    new RegExp(a.preview.snapshot.api_attachments![0].capture.object_path),
  );
});
const invalid: {
  [name: string]: (a: ReturnType<typeof apiAttachmentArtifact>) => void;
} = {
  "missing source": (a) => {
    a.preview.snapshot.api_attachments = [];
  },
  "unselected source": (a) => {
    a.preview.snapshot.selection!.api_attachment_ids = [];
  },
  "duplicate source": (a) => {
    a.preview.snapshot.api_attachments!.push(
      a.preview.snapshot.api_attachments![0],
    );
  },
  "wrong patient": (a) => {
    a.preview.snapshot.api_attachments![0].record.pet_id =
      "d9000000-0000-4000-8000-999999999999";
  },
  "wrong parent": (a) => {
    a.preview.snapshot.api_attachments![0].record.source_context.parent.pet_id =
      "d9000000-0000-4000-8000-999999999999";
  },
  "capture owner": (a) => {
    a.preview.snapshot.api_attachments![0].capture.actor_id =
      "d9000000-0000-4000-8000-999999999999";
  },
  "capture digest": (a) => {
    a.preview.snapshot.api_attachments![0].capture.content_sha256 = "0".repeat(
      64,
    );
  },
  "wrong approval reference": (a) => {
    a.preview.snapshot.attachments.at(-1)!.api_attachment_ref!.record_hash =
      "0".repeat(64);
  },
  "missing original": (a) => {
    a.preview.snapshot.attachments.pop();
  },
  "ordinary downgrade": (a) => {
    a.preview.snapshot.attachments.at(-1)!.bucket = "patient-documents";
  },
  "path traversal": (a) => {
    a.preview.snapshot.api_attachments![0].capture.object_path +=
      "/../original";
  },
  "wrong version": (a) => {
    a.preview.snapshot.attachments.at(-1)!.version = 2;
  },
  "schema downgrade": (a) => {
    a.preview.snapshot.schema_version = 8;
  },
  "hidden provider metadata": (a) => {
    Object.assign(
      a.preview.snapshot.api_attachments![0].record.source_context,
      {
        attachment_metadata: {
          file_download_url: "https://example.test/private",
        },
      },
    );
  },
};
for (const [name, mutate] of Object.entries(invalid))
  test(`schema9 rejects ${name}`, () => {
    const a = apiAttachmentArtifact();
    mutate(a);
    assert.throws(() => renderRecordRelease(a), /schema9 API attachment/);
  });
function bundle(channel: "EMAIL" | "SMS"): ReleaseBundle {
  const a = apiAttachmentArtifact();
  return {
    release: {
      ...a.preview,
      id: "d9000000-0000-4000-8000-000000009000",
      pet_id: a.preview.snapshot.patient.id,
      client_id: a.preview.snapshot.recipient.client_id,
      channel,
      recipient: channel === "EMAIL" ? "owner@example.test" : "+13035550123",
      selection: a.preview.snapshot.selection!,
      created_by: "d9000000-0000-4000-8000-000000009001",
      created_at: "2026-09-13T12:00:00Z",
    },
    events: [],
    eligible: true,
    ineligibility_reason: null,
  };
}
for (const channel of ["EMAIL", "SMS"] as const)
  test(`schema9 ${channel} freezes mixed originals and rejects changed API bytes`, async () => {
    const b = bundle(channel),
      calls: string[] = [];
    const build = (bad = false) => {
      const download = async (bucket: string) => {
        calls.push(bucket);
        const changed = apiOriginalBytes.slice();
        changed[changed.length - 1] ^= 1;
        return bad && bucket === "ezyvet-attachment-originals"
          ? changed
          : apiOriginalBytes;
      };
      return channel === "EMAIL"
        ? buildReleaseEmailPayload(
            {
              id: "request",
              release_id: b.release.id,
              actor_id: b.release.created_by,
              recipient: b.release.recipient,
              subject: "Records",
              body: "Reviewed originals",
              release_hash: b.release.source_hash,
            },
            b,
            { from: "care@example.test", replyTo: "care@example.test" },
            download,
          )
        : buildDocumentLinkArtifacts(
            {
              id: "grant",
              family: "record_release",
              source_id: b.release.id,
              client_id: b.release.client_id,
              actor_id: b.release.created_by,
              recipient: b.release.recipient,
              source_hash: b.release.source_hash,
              source_bundle: b,
              created_at: b.release.created_at,
              expires_at: "2026-09-14T00:00:00Z",
              origin: "https://example.test",
              key_version: "test",
              capability_context: "synthetic",
              message_template: "Review records",
              state: "preparing",
            },
            { name: "Synthetic", address: "Synthetic", domain: null },
            download,
          );
    };
    await build();
    assert.ok(calls.includes("patient-documents"));
    assert.ok(calls.includes("ezyvet-attachment-originals"));
    await assert.rejects(
      build(true),
      /bytes.*(capture|provenance)|original.*capture/i,
    );
  });

test("schema9 retains canonical prescription validation and partial disclosure", async () => {
  const { prescriptionArtifact } = await import("./prescription-fixture.ts");
  const a: ReturnType<typeof prescriptionArtifact> = JSON.parse(
      JSON.stringify(prescriptionArtifact())
        .replaceAll('"pet"', '"d9000000-0000-4000-8000-000000000001"')
        .replaceAll('"household"', '"d9000000-0000-4000-8000-000000000002"'),
    ),
    source = structuredClone(
      apiAttachmentArtifact().preview.snapshot.api_attachments![0],
    );
  source.record.pet_id = a.preview.snapshot.patient.id;
  source.capture.pet_id = source.record.pet_id;
  source.record.source_context.parent.pet_id = source.record.pet_id;
  source.record.source_context.parent.client_id =
    a.preview.snapshot.recipient.client_id;
  const parts = source.capture.object_path.split("/");
  parts[1] = source.record.pet_id;
  source.capture.object_path = parts.join("/");
  const { releaseApiAttachmentDocument } = await import(
    "../../supabase/functions/_shared/record-release-api-attachments.ts"
  );
  a.preview.snapshot.schema_version = 9;
  a.preview.snapshot.api_attachments = [source];
  a.preview.snapshot.selection!.api_attachment_ids = [source.record.id];
  a.preview.snapshot.attachments.push(releaseApiAttachmentDocument(source));
  const html = renderRecordRelease(a);
  assert.match(html, /Clinician-reviewed outside prescription history/);
  assert.match(html, /Selected ezyVet API originals/);
  assert.match(html, /Partial/i);
  a.preview.snapshot.selection!.imported_prescription_ids = [];
  assert.throws(() => renderRecordRelease(a), /prescription/);
});

test("schema9 permits 20 API originals within 24 files and rejects either overflow", async () => {
  const { releaseApiAttachmentDocument } = await import(
    "../../supabase/functions/_shared/record-release-api-attachments.ts"
  );
  const a = apiAttachmentArtifact(),
    s = a.preview.snapshot,
    template = structuredClone(s.api_attachments![0]);
  const uuid = (n: number) =>
    `d9100000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  s.attachments = s.attachments.filter((d) => !d.api_attachment_ref);
  s.api_attachments = [];
  s.selection!.api_attachment_ids = [];
  for (let i = 0; i < 20; i++) {
    const v = structuredClone(template);
    v.record.id = uuid(i * 4 + 1);
    v.record.request_id = uuid(i * 4 + 2);
    v.capture.request_id = v.record.request_id;
    v.capture.intent_id = uuid(i * 4 + 3);
    v.capture.storage_object_id = uuid(i * 4 + 4);
    v.capture.object_path = `${v.capture.actor_id}/${v.capture.pet_id}/${v.capture.request_id}/${v.capture.intent_id}/original`;
    v.record.attachment_external_id = String(800 + i);
    v.record.source_context.attachment_external_id =
      v.record.attachment_external_id;
    v.record.source_context.file_id = String(100 + i);
    s.api_attachments.push(v);
    s.selection!.api_attachment_ids.push(v.record.id);
    s.attachments.push(releaseApiAttachmentDocument(v));
  }
  while (s.attachments.length < 24) {
    const d = { ...s.attachments[0], id: uuid(200 + s.attachments.length) };
    delete d.provenance_captures;
    delete d.content_sha256;
    s.attachments.push(d);
  }
  assert.doesNotThrow(() => renderRecordRelease(a));
  const b = bundle("EMAIL");
  b.release.snapshot = s;
  b.release.selection = s.selection!;
  let downloads = 0;
  await buildReleaseEmailPayload(
    {
      id: "bounded-request",
      release_id: b.release.id,
      actor_id: b.release.created_by,
      recipient: b.release.recipient,
      subject: "Synthetic records",
      body: "Synthetic bounded package",
      release_hash: b.release.source_hash,
    },
    b,
    { from: "care@example.test", replyTo: "care@example.test" },
    async () => {
      downloads++;
      return apiOriginalBytes;
    },
  );
  assert.equal(downloads, 24);
  const extra = structuredClone(s.api_attachments[0]);
  s.api_attachments.push(extra);
  assert.throws(() => renderRecordRelease(a), /schema9 API attachment/);
  s.api_attachments.pop();
  s.attachments.push({ ...s.attachments[0], id: uuid(999) });
  assert.throws(() => renderRecordRelease(a), /schema9 API attachment/);
});
