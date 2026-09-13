import test from "node:test";
import assert from "node:assert/strict";
import {
  documentLinkConfig,
  materializeDocumentLink,
} from "../../supabase/functions/_shared/document-link-capability.ts";
import {
  buildDocumentLinkArtifacts,
  type DocumentLinkGrant,
} from "../../supabase/functions/_shared/document-link-artifacts.ts";
import {
  createRetrieveDocumentLinkHandler,
  createStaffDocumentLinkHandler,
  type LinkDatabase,
} from "../../supabase/functions/_shared/document-link-http.ts";
import { sha256Hex } from "../../supabase/functions/_shared/release-email-payload.ts";
import { historyArtifact } from "../record-releases/history-fixture.ts";
const id = "99200000-0000-4000-8000-000000000001";
const config = () =>
  documentLinkConfig({
    origin: "https://thelivingroom.vet",
    activeKeyVersion: "test-v1",
    keys: JSON.stringify({
      "test-v1": btoa("synthetic-only-key-32-bytes-000001"),
    }),
    publicEnabled: "true",
  });
const practice = {
  name: "The Living Room Veterinary Care",
  address: "2619 Spruce Street, Boulder, CO",
  domain: "thelivingroom.vet",
};
function grant(): DocumentLinkGrant {
  return {
    id,
    family: "invoice",
    source_id: id,
    client_id: id,
    actor_id: id,
    recipient: "+13035550404",
    source_hash: "a".repeat(64),
    source_bundle: {
      document: {
        id,
        status: "issued",
        currency: "usd",
        version: 3,
        created_at: "2026-09-12T12:00:00Z",
        issued_at: "2026-09-12T13:00:00Z",
        voided_at: null,
        rendered_at: "2026-09-12T14:00:00Z",
        client: {
          id,
          name: "Synthetic <script>Household",
          mailing_address: "Synthetic address",
        },
        items: [
          {
            id,
            description: "Exam",
            quantity: "1",
            unit_price_cents: "1000",
            amount_cents: "1000",
          },
        ],
        credits: [],
        total_cents: "1000",
      },
    },
    created_at: "2026-09-12T14:00:00Z",
    expires_at: "2026-09-13T14:00:00Z",
    origin: "https://thelivingroom.vet",
    key_version: "test-v1",
    capability_context:
      '{"domain":"lrv-document-link/v1","id":"' + id + '","expiry":"fixed"}',
    message_template: "Reviewed documents: {{document_link}}",
    state: "preparing",
  };
}
function recordGrant() {
  const g = grant();
  g.family = "record_release";
  const artifact = structuredClone(historyArtifact);
  artifact.preview.snapshot.lab_results = [];
  artifact.preview.snapshot.attachments = [
    {
      id,
      version: 1,
      file_name: "original.pdf",
      file_path: "synthetic/patient/original",
      bucket: "patient-documents",
      mime_type: "application/pdf",
      file_size: 9,
      document_date: null,
      category: "medical_record",
    },
  ];
  g.source_hash = artifact.preview.source_hash;
  g.source_bundle = {
    release: {
      ...artifact.preview,
      id,
      pet_id: id,
      client_id: id,
      channel: "SMS",
      recipient: g.recipient,
      selection: {},
      created_by: id,
      created_at: g.created_at,
    },
    events: [],
    eligible: true,
    ineligibility_reason: null,
  };
  return g;
}
test("capability is deterministic, context bound, fragment-only and unavailable after key removal or origin change", async () => {
  const g = grant(),
    c = config(),
    a = await materializeDocumentLink(g, c),
    b = await materializeDocumentLink(g, c);
  assert.deepEqual(a, b);
  assert.match(a.token, /^v1\.[A-Za-z0-9_-]{43}$/);
  assert.equal(new URL(a.client_url).search, "");
  assert.equal(new URL(a.client_url).hash, "#" + a.token);
  assert.notEqual(
    a.token,
    (
      await materializeDocumentLink(
        { ...g, capability_context: g.capability_context + " " },
        c,
      )
    ).token,
  );
  await assert.rejects(() => materializeDocumentLink(g, { ...c, keys: {} }));
  await assert.rejects(() =>
    materializeDocumentLink(g, { ...c, origin: "https://other.example.test" }),
  );
  assert.throws(() => documentLinkConfig({}));
  assert.equal(
    documentLinkConfig({
      origin: c.origin,
      activeKeyVersion: c.activeKeyVersion,
      keys: JSON.stringify(c.keys),
    }).publicEnabled,
    false,
  );
});
test("both source families render actual HTML and selected originals without channel coercion", async () => {
  const invoice = await buildDocumentLinkArtifacts(
    grant(),
    practice,
    async () => {
      throw new Error("Unexpected original");
    },
  );
  const a = JSON.parse(invoice.payload_text).artifacts;
  assert.equal(a.length, 1);
  assert.match(atob(a[0].content), /Synthetic &lt;script&gt;Household/);
  assert.doesNotMatch(atob(a[0].content), /<script>/);
  let downloads = 0;
  const g = recordGrant();
  const record = await buildDocumentLinkArtifacts(
    g,
    practice,
    async (bucket, path, size) => {
      downloads++;
      assert.equal(bucket, "patient-documents");
      assert.equal(size, 9);
      assert.equal(path, "synthetic/patient/original");
      return new TextEncoder().encode("%PDF-test");
    },
  );
  assert.equal(downloads, 1);
  assert.equal(
    JSON.parse(record.payload_text).artifacts[1].content,
    "JVBERi10ZXN0",
  );
  const altered = structuredClone(g);
  (altered.source_bundle as { release: { channel: string } }).release.channel =
    "EMAIL";
  await assert.rejects(() =>
    buildDocumentLinkArtifacts(altered, practice, async () => new Uint8Array()),
  );
  await assert.rejects(() =>
    buildDocumentLinkArtifacts(g, practice, async () =>
      new TextEncoder().encode("corrupted"),
    ),
  );
});
test("public requests fail closed, reject token/index confusion, and return only verified bytes or safe manifest", async () => {
  const g = grant(),
    c = config(),
    cap = await materializeDocumentLink(g, c),
    bytes = new TextEncoder().encode("<h1>Frozen</h1>"),
    hash = await sha256Hex(bytes);
  let calls = 0;
  let corrupt = false;
  const service: LinkDatabase = {
    rpc: async (name) => {
      calls++;
      return {
        error: null,
        data:
          name === "document_link_access_context"
            ? { ...g, token_hash: cap.token_hash }
            : {
                grant_id: id,
                expires_at: g.expires_at,
                private_path: "never expose",
                manifest: [
                  {
                    index: 0,
                    filename: "invoice.html",
                    mime_type: "text/html",
                    file_size: bytes.length,
                    sha256: hash,
                    private_path: "never expose",
                  },
                ],
                filename: "invoice.html",
                mime_type: "text/html",
                file_size: bytes.length,
                sha256: hash,
                content: btoa(corrupt ? "wrong bytes" : "<h1>Frozen</h1>"),
              },
      };
    },
  };
  const handler = createRetrieveDocumentLinkHandler({ service, config: c });
  const request = (token = cap.token, index: unknown = null) =>
    new Request("http://local/retrieve", {
      method: "POST",
      body: JSON.stringify({ grant_id: id, token, artifact_index: index }),
    });
  assert.equal(
    (
      await createRetrieveDocumentLinkHandler({ service, config: null })(
        request(),
      )
    ).status,
    503,
  );
  assert.equal(calls, 0);
  for (const index of [-1, 0.5, "0", 25])
    assert.equal((await handler(request(cap.token, index))).status, 404);
  assert.equal((await handler(request("v1." + "x".repeat(43)))).status, 404);
  const meta = await handler(request());
  assert.equal(meta.status, 200);
  assert.doesNotMatch(await meta.text(), /private_path|content/);
  const result = await handler(request(cap.token, 0));
  assert.equal(result.status, 200);
  assert.equal(await result.text(), "<h1>Frozen</h1>");
  assert.equal(result.headers.get("cache-control"), "no-store, private");
  assert.match(result.headers.get("content-security-policy")!, /sandbox/);
  assert.match(result.headers.get("content-disposition")!, /^attachment/);
  corrupt = true;
  assert.equal((await handler(request(cap.token, 0))).status, 404);
});
test("staff capture persists hashes and frozen artifacts only; lost retry/recovery never rerenders or reviews", async () => {
  const g = grant(),
    c = config();
  let saved: Record<string, unknown> | null = null;
  let captures = 0;
  const names: string[] = [];
  const db: LinkDatabase = {
    rpc: async (name, args) => {
      names.push(name);
      if (name === "recover_document_link") return { data: saved, error: null };
      if (name === "prepare_document_link") {
        saved ??= {
          grant: g,
          artifact_hash: null,
          message_hash: null,
          manifest: null,
          report_html: null,
          events: [],
          receipt: null,
        };
        return { data: saved, error: null };
      }
      if (name === "document_link_capture_context")
        return { data: { grant: g, captured: captures > 0 }, error: null };
      if (name === "capture_document_link") {
        captures++;
        const cap = await materializeDocumentLink(g, c);
        assert.equal(args.p_token_hash, cap.token_hash);
        assert.equal(args.p_message_hash, cap.message_hash);
        assert.doesNotMatch(
          JSON.stringify(args),
          new RegExp(cap.token.replaceAll(".", "\\.")),
        );
        saved = {
          ...saved,
          grant: { ...g, state: "captured" },
          artifact_hash: await sha256Hex(
            new TextEncoder().encode(String(args.p_payload_text)),
          ),
          message_hash: args.p_message_hash,
        };
        return { data: null, error: null };
      }
      throw new Error(name);
    },
  };
  const deps = {
    config: c,
    service: db,
    authenticate: async () => ({ actorId: id, db }),
    practice,
    download: async () => new Uint8Array(),
  };
  const handler = createStaffDocumentLinkHandler(deps, "prepare");
  const body = {
    p_request_id: id,
    p_family: "invoice",
    p_source_id: id,
    p_client_id: id,
    p_conversation_id: id,
    p_recipient: g.recipient,
    p_source_hash: g.source_hash,
    p_expires_at: g.expires_at,
    p_message_template: g.message_template,
  };
  const request = () =>
    new Request("http://local/prepare", {
      method: "POST",
      headers: { Authorization: "Bearer synthetic" },
      body: JSON.stringify(body),
    });
  const first = await handler(request());
  assert.equal(first.status, 200);
  const result = await first.json();
  assert.match(result.client_url, /#v1\./);
  assert.equal((await handler(request())).status, 200);
  assert.equal(captures, 1);
  assert.equal(names.includes("attest_document_link"), false);
  const recover = createStaffDocumentLinkHandler(deps, "recover");
  assert.equal(
    (
      await recover(
        new Request("http://local/recover", {
          method: "POST",
          headers: { Authorization: "Bearer synthetic" },
          body: JSON.stringify({
            p_family: "invoice",
            p_source_id: id,
            p_request_id: id,
          }),
        }),
      )
    ).status,
    200,
  );
  assert.equal(captures, 1);
  assert.equal(
    (
      await handler(
        new Request("http://local", {
          method: "POST",
          body: JSON.stringify(body),
        }),
      )
    ).status,
    401,
  );
});
