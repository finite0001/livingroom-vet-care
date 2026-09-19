import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildReleaseEmailPayload,
  verifyFrozenReleaseEmail,
  sha256Hex,
} from "../../supabase/functions/_shared/release-email-payload.ts";
import {
  dispatchOne,
  type OutboxRow,
} from "../../supabase/functions/_shared/outbox-dispatch.ts";
import { createPrepareReleaseEmailHandler } from "../../supabase/functions/_shared/prepare-release-email.ts";
import { historyArtifact } from "../record-releases/history-fixture.ts";
import type { ReleaseBundle } from "../../src/hub/features/record-releases/print.ts";
const releaseId = "99000000-0000-4000-8000-000000000001";
function fixture() {
  const artifact = structuredClone(historyArtifact);
  artifact.preview.snapshot.attachments = [
    {
      id: "doc",
      version: 1,
      file_name: "original.pdf",
      file_path: "actor/pet/doc/original",
      bucket: "patient-documents",
      mime_type: "application/pdf",
      file_size: 9,
      document_date: null,
      category: "medical_record",
    },
  ];
  artifact.preview.snapshot.lab_results = [];
  const bundle: ReleaseBundle = {
    release: {
      ...artifact.preview,
      id: releaseId,
      pet_id: "pet",
      client_id: "client",
      channel: "EMAIL",
      recipient: "owner@example.test",
      selection: {},
      created_by: "actor",
      created_at: "2026-09-12T18:00:00Z",
    },
    events: [],
    eligible: true,
    ineligibility_reason: null,
  };
  const intent = {
    id: "request",
    release_id: releaseId,
    actor_id: "actor",
    recipient: "owner@example.test",
    subject: "Records",
    body: "Reviewed records attached.",
    release_hash: artifact.preview.source_hash,
  };
  return {
    bundle,
    intent,
    sender: { from: "care@example.test", replyTo: "care@example.test" },
  };
}
const pdf = new TextEncoder().encode("%PDF-test");
test("attachment builder freezes real HTML and private original bytes with correct MIME and exact full payload digest", async () => {
  const f = fixture();
  let reads = 0;
  const built = await buildReleaseEmailPayload(
    f.intent,
    f.bundle,
    f.sender,
    async (bucket, path, size) => {
      reads++;
      assert.equal(bucket, "patient-documents");
      assert.equal(path, "actor/pet/doc/original");
      assert.equal(size, 9);
      return pdf;
    },
  );
  const payload = JSON.parse(built.payload_text);
  assert.equal(reads, 1);
  assert.equal(
    payload.attachments[0].filename,
    `medical-records-${releaseId}.html`,
  );
  assert.equal(payload.attachments[0].content_type, "text/html");
  const html = atob(payload.attachments[0].content);
  assert.ok(html.includes("IMPORTANT"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<script>"));
  assert.equal(payload.attachments[1].filename, "1-original.pdf");
  assert.equal(atob(payload.attachments[1].content), "%PDF-test");
  assert.ok(!built.payload_text.includes("file_path"));
  assert.equal(
    built.payload_hash,
    await sha256Hex(new TextEncoder().encode(built.payload_text)),
  );
  assert.equal(
    await verifyFrozenReleaseEmail(built, {
      ...f.sender,
      recipient: f.intent.recipient,
      subject: f.intent.subject,
      body: f.intent.body,
    }),
    built.payload_text,
  );
});
test("invalid release, original type/size and oversized encoded content fail before transport", async () => {
  const f = fixture();
  f.bundle.eligible = false;
  await assert.rejects(
    buildReleaseEmailPayload(f.intent, f.bundle, f.sender, async () => pdf),
    /eligible/,
  );
  f.bundle.eligible = true;
  await assert.rejects(
    buildReleaseEmailPayload(
      f.intent,
      f.bundle,
      f.sender,
      async () => new Uint8Array(9),
    ),
    /bytes differ/,
  );
  let downloads = 0;
  f.bundle.release.snapshot.attachments = Array.from({ length: 2 }, (_, i) => ({
    ...f.bundle.release.snapshot.attachments[0],
    id: `d${i}`,
    file_size: 20971520,
  }));
  await assert.rejects(
    buildReleaseEmailPayload(f.intent, f.bundle, f.sender, async () => {
      downloads++;
      return pdf;
    }),
    /32 MiB/,
  );
  assert.equal(downloads, 0);
});
test("frozen sender metadata and modified bytes cannot silently change on retry", async () => {
  const f = fixture();
  const p = await buildReleaseEmailPayload(
    f.intent,
    f.bundle,
    f.sender,
    async () => pdf,
  );
  await assert.rejects(
    verifyFrozenReleaseEmail(
      { ...p, payload_text: p.payload_text + " " },
      {
        ...f.sender,
        recipient: f.intent.recipient,
        subject: f.intent.subject,
        body: f.intent.body,
      },
    ),
    /integrity/,
  );
  await assert.rejects(
    verifyFrozenReleaseEmail(p, {
      from: "changed@example.test",
      replyTo: f.sender.replyTo,
      recipient: f.intent.recipient,
      subject: f.intent.subject,
      body: f.intent.body,
    }),
    /metadata/,
  );
});
test("dispatch uses identical literal provider payload and idempotency header on safe retries", async () => {
  const f = fixture();
  const frozen = await buildReleaseEmailPayload(
    f.intent,
    f.bundle,
    f.sender,
    async () => pdf,
  );
  const row: OutboxRow = {
    id: releaseId,
    channel: "EMAIL",
    recipient: f.intent.recipient,
    subject: f.intent.subject,
    body: f.intent.body,
    provider: "resend",
    state: "claimed",
    lease_token: "lease",
    provider_config: null,
  };
  const calls: string[] = [];
  let finalState = "claimed";
  const db = {
    rpc: async (name: string) => {
      calls.push(name);
      return {
        data:
          name === "read_frozen_email_payload"
            ? frozen
            : { ...row, state: finalState },
        error: null,
      };
    },
  };
  const requests: RequestInit[] = [];
  const transport = (async (_url: unknown, init: RequestInit) => {
    requests.push(init);
    return new Response(JSON.stringify({ id: releaseId }), { status: 200 });
  }) as typeof fetch;
  const env = {
    APP_ENV: "staging",
    OUTBOUND_DELIVERY_MODE: "test",
    OUTBOUND_TEST_EMAILS: f.intent.recipient,
    RESEND_API_KEY: "synthetic",
    RESEND_FROM: f.sender.from,
    RESEND_REPLY_TO: f.sender.replyTo,
  };
  await dispatchOne(db, env, transport);
  await dispatchOne(db, env, transport);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].body, frozen.payload_text);
  assert.equal(requests[1].body, requests[0].body);
  assert.equal(
    new Headers(requests[0].headers).get("Idempotency-Key"),
    `livingroom-outbox/${releaseId}`,
  );
  assert.ok(
    calls.indexOf("read_frozen_email_payload") <
      calls.indexOf("start_communication_attempt"),
  );
  finalState = "failed";
  await dispatchOne(db, env, transport);
  assert.equal(requests.length, 2);
});
test("preparation handler validates staff and reuses durable capture without redownloading or sending", async () => {
  const f = fixture();
  let downloads = 0;
  const saved = {
    request: { ...f.intent, state: "ready" },
    payload_hash: "a".repeat(64),
    manifest: [],
    report_html: "actual frozen report",
    receipt: null,
  };
  const handler = createPrepareReleaseEmailHandler({
    authenticate: async () => ({
      actorId: "actor",
      db: { rpc: async () => ({ data: saved, error: null }) },
    }),
    service: {
      rpc: async () => ({
        data: { request: f.intent, bundle: f.bundle, captured: true },
        error: null,
      }),
    },
    download: async () => {
      downloads++;
      return pdf;
    },
    sender: f.sender,
  });
  const args = {
    p_request_id: "request",
    p_release_id: releaseId,
    p_conversation_id: "conversation",
    p_subject: f.intent.subject,
    p_body: f.intent.body,
    p_release_hash: f.intent.release_hash,
  };
  const response = await handler(
    new Request("http://local/prepare", {
      method: "POST",
      headers: { Authorization: "Bearer synthetic" },
      body: JSON.stringify(args),
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(downloads, 0);
  assert.equal((await response.json()).report_html, "actual frozen report");
  const unauthorized = await handler(
    new Request("http://local/prepare", { method: "POST", body: "{}" }),
  );
  assert.equal(unauthorized.status, 401);
});
test("malformed preparation and private server failures never expose paths or bytes", async () => {
  const handler = createPrepareReleaseEmailHandler({
    authenticate: async () => ({
      actorId: "actor",
      db: {
        rpc: async () => ({
          data: null,
          error: new Error("secret private-path base64"),
        }),
      },
    }),
    service: { rpc: async () => ({ data: null, error: null }) },
    download: async () => pdf,
    sender: { from: "care@example.test", replyTo: "care@example.test" },
  });
  const response = await handler(
    new Request("http://local/prepare", {
      method: "POST",
      headers: { Authorization: "Bearer synthetic" },
      body: JSON.stringify({
        p_request_id: "r",
        p_release_id: "r",
        p_conversation_id: "c",
        p_subject: "S",
        p_body: "B",
        p_release_hash: "h",
      }),
    }),
  );
  assert.equal(response.status, 500);
  assert.ok(!(await response.text()).includes("private-path"));
});
