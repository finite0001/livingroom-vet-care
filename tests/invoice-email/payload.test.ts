import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildInvoiceEmailPayload,
  type InvoiceEmailIntent,
} from "../../supabase/functions/_shared/invoice-email-payload.ts";
import { createPrepareInvoiceEmailHandler } from "../../supabase/functions/_shared/prepare-invoice-email.ts";
import {
  dispatchOne,
  type OutboxRow,
} from "../../supabase/functions/_shared/outbox-dispatch.ts";
import { renderInvoiceDocument as frontendRenderer } from "../../src/hub/features/billing/invoice-document.ts";
import {
  renderInvoiceDocument,
  type InvoiceDocument,
} from "../../supabase/functions/_shared/invoice-document.ts";
const id = "98000000-0000-4000-8000-000000000001";
function fixture() {
  const document: InvoiceDocument = {
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
      name: "Family <script>attack</script>",
      mailing_address: "123 A & B",
    },
    items: [
      {
        id,
        description: "Exam <img src=x>",
        quantity: "1.000",
        unit_price_cents: "9007199254740993",
        amount_cents: "9007199254740993",
      },
    ],
    credits: [{ id, amount_cents: "1", created_at: "2026-09-12T13:30:00Z" }],
    total_cents: "9007199254740993",
  };
  const intent: InvoiceEmailIntent = {
    id: "request",
    invoice_id: id,
    client_id: id,
    actor_id: "actor",
    recipient: "invoice@example.test",
    subject: "Your invoice",
    body: "Reviewed invoice attached.",
    invoice_hash: "a".repeat(64),
    invoice_snapshot: document,
  };
  return {
    intent,
    bundle: {
      document,
      source_hash: intent.invoice_hash,
      client_id: id,
      recipient: intent.recipient,
    },
    sender: { from: "care@example.test", replyTo: "care@example.test" },
    practice: {
      name: "The Living Room Vet",
      address: "2619 Spruce Street, Boulder, CO",
      domain: "thelivingroom.vet",
    },
  };
}
test("invoice HTML preserves exact BigInt cents and frozen content without private notes or payment claims", async () => {
  const f = fixture();
  Object.assign(f.bundle.document, { internal_notes: "PRIVATE INVOICE NOTES" });
  Object.assign(f.bundle.document.credits[0], {
    reason: "PRIVATE CREDIT REASON",
  });
  const p = await buildInvoiceEmailPayload(
    f.intent,
    f.bundle,
    f.sender,
    f.practice,
  );
  const payload = JSON.parse(p.payload_text);
  assert.equal(payload.attachments.length, 1);
  assert.equal(payload.attachments[0].filename, `invoice-${id}.html`);
  assert.equal(payload.attachments[0].content_type, "text/html");
  const html = Buffer.from(payload.attachments[0].content, "base64").toString();
  assert.match(html, /\$90,071,992,547,409\.93/);
  assert.match(html, /\$90,071,992,547,409\.92/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(
    html,
    /not a payment receipt or a statement of outstanding balance/,
  );
  assert.doesNotMatch(
    html,
    /<script|<img|PRIVATE INVOICE NOTES|PRIVATE CREDIT REASON/,
  );
  assert.deepEqual(
    await buildInvoiceEmailPayload(f.intent, f.bundle, f.sender, f.practice),
    p,
  );
  assert.equal(frontendRenderer, renderInvoiceDocument);
});
test("invoice builder rejects wrong source/household/status and bounds the complete encoded request", async () => {
  const f = fixture();
  await assert.rejects(
    buildInvoiceEmailPayload(
      f.intent,
      { ...f.bundle, source_hash: "b".repeat(64) },
      f.sender,
      f.practice,
    ),
    /no longer matches/,
  );
  await assert.rejects(
    buildInvoiceEmailPayload(
      f.intent,
      { ...f.bundle, document: { ...f.bundle.document, status: "draft" } },
      f.sender,
      f.practice,
    ),
    /no longer matches/,
  );
  await assert.rejects(
    buildInvoiceEmailPayload(
      { ...f.intent, client_id: "other" },
      f.bundle,
      f.sender,
      f.practice,
    ),
    /no longer matches/,
  );
  await assert.rejects(
    buildInvoiceEmailPayload(
      { ...f.intent, body: "界".repeat(12 * 1024 * 1024) },
      f.bundle,
      f.sender,
      f.practice,
    ),
    /32 MiB/,
  );
});
test("invoice dispatcher sends exact frozen bytes with payload proof and stable provider idempotency", async () => {
  const f = fixture();
  const frozen = await buildInvoiceEmailPayload(
    f.intent,
    f.bundle,
    f.sender,
    f.practice,
  );
  const row = {
    id,
    channel: "EMAIL",
    recipient: f.intent.recipient,
    subject: f.intent.subject,
    body: f.intent.body,
    lease_token: "lease",
    state: "claimed",
    provider_config: null,
  } as OutboxRow;
  const starts: Record<string, unknown>[] = [];
  const sent: Array<{ body: string; key: string | null }> = [];
  const db = {
    rpc: async (name: string, args?: Record<string, unknown>) => {
      if (name === "claim_communication") return { data: row, error: null };
      if (name === "read_frozen_email_payload")
        return { data: { ...frozen, artifact_kind: "invoice" }, error: null };
      if (name === "start_communication_attempt") {
        starts.push(args!);
        return { data: row, error: null };
      }
      if (name === "finish_communication_attempt")
        return { data: null, error: null };
      throw new Error("Unexpected RPC " + name);
    },
  };
  const env = {
    APP_ENV: "staging",
    OUTBOUND_DELIVERY_MODE: "test",
    OUTBOUND_TEST_EMAILS: f.intent.recipient,
    RESEND_API_KEY: "synthetic",
    RESEND_FROM: f.sender.from,
    RESEND_REPLY_TO: f.sender.replyTo,
  };
  const transport = async (
    _url: string | URL | Request,
    init?: RequestInit,
  ) => {
    sent.push({
      body: String(init?.body),
      key: new Headers(init?.headers).get("Idempotency-Key"),
    });
    return new Response(JSON.stringify({ id: "provider-fixture" }), {
      status: 200,
    });
  };
  await dispatchOne(db, env, transport);
  await dispatchOne(db, env, transport);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].body, frozen.payload_text);
  assert.deepEqual(sent[0], sent[1]);
  assert.equal(sent[0].key, `livingroom-outbox/${id}`);
  assert.equal(
    (starts[0].p_provider_config as { invoice_payload_hash: string })
      .invoice_payload_hash,
    frozen.payload_hash,
  );
});
test("invoice preparation recovers captured or queued requests without recapturing or autoqueueing", async () => {
  const f = fixture();
  let captured = false;
  let queued = false;
  let captures = 0;
  const calls: string[] = [];
  const prepared = () => ({
    request: {
      ...f.intent,
      state: queued ? "queued" : captured ? "ready" : "preparing",
    },
    payload_hash: captured ? "b".repeat(64) : null,
    manifest: captured ? [] : null,
    report_html: captured ? "<h1>Invoice</h1>" : null,
    receipt: queued ? { outbox_id: id } : null,
  });
  const rpc = async (name: string) => {
    calls.push(name);
    if (name === "prepare_invoice_email" || name === "recover_invoice_email")
      return { data: prepared(), error: null };
    if (name === "invoice_email_capture_context")
      return {
        data: { request: f.intent, bundle: f.bundle, captured },
        error: null,
      };
    if (name === "capture_invoice_email_payload") {
      captured = true;
      captures++;
      return { data: null, error: null };
    }
    throw new Error(name);
  };
  const handler = createPrepareInvoiceEmailHandler({
    authenticate: async () => ({ actorId: "actor", db: { rpc } }),
    service: { rpc },
    sender: f.sender,
    practice: f.practice,
  });
  const args = {
    p_request_id: "request",
    p_invoice_id: id,
    p_client_id: id,
    p_conversation_id: "conversation",
    p_recipient: f.intent.recipient,
    p_subject: f.intent.subject,
    p_body: f.intent.body,
    p_invoice_hash: f.intent.invoice_hash,
  };
  const request = () =>
    new Request("https://example.test/prepare-invoice-email", {
      method: "POST",
      headers: { Authorization: "Bearer synthetic" },
      body: JSON.stringify(args),
    });
  assert.equal((await handler(request())).status, 200);
  assert.equal((await handler(request())).status, 200);
  assert.equal(captures, 1);
  queued = true;
  assert.equal((await handler(request())).status, 200);
  assert.equal(captures, 1);
  assert.ok(!calls.includes("enqueue_invoice_email"));
  const bad = await handler(
    new Request("https://example.test", {
      method: "POST",
      headers: { Authorization: "Bearer synthetic" },
      body: JSON.stringify({ ...args, attachment_ids: ["raw-id"] }),
    }),
  );
  assert.equal(bad.status, 400);
  assert.equal(
    (await handler(new Request("https://example.test", { method: "POST" })))
      .status,
    401,
  );
});
