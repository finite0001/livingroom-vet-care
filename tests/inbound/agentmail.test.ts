import { test } from "node:test";
import assert from "node:assert/strict";
import { Webhook } from "svix";
import {
  agentMailAttachmentId,
  agentMailResourceId,
  receiveAgentMail,
  retrieveAgentMailAttachment,
} from "../../supabase/functions/_shared/inbound/agentmail.ts";
import type { ProviderEvent } from "../../supabase/functions/_shared/inbound/handlers.ts";
import { processOneInbound } from "../../supabase/functions/_shared/inbound/process.ts";
import { WebhookError } from "../../supabase/functions/_shared/inbound/verification.ts";

const secret = `whsec_${Buffer.from("synthetic-agentmail-webhook-secret").toString("base64")}`;
const verifier = new Webhook(secret);
const verify = (raw: string, headers: Record<string, string>) => verifier.verify(raw, headers);
const env = { AGENTMAIL_INBOX_ID: "inbox_synthetic", AGENTMAIL_INBOX_ADDRESS: "Care@Reply.Example.test" };
const messageId = "<reply-1@mail.example.test>";
const created = "2026-09-27T18:00:00.000Z";
function payload(change: Record<string, unknown> = {}, message: Record<string, unknown> = {}) {
  return {
    type: "event",
    event_type: "message.received",
    event_id: "evt_synthetic",
    message: {
      inbox_id: env.AGENTMAIL_INBOX_ID,
      thread_id: "thd_synthetic",
      message_id: messageId,
      from: "Family Member <Family@Example.test>",
      to: ["care@thelivingroom.example"],
      subject: "PRIVATE_SUBJECT",
      text: "PRIVATE_BODY",
      created_at: created,
      ...message,
    },
    ...change,
  };
}
function signed(value: unknown, options: { id?: string; at?: Date; forge?: boolean; raw?: string } = {}) {
  const raw = options.raw ?? JSON.stringify(value);
  const id = options.id ?? "msg_synthetic_delivery";
  const at = options.at ?? new Date();
  return new Request("https://edge.example.test/functions/v1/agentmail-inbound-webhook", {
    method: "POST",
    body: raw,
    headers: {
      "content-type": "application/json",
      "svix-id": id,
      "svix-timestamp": String(Math.floor(at.getTime() / 1000)),
      "svix-signature": options.forge ? "v1,Zm9yZ2Vk" : verifier.sign(id, at, raw),
    },
  });
}
function database(error: unknown = null) {
  const calls: { name: string; args?: Record<string, unknown> }[] = [];
  return {
    calls,
    rpc: async (name: string, args?: Record<string, unknown>) => {
      calls.push({ name, args });
      return { data: error ? null : { id: "event" }, error };
    },
  };
}
const status = (value: number) => (error: unknown) => error instanceof WebhookError && error.status === value;

test("valid AgentMail signature persists only signed identity metadata before any content fetch", async () => {
  const db = database();
  assert.deepEqual(await receiveAgentMail(signed(payload()), db, env, verify), { id: "event" });
  assert.equal(db.calls.length, 1);
  const args = db.calls[0].args!;
  assert.equal(db.calls[0].name, "receive_communication_event");
  assert.equal(args.p_provider, "agentmail");
  assert.equal(args.p_event_id, "msg_synthetic_delivery");
  assert.equal(args.p_event_type, "inbound");
  assert.equal(args.p_resource_id, await agentMailResourceId(env.AGENTMAIL_INBOX_ID, messageId));
  assert.match(String(args.p_resource_id), /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.deepEqual(args.p_metadata, {
    from: "family@example.test",
    to: "care@reply.example.test",
    inbox_id: env.AGENTMAIL_INBOX_ID,
    message_id: messageId,
    thread_id: "thd_synthetic",
    event_id: "evt_synthetic",
    created_at: created,
  });
  // Bodies and subjects are fetched later from the provider API, never stored from the webhook.
  assert.ok(!JSON.stringify(db.calls).includes("PRIVATE_"));
});

test("invalid, tampered, missing and stale proofs cause no database access", async () => {
  const cases = [
    signed(payload(), { forge: true }),
    new Request("https://edge.example.test", { method: "POST", body: JSON.stringify(payload()) }),
    signed(payload(), { at: new Date(Date.now() - 10 * 60 * 1000) }),
    signed(payload(), { at: new Date(Date.now() + 10 * 60 * 1000) }),
  ];
  const tampered = signed(payload());
  const body = (await tampered.text()).replace("Family@", "Attacker@");
  cases.push(new Request(tampered.url, { method: "POST", body, headers: tampered.headers }));
  for (const request of cases) {
    const db = database();
    await assert.rejects(receiveAgentMail(request, db, env, verify), status(401));
    assert.equal(db.calls.length, 0);
  }
});

test("replayed delivery reuses the same durable event identity and payload hash", async () => {
  const db = database();
  const at = new Date();
  await receiveAgentMail(signed(payload(), { at }), db, env, verify);
  await receiveAgentMail(signed(payload(), { at }), db, env, verify);
  assert.equal(db.calls.length, 2);
  assert.deepEqual(db.calls[0].args, db.calls[1].args);
  // The database rejects a reused event id with changed metadata (23505); that is a retryable 503, never a 2xx.
  await assert.rejects(
    receiveAgentMail(signed(payload({}, { from: "other@example.test" })), database({ code: "23505" }), env, verify),
    (error: unknown) => error instanceof WebhookError && error.status === 503 && error.code === "23505",
  );
});

test("configuration, inbox, method, size and event-type gates fail closed before persistence", async () => {
  for (const [delta, expected] of [
    [{ AGENTMAIL_INBOX_ID: undefined }, 503],
    [{ AGENTMAIL_INBOX_ADDRESS: "not-a-mailbox" }, 503],
    [{ AGENTMAIL_INBOX_ID: "inbox_other" }, 400],
  ] as [Record<string, string | undefined>, number][]) {
    const db = database();
    await assert.rejects(receiveAgentMail(signed(payload()), db, { ...env, ...delta }, verify), status(expected));
    assert.equal(db.calls.length, 0);
  }
  for (const [value, expected] of [
    [payload({ event_type: "message.unknown" }), 400],
    [payload({ event_type: undefined }), 400],
    [payload({ message: null }), 400],
    [payload({}, { message_id: "" }), 400],
    [payload({}, { message_id: "has space@x" }), 400],
    [payload({}, { from: "not an address" }), 400],
    [payload({}, { created_at: "yesterday" }), 400],
  ] as [unknown, number][]) {
    const db = database();
    await assert.rejects(receiveAgentMail(signed(value), db, env, verify), status(expected));
    assert.equal(db.calls.length, 0);
  }
  const db = database();
  await assert.rejects(
    receiveAgentMail(new Request("https://edge.example.test", { method: "GET" }), db, env, verify),
    status(405),
  );
  const huge = JSON.stringify(payload({}, { html: "x".repeat(4 * 1024 * 1024) }));
  await assert.rejects(receiveAgentMail(signed(null, { raw: huge }), db, env, verify), status(413));
  assert.equal(db.calls.length, 0);
});

test("non-receipt and filtered receipt events are acknowledged without persistence", async () => {
  for (const eventType of ["message.sent", "message.delivered", "message.bounced", "domain.verified",
    "message.received.spam", "message.received.blocked", "message.received.unauthenticated"]) {
    const db = database();
    assert.deepEqual(await receiveAgentMail(signed(payload({ event_type: eventType })), db, env, verify), {
      ignored: true, event_type: eventType,
    });
    assert.equal(db.calls.length, 0);
  }
});

async function agentMailEvent(metadata: Record<string, unknown> = {}): Promise<ProviderEvent> {
  return {
    id: "event-row",
    provider: "agentmail",
    event_type: "inbound",
    resource_id: await agentMailResourceId(env.AGENTMAIL_INBOX_ID, messageId),
    lease_token: "lease",
    metadata: {
      from: "family@example.test", to: "care@reply.example.test", inbox_id: env.AGENTMAIL_INBOX_ID,
      message_id: messageId, thread_id: "thd_synthetic", event_id: "evt_synthetic", created_at: created, ...metadata,
    },
  };
}
function worker(event: ProviderEvent | null) {
  const calls: { name: string; args?: Record<string, unknown> }[] = [];
  return {
    calls,
    rpc: async (name: string, args?: Record<string, unknown>) => {
      calls.push({ name, args });
      return {
        data: name === "claim_communication_event" ? event
          : name === "release_communication_event_outcome" ? { id: event?.id, state: args?.p_review ? "review" : "pending" }
          : { id: "inbound" },
        error: null,
      };
    },
  };
}
const workerEnv = { AGENTMAIL_API_KEY: "synthetic-agentmail-key", AGENTMAIL_INBOX_ID: env.AGENTMAIL_INBOX_ID };
function providerMessage(change: Record<string, unknown> = {}) {
  return {
    inbox_id: env.AGENTMAIL_INBOX_ID, thread_id: "thd_synthetic", message_id: messageId,
    labels: ["received"], timestamp: created, from: "Family Member <family@example.test>",
    to: ["care@thelivingroom.example"], size: 100, updated_at: created, created_at: created,
    subject: "Visit follow-up", text: "Thanks, see you Tuesday.", html: "<p>Thanks</p>",
    in_reply_to: "<outbound-1@send.example.test>",
    references: ["<first@mail.example.test>", "outbound-1@send.example.test"],
    attachments: [
      { attachment_id: "att_1", size: 5, filename: "labs.pdf", content_type: "application/pdf", content_disposition: "attachment" },
      { attachment_id: "att_2", size: 12, content_type: "image/png; name=sig.png", content_disposition: "inline", content_id: "cid-1" },
    ],
    ...change,
  };
}

test("processor fetches the exact AgentMail message and normalizes it into the canonical inbound RPC", async () => {
  const event = await agentMailEvent();
  const db = worker(event);
  const requests: { url: string; init?: RequestInit }[] = [];
  const result = await processOneInbound(db, workerEnv, (async (url, init) => {
    requests.push({ url: String(url), init });
    return Response.json(providerMessage());
  }) as typeof fetch);
  assert.deepEqual(result, { processed: true });
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].url,
    "https://api.agentmail.to/v0/inboxes/inbox_synthetic/messages/%3Creply-1%40mail.example.test%3E",
  );
  assert.equal(new Headers(requests[0].init?.headers).get("Authorization"), "Bearer synthetic-agentmail-key");
  assert.equal(requests[0].init?.redirect, "error");
  const complete = db.calls.find((call) => call.name === "complete_inbound_communication")!.args!;
  assert.equal(complete.p_sender, "family@example.test");
  assert.equal(complete.p_recipient, "care@reply.example.test");
  assert.equal(complete.p_subject, "Visit follow-up");
  assert.equal(complete.p_body, "Thanks, see you Tuesday.");
  assert.equal(complete.p_rfc_message_id, messageId);
  assert.deepEqual(complete.p_reply_ids, [
    "<outbound-1@send.example.test>", "<first@mail.example.test>", "<outbound-1@send.example.test>",
  ]);
  assert.equal(complete.p_occurred_at, created);
  assert.deepEqual(complete.p_attachments, [
    { id: await agentMailAttachmentId(messageId, "att_1"), filename: "labs.pdf", content_type: "application/pdf", size: 5 },
    { id: await agentMailAttachmentId(messageId, "att_2"), filename: null, content_type: "image/png", size: 12 },
  ]);
  // Provider attachment ids, content ids and URLs never reach the database.
  assert.ok(!JSON.stringify(complete.p_attachments).includes("att_"));
  assert.ok(!JSON.stringify(complete.p_attachments).includes("cid-1"));
});

test("HTML-only AgentMail email keeps a visible placeholder and retains HTML for safe review", async () => {
  const db = worker(await agentMailEvent());
  await processOneInbound(db, workerEnv, (async () =>
    Response.json(providerMessage({ text: undefined, attachments: undefined, in_reply_to: undefined, references: undefined }))) as typeof fetch);
  const complete = db.calls.find((call) => call.name === "complete_inbound_communication")!.args!;
  assert.match(String(complete.p_body), /no plain-text body/);
  assert.equal(complete.p_html, "<p>Thanks</p>");
  assert.deepEqual(complete.p_reply_ids, []);
  assert.deepEqual(complete.p_attachments, []);
});

test("provider content that differs from the signed receipt is held for review", async () => {
  for (const change of [
    { message_id: "<other@mail.example.test>" },
    { inbox_id: "inbox_other" },
    { from: "attacker@example.test" },
    { attachments: [{ attachment_id: "att_1", size: -1 }] },
    { attachments: "not-a-list" },
  ]) {
    const db = worker(await agentMailEvent());
    const result = await processOneInbound(db, workerEnv, (async () => Response.json(providerMessage(change))) as typeof fetch);
    assert.deepEqual(result, { processed: false, retry_pending: false, review_required: true });
    assert.equal(db.calls.some((call) => call.name === "complete_inbound_communication"), false);
    assert.equal(db.calls.at(-1)?.args?.p_error, "provider_content_requires_review");
  }
});

test("receipt identity that does not match configuration is reviewed without any provider request", async () => {
  for (const metadata of [{ inbox_id: "inbox_other" }, { message_id: "<forged@mail.example.test>" }, { message_id: 7 }]) {
    const db = worker(await agentMailEvent(metadata));
    let fetched = 0;
    const result = await processOneInbound(db, workerEnv, (async () => { fetched++; return Response.json({}); }) as typeof fetch);
    assert.equal(fetched, 0);
    assert.equal(result.review_required, true);
  }
});

test("missing credentials and provider failures keep durable work pending for retry", async () => {
  const noKey = worker(await agentMailEvent());
  let fetched = 0;
  assert.deepEqual(
    await processOneInbound(noKey, { AGENTMAIL_INBOX_ID: env.AGENTMAIL_INBOX_ID }, (async () => { fetched++; return Response.json({}); }) as typeof fetch),
    { processed: false, retry_pending: true, review_required: false },
  );
  assert.equal(fetched, 0);
  for (const transport of [
    async () => new Response("rate limited", { status: 429, headers: { "retry-after": "1" } }),
    async () => new Response("missing", { status: 404 }),
    async () => { throw new Error("network down"); },
  ]) {
    const db = worker(await agentMailEvent());
    const result = await processOneInbound(db, workerEnv, transport as typeof fetch);
    assert.deepEqual(result, { processed: false, retry_pending: true, review_required: false });
    assert.equal(db.calls.at(-1)?.args?.p_error, "provider_fetch_or_persistence_retry");
  }
});

// Attachment capture: provider ids are re-derived from a fresh message GET.
async function captureFixture() {
  const emailId = await agentMailResourceId(env.AGENTMAIL_INBOX_ID, messageId);
  const expected = { id: await agentMailAttachmentId(messageId, "att_1"), filename: "labs.pdf", content_type: "application/pdf", size: 5 };
  return { emailId, expected, target: { emailId, providerMessageId: messageId, providerInboxId: env.AGENTMAIL_INBOX_ID } };
}
function attachmentTransport(options: {
  descriptor?: Record<string, unknown> | null;
  bytes?: BodyInit;
  bytesHeaders?: Record<string, string>;
  message?: Record<string, unknown>;
  failAt?: number;
} = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const transport = (async (url, init) => {
    calls.push({ url: String(url), init });
    if (options.failAt === calls.length) return new Response("unavailable", { status: 503 });
    if (calls.length === 1) return Response.json(providerMessage(options.message));
    if (calls.length === 2 && options.descriptor !== null) {
      return Response.json({
        attachment_id: "att_1", size: 5, filename: "labs.pdf", content_type: "application/pdf",
        download_url: "https://cdn.agentmail.example/att_1?signature=synthetic", expires_at: "2099-01-01T00:00:00Z",
        ...options.descriptor,
      });
    }
    return new Response(options.bytes ?? "%PDF-", { headers: { "content-type": "application/pdf", ...options.bytesHeaders } });
  }) as typeof fetch;
  return { calls, transport };
}

test("attachment capture authenticates API reads, downloads bytes without the API key and hashes content", async () => {
  const f = await captureFixture();
  const t = attachmentTransport();
  const result = await retrieveAgentMailAttachment(f.target, f.expected, workerEnv, t.transport);
  assert.equal(new TextDecoder().decode(result.bytes), "%PDF-");
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
  assert.equal(t.calls[1].url, "https://api.agentmail.to/v0/inboxes/inbox_synthetic/messages/%3Creply-1%40mail.example.test%3E/attachments/att_1");
  assert.equal(new Headers(t.calls[0].init?.headers).get("Authorization"), "Bearer synthetic-agentmail-key");
  assert.equal(new Headers(t.calls[1].init?.headers).get("Authorization"), "Bearer synthetic-agentmail-key");
  assert.equal(new Headers(t.calls[2].init?.headers).get("Authorization"), null);
  assert.equal(t.calls[2].init?.credentials, "omit");
  assert.ok(t.calls.every((call) => call.init?.redirect === "error"));
});

test("attachment endpoint returning raw bytes (as the Attachments guide describes) is also verified", async () => {
  const f = await captureFixture();
  const calls: string[] = [];
  const transport = (async (url) => {
    calls.push(String(url));
    return calls.length === 1 ? Response.json(providerMessage()) : new Response("%PDF-", { headers: { "content-type": "application/pdf" } });
  }) as typeof fetch;
  const result = await retrieveAgentMailAttachment(f.target, f.expected, workerEnv, transport);
  assert.equal(result.bytes.length, 5);
  assert.equal(calls.length, 2);
});

test("attachment fetch errors never return partial or unverified content", async () => {
  const f = await captureFixture();
  const failures: Parameters<typeof attachmentTransport>[0][] = [
    { failAt: 1 },
    { failAt: 2 },
    { failAt: 3 },
    { message: { attachments: [] } },
    { message: { attachments: [{ attachment_id: "att_1", size: 6, filename: "labs.pdf", content_type: "application/pdf" }] } },
    { message: { message_id: "<other@mail.example.test>" } },
    { descriptor: { expires_at: "2000-01-01T00:00:00Z" } },
    { descriptor: { size: 6 } },
    { descriptor: { attachment_id: "att_other" } },
    { descriptor: { download_url: "http://cdn.agentmail.example/att_1" } },
    { descriptor: { download_url: "https://user:pass@cdn.agentmail.example/att_1" } },
    { descriptor: { download_url: "https://127.0.0.1/att_1" } },
    { descriptor: { download_url: "https://localhost/att_1" } },
    { descriptor: { download_url: "https://cdn.agentmail.example:8443/att_1" } },
    { bytes: "%PDF" },
    { bytes: "<html" },
    { bytesHeaders: { "content-type": "text/html" } },
    { bytesHeaders: { "content-length": "6" } },
  ];
  for (const options of failures) {
    const t = attachmentTransport(options);
    await assert.rejects(retrieveAgentMailAttachment(f.target, f.expected, workerEnv, t.transport));
  }
});

test("attachment capture refuses mismatched lease identity or configuration without network calls", async () => {
  const f = await captureFixture();
  for (const [target, expected, environment] of [
    [{ ...f.target, emailId: "11111111-1111-4111-8111-111111111111" }, f.expected, workerEnv],
    [{ ...f.target, providerInboxId: "inbox_other" }, f.expected, workerEnv],
    [{ ...f.target, providerMessageId: null }, f.expected, workerEnv],
    [f.target, f.expected, { ...workerEnv, AGENTMAIL_API_KEY: "" }],
    [f.target, f.expected, { ...workerEnv, AGENTMAIL_INBOX_ID: "inbox_other" }],
    [f.target, { ...f.expected, content_type: "text/html" }, workerEnv],
    [f.target, { ...f.expected, size: 10485761 }, workerEnv],
  ] as const) {
    const t = attachmentTransport();
    await assert.rejects(retrieveAgentMailAttachment(target, expected, environment, t.transport));
    assert.equal(t.calls.length, 0);
  }
});
