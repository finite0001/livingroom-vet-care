import { test } from "node:test";
import assert from "node:assert/strict";
import {
  receiveResend,
  receiveTwilio,
  type ProviderEvent,
} from "../../supabase/functions/_shared/inbound/handlers.ts";
import { processOneInbound } from "../../supabase/functions/_shared/inbound/process.ts";
const id = "11111111-1111-4111-8111-111111111111";
function dbFixture(event?: ProviderEvent) {
  const calls: { name: string; args?: Record<string, unknown> }[] = [];
  const db = {
    rpc: async (name: string, args?: Record<string, unknown>) => {
      calls.push({ name, args });
      return {
        data: name === "claim_communication_event" ? event : { id: "event" },
        error: null,
      };
    },
  };
  return { db, calls };
}
test("invalid Resend proof causes no durable writes", async () => {
  const f = dbFixture();
  await assert.rejects(
    receiveResend(
      new Request("https://hook.test", { method: "POST", body: "{}" }),
      f.db,
      {},
      () => {
        throw new Error("forged");
      },
    ),
  );
  assert.equal(f.calls.length, 0);
});
test("signed Resend metadata is stored before body retrieval and unknown receipt retries", async () => {
  const f = dbFixture();
  const event = {
    type: "email.received",
    created_at: new Date().toISOString(),
    data: {
      email_id: id,
      from: "Family <family@example.test>",
      to: ["care@example.test"],
    },
  };
  const request = () =>
    new Request("https://hook.test", {
      method: "POST",
      body: JSON.stringify(event),
      headers: {
        "svix-id": "signed-event",
        "svix-timestamp": "timestamp",
        "svix-signature": "signature",
      },
    });
  await receiveResend(
    request(),
    f.db,
    { RESEND_INBOUND_ADDRESSES: "care@example.test" },
    () => event,
  );
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].name, "receive_communication_event");
  assert.deepEqual(f.calls[0].args?.p_metadata, {
    from: "family@example.test",
    to: "care@example.test",
    created_at: event.created_at,
  });
  await assert.rejects(
    receiveResend(
      request(),
      { rpc: async () => ({ data: null, error: { code: "23503" } }) },
      { RESEND_INBOUND_ADDRESSES: "care@example.test" },
      () => event,
    ),
    /retry required/,
  );
});
test("invalid Twilio account cannot produce durable receipt even with validated proof", async () => {
  const f = dbFixture();
  await assert.rejects(
    receiveTwilio(
      new Request("https://hook.test/sms", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Twilio-Signature": "proof",
        },
        body: "",
      }),
      f.db,
      {
        TWILIO_WEBHOOK_URL: "https://hook.test/sms",
        TWILIO_ACCOUNT_SID: "ACexpected",
      },
      () => true,
    ),
    /account/,
  );
  assert.equal(f.calls.length, 0);
});
test("body fetch failure keeps durable event pending without creating a partial inbox message", async () => {
  const event: ProviderEvent = {
    id: "event",
    provider: "resend",
    event_type: "inbound",
    resource_id: id,
    lease_token: "lease",
    metadata: { from: "family@example.test", to: "care@example.test" },
  };
  const f = dbFixture(event);
  const result = await processOneInbound(
    f.db,
    { RESEND_API_KEY: "synthetic" },
    (async () => {
      throw new Error("connection lost");
    }) as typeof fetch,
  );
  assert.equal(result.retry_pending, true);
  assert.deepEqual(
    f.calls.map((call) => call.name),
    ["claim_communication_event", "release_communication_event"],
  );
  assert.equal(f.calls.at(-1)?.args?.p_review, false);
});
test("receiving API uses fixed URL, blocks redirects and only retains attachment metadata", async () => {
  const event: ProviderEvent = {
    id: "event",
    provider: "resend",
    event_type: "inbound",
    resource_id: id,
    lease_token: "lease",
    metadata: { from: "family@example.test", to: "care@example.test" },
  };
  const f = dbFixture(event);
  let requests = 0;
  await processOneInbound(f.db, { RESEND_API_KEY: "synthetic" }, (async (
    url,
    init,
  ) => {
    requests++;
    assert.equal(url, `https://api.resend.com/emails/receiving/${id}`);
    assert.equal(init?.redirect, "error");
    return new Response(
      JSON.stringify({
        id,
        from: "family@example.test",
        to: ["care@example.test"],
        text: "Visit reply",
        html: "<script>untrusted</script>",
        subject: "Reply",
        created_at: "2026-09-12T15:00:00Z",
        message_id: "<reply@example.test>",
        headers: { "In-Reply-To": "<original@example.test>" },
        attachments: [
          {
            id: "attachment",
            filename: "result.pdf",
            content_type: "application/pdf",
            size: 42,
            download_url: "https://evil.test",
          },
        ],
      }),
    );
  }) as typeof fetch);
  assert.equal(requests, 1);
  const completed = f.calls.find(
    (call) => call.name === "complete_inbound_communication",
  )!;
  assert.deepEqual(completed.args?.p_reply_ids, ["<original@example.test>"]);
  assert.deepEqual(completed.args?.p_attachments, [
    {
      id: "attachment",
      filename: "result.pdf",
      content_type: "application/pdf",
      size: 42,
    },
  ]);
  assert.equal(completed.args?.p_html, "<script>untrusted</script>");
});
test("provider content inconsistent with signed sender is held for review", async () => {
  const event: ProviderEvent = {
    id: "event",
    provider: "resend",
    event_type: "inbound",
    resource_id: id,
    lease_token: "lease",
    metadata: { from: "family@example.test", to: "care@example.test" },
  };
  const f = dbFixture(event);
  const result = await processOneInbound(
    f.db,
    { RESEND_API_KEY: "synthetic" },
    (async () =>
      new Response(
        JSON.stringify({
          id,
          from: "different@example.test",
          to: ["care@example.test"],
        }),
      )) as typeof fetch,
  );
  assert.equal(result.review_required, true);
  assert.equal(f.calls.at(-1)?.args?.p_review, true);
  assert.equal(
    f.calls.some((call) => call.name === "complete_inbound_communication"),
    false,
  );
});
test("status events are completed locally without another provider request", async () => {
  const f = dbFixture({
    id: "event",
    provider: "resend",
    event_type: "sent",
    resource_id: id,
    lease_token: "lease",
    metadata: {},
  });
  await processOneInbound(f.db, {}, (async () => {
    throw new Error("must not fetch");
  }) as typeof fetch);
  assert.deepEqual(
    f.calls.map((call) => call.name),
    ["claim_communication_event", "complete_communication_status"],
  );
});
