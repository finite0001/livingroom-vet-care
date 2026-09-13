import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  materializePaymentAccess,
  paymentAccessConfig,
  type PaymentAccessGrant,
} from "../../supabase/functions/_shared/payment-access-capability.ts";
import {
  materializePaymentDelivery,
  type PaymentDeliveryContext,
} from "../../supabase/functions/_shared/payment-delivery-payload.ts";
const hash = (v: string) => createHash("sha256").update(v).digest("hex");
const config = paymentAccessConfig({
  origin: "https://thelivingroom.vet",
  activeKeyVersion: "one",
  keys: JSON.stringify({ one: btoa("k".repeat(32)) }),
  collectionEnabled: "true",
  statusEnabled: "true",
});
const grant: PaymentAccessGrant = {
  id: "10000000-0000-4000-8000-000000000001",
  actor_id: "10000000-0000-4000-8000-000000000002",
  invoice_id: "10000000-0000-4000-8000-000000000003",
  client_id: "10000000-0000-4000-8000-000000000004",
  amount_cents: "12500",
  currency: "usd",
  source_hash: "a".repeat(64),
  created_at: "2026-09-13T00:00:00Z",
  expires_at: "2026-09-20T00:00:00Z",
  status_expires_at: "2026-10-20T00:00:00Z",
  origin: config.origin,
  key_version: "one",
  capability_context: "",
  context_hash: "",
};
grant.capability_context = JSON.stringify({
  domain: "lrv-payment-collection/v2",
  context_version: 2,
  origin: grant.origin,
  key_version: grant.key_version,
  grant: { ...grant },
});
grant.context_hash = hash(grant.capability_context);
const emailSender = {
  from: "Living Room Vet <billing@thelivingroom.vet>",
  reply_to: "care@thelivingroom.vet",
};
const smsSender = { from: "+13035550101", account_sid: "AC" + "a".repeat(32) };
async function fixture(
  channel: "EMAIL" | "SMS" = "EMAIL",
): Promise<PaymentDeliveryContext> {
  const access = await materializePaymentAccess(grant, config);
  return {
    request: {
      grant_id: grant.id,
      actor_id: grant.actor_id,
      invoice_id: grant.invoice_id,
      client_id: grant.client_id,
      amount_cents: grant.amount_cents,
      source_hash: grant.source_hash,
      channel,
      recipient: channel === "EMAIL" ? "client@example.com" : "+13035550102",
      subject: channel === "EMAIL" ? "Your invoice" : "",
      body_template: "Review your invoice and pay: {{payment_link}}",
      invoice_email_request_id: null,
      invoice_payload_hash: null,
    },
    grant,
    capability: {
      ...grant,
      grant_id: grant.id,
      context_version: 2,
      collection_token_hash: access.collection_token_hash,
      status_token_hash: access.status_token_hash,
    },
    invoice_payload_text: null,
  };
}
test("payment delivery reproduces exact reviewed email and SMS transport bytes", async () => {
  for (const channel of ["EMAIL", "SMS"] as const) {
    const context = await fixture(channel),
      before = JSON.stringify(context),
      sender = channel === "EMAIL" ? emailSender : smsSender;
    const a = await materializePaymentDelivery(context, config, sender),
      b = await materializePaymentDelivery(context, config, sender);
    assert.deepEqual(a, b);
    assert.equal(JSON.stringify(context), before);
    assert.equal(a.payload_hash, hash(a.payload_text));
    assert.equal(a.message_hash, hash(a.message));
    assert.match(a.message, /#p1\.[A-Za-z0-9_-]{43}$/);
    assert.doesNotMatch(before, /p1\.[A-Za-z0-9_-]{43}/);
    assert.equal(
      channel === "EMAIL"
        ? JSON.parse(a.payload_text).text
        : new URLSearchParams(a.payload_text).get("Body"),
      a.message,
    );
  }
});
test("payment delivery rejects changed financial scope, capture, templates and disabled access", async () => {
  const context = await fixture();
  for (
    const patch of [
      { amount_cents: "12501" },
      { actor_id: grant.id },
      { source_hash: "b".repeat(64) },
      { body_template: "{{payment_link}} {{payment_link}}" },
      { body_template: "No link" },
      { subject: "{{payment_link}}" },
    ]
  ) {
    await assert.rejects(
      materializePaymentDelivery(
        { ...context, request: { ...context.request, ...patch } },
        config,
        emailSender,
      ),
    );
  }
  await assert.rejects(
    materializePaymentDelivery(
      {
        ...context,
        capability: {
          ...context.capability,
          collection_token_hash: "a".repeat(64),
        },
      },
      config,
      emailSender,
    ),
  );
  await assert.rejects(
    materializePaymentDelivery(
      context,
      { ...config, collectionEnabled: false },
      emailSender,
    ),
  );
  await assert.rejects(
    materializePaymentDelivery(
      context,
      { ...config, statusEnabled: false },
      emailSender,
    ),
  );
  const changed = await materializePaymentDelivery(
    {
      ...context,
      request: { ...context.request, recipient: "other@example.com" },
    },
    config,
    emailSender,
  );
  assert.notEqual(
    changed.payload_hash,
    (await materializePaymentDelivery(context, config, emailSender))
      .payload_hash,
  );
});
test("optional invoice attachment preserves frozen bytes and validates original reviewed payload", async () => {
  const context = await fixture();
  context.request.invoice_email_request_id = grant.id;
  const payload = {
    ...emailSender,
    to: [context.request.recipient],
    subject: context.request.subject,
    text: context.request.body_template,
    attachments: [{
      filename: "invoice.html",
      content_type: "text/html",
      content: btoa("<html>Reviewed invoice</html>"),
    }],
  };
  context.invoice_payload_text = JSON.stringify(payload, null, 2);
  context.request.invoice_payload_hash = hash(context.invoice_payload_text);
  const result = await materializePaymentDelivery(context, config, emailSender);
  assert.deepEqual(
    JSON.parse(result.payload_text).attachments,
    payload.attachments,
  );
  await assert.rejects(
    materializePaymentDelivery(
      { ...context, invoice_payload_text: context.invoice_payload_text + " " },
      config,
      emailSender,
    ),
  );
  await assert.rejects(
    materializePaymentDelivery(context, config, {
      ...emailSender,
      reply_to: "changed@example.com",
    }),
  );
  payload.attachments[0].content = btoa("p1." + "a".repeat(43));
  context.invoice_payload_text = JSON.stringify(payload);
  context.request.invoice_payload_hash = hash(context.invoice_payload_text);
  await assert.rejects(
    materializePaymentDelivery(context, config, emailSender),
  );
});
test("SMS rejects expanded oversize messages and attachment context", async () => {
  const context = await fixture("SMS");
  await assert.rejects(
    materializePaymentDelivery(
      {
        ...context,
        request: {
          ...context.request,
          body_template: "x".repeat(1500) + "{{payment_link}}",
        },
      },
      config,
      smsSender,
    ),
  );
  await assert.rejects(
    materializePaymentDelivery(
      { ...context, invoice_payload_text: "{}" },
      config,
      smsSender,
    ),
  );
  await assert.rejects(
    materializePaymentDelivery(context, config, {
      ...smsSender,
      extra: "changed",
    }),
  );
});

import {
  dispatchOne,
  type OutboxEnvironment,
} from "../../supabase/functions/_shared/outbox-dispatch.ts";
async function workerFixture(channel: "EMAIL" | "SMS" = "EMAIL") {
  const context = await fixture(channel),
    sender = channel === "EMAIL" ? emailSender : smsSender;
  const materialized = await materializePaymentDelivery(
    context,
    config,
    sender,
  );
  const row = {
    id: grant.id,
    lease_token: grant.actor_id,
    channel,
    recipient: context.request.recipient,
    subject: context.request.subject,
    body: context.request.body_template,
    provider: channel === "EMAIL" ? "resend" : "twilio",
    state: "claimed",
    provider_config: null,
  };
  const captured = {
    ...context,
    capture: {
      sender_config: sender,
      message_hash: materialized.message_hash,
      payload_hash: materialized.payload_hash,
    },
  };
  const calls: Array<{ name: string; args?: Record<string, unknown> }> = [],
    transports: RequestInit[] = [];
  const env: OutboxEnvironment = {
    APP_ENV: "staging",
    OUTBOUND_DELIVERY_MODE: "test",
    OUTBOUND_TEST_EMAILS: "client@example.com",
    OUTBOUND_TEST_PHONES: "+13035550102",
    RESEND_API_KEY: "fixture",
    RESEND_FROM: emailSender.from,
    RESEND_REPLY_TO: emailSender.reply_to,
    TWILIO_ACCOUNT_SID: smsSender.account_sid,
    TWILIO_AUTH_TOKEN: "fixture",
    TWILIO_FROM_NUMBER: smsSender.from,
    PAYMENT_DELIVERY_ENABLED: "true",
    PAYMENT_ACCESS_ORIGIN: config.origin,
    PAYMENT_ACCESS_ACTIVE_KEY_VERSION: config.activeKeyVersion,
    PAYMENT_ACCESS_KEYS: JSON.stringify(config.keys),
    PAYMENT_COLLECTION_ENABLED: "true",
    PAYMENT_STATUS_ENABLED: "true",
  };
  let finalAllowed = true;
  const db = {
    rpc: async (name: string, args?: Record<string, unknown>) => {
      calls.push({ name, args });
      return {
        data: name === "claim_communication"
          ? row
          : name === "payment_delivery_context"
          ? captured
          : name === "start_communication_attempt"
          ? { ...row, state: finalAllowed ? "claimed" : "failed" }
          : null,
        error: null,
      };
    },
  };
  const transport = (async (_input: unknown, init: RequestInit) => {
    transports.push(init);
    return new Response(
      JSON.stringify(
        channel === "EMAIL" ? { id: grant.id } : { sid: "SM" + "a".repeat(32) },
      ),
      { status: 200 },
    );
  }) as typeof fetch;
  return {
    captured,
    materialized,
    calls,
    transports,
    env,
    db,
    transport,
    block: () => {
      finalAllowed = false;
    },
  };
}
test("worker sends reviewed payment bytes and only hash proof enters database calls", async () => {
  for (const channel of ["EMAIL", "SMS"] as const) {
    const f = await workerFixture(channel);
    await dispatchOne(f.db, f.env, f.transport);
    assert.equal(f.transports.length, 1);
    assert.equal(f.transports[0].body, f.materialized.payload_text);
    const start = f.calls.find((c) =>
      c.name === "start_communication_attempt"
    )!;
    assert.equal(
      (start.args!.p_provider_config as Record<string, string>)
        .payment_delivery_payload_hash,
      f.materialized.payload_hash,
    );
    assert.doesNotMatch(JSON.stringify(f.calls), /p1\.[A-Za-z0-9_-]{43}/);
  }
});
test("worker refuses changed review, disabled access and final database rejection before transport", async () => {
  for (
    const change of ["hash", "recipient", "sender", "key", "disabled", "final"]
  ) {
    const f = await workerFixture();
    if (change === "hash") f.captured.capture.payload_hash = "0".repeat(64);
    if (change === "recipient") {
      f.captured.request.recipient = "other@example.com";
    }
    if (change === "sender") f.env.RESEND_REPLY_TO = "changed@example.com";
    if (change === "key") {
      f.env.PAYMENT_ACCESS_KEYS = JSON.stringify({ one: btoa("z".repeat(32)) });
    }
    if (change === "disabled") f.env.PAYMENT_COLLECTION_ENABLED = "false";
    if (change === "final") f.block();
    await dispatchOne(f.db, f.env, f.transport);
    assert.equal(f.transports.length, 0, change);
  }
});
