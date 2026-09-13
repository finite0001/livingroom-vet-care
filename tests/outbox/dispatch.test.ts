import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dispatchOne,
  type OutboxRow,
  type OutboxEnvironment,
} from "../../supabase/functions/_shared/outbox-dispatch.ts";
const emailId = "12345678-1234-4234-8234-123456789012";
function fixture(channel: "EMAIL" | "SMS" = "EMAIL") {
  const row: OutboxRow = {
    id: emailId,
    channel,
    recipient: channel === "EMAIL" ? "client@example.test" : "+13035550100",
    subject: "Visit summary",
    body: "Synthetic message",
    provider: channel === "EMAIL" ? "resend" : "twilio",
    state: "claimed",
    lease_token: "lease",
    provider_config: null,
  };
  const calls: { name: string; args?: Record<string, unknown> }[] = [];
  const requests: RequestInit[] = [];
  const env: OutboxEnvironment = {
    APP_ENV: "staging",
    OUTBOUND_DELIVERY_MODE: "test",
    OUTBOUND_TEST_EMAILS: "client@example.test",
    OUTBOUND_TEST_PHONES: "+13035550100",
    RESEND_API_KEY: "synthetic",
    RESEND_FROM: "care@example.test",
    RESEND_REPLY_TO: "care@example.test",
    TWILIO_ACCOUNT_SID: `AC${"a".repeat(32)}`,
    TWILIO_AUTH_TOKEN: "synthetic",
    TWILIO_FROM_NUMBER: "+13035550199",
  };
  let startState = "claimed";
  let failFinish = false;
  const db = {
    rpc: async (name: string, args?: Record<string, unknown>) => {
      calls.push({ name, args });
      return {
        data:
          ["read_frozen_email_payload", "document_link_delivery_context"].includes(name)
            ? null
            : name === "claim_communication"
              ? row
              : { ...row, state: startState },
        error:
          name === "finish_communication_attempt" && failFinish
            ? new Error("persistence failed")
            : null,
      };
    },
  };
  const transport = (async (
    _url: string | URL | Request,
    init?: RequestInit,
  ) => {
    requests.push(init!);
    return new Response(
      JSON.stringify(
        channel === "EMAIL" ? { id: emailId } : { sid: `SM${"b".repeat(32)}` },
      ),
      { status: 202 },
    );
  }) as typeof fetch;
  return {
    row,
    calls,
    requests,
    env,
    db,
    transport,
    setStartState: (state: string) => {
      startState = state;
    },
    failFinish: () => {
      failFinish = true;
    },
  };
}
test("disabled outbox does not claim or make provider requests", async () => {
  const f = fixture();
  f.env.OUTBOUND_DELIVERY_MODE = "disabled";
  assert.deepEqual(await dispatchOne(f.db, f.env, f.transport), {
    processed: false,
    disabled: true,
  });
  assert.equal(f.calls.length, 0);
  assert.equal(f.requests.length, 0);
});
test("test recipient restriction releases claim before any attempt or provider call", async () => {
  const f = fixture();
  f.env.OUTBOUND_TEST_EMAILS = "other@example.test";
  await dispatchOne(f.db, f.env, f.transport);
  assert.deepEqual(
    f.calls.map((c) => c.name),
    ["claim_communication", "release_communication_claim"],
  );
  assert.equal(f.requests.length, 0);
});
test("sender metadata changes cannot silently alter idempotent request payload", async () => {
  const f = fixture();
  f.row.provider_config = {
    from: "old@example.test",
    reply_to: "old@example.test",
  };
  await dispatchOne(f.db, f.env, f.transport);
  assert.equal(f.requests.length, 0);
  assert.equal(f.calls.at(-1)?.name, "release_communication_claim");
});
test("email provider acceptance is distinct from delivery and has stable idempotency key", async () => {
  const f = fixture();
  const result = await dispatchOne(f.db, f.env, f.transport);
  assert.equal(result.state, "accepted");
  assert.equal(result.delivered, false);
  assert.equal(
    new Headers(f.requests[0].headers).get("Idempotency-Key"),
    `livingroom-outbox/${emailId}`,
  );
  assert.deepEqual(
    f.calls.map((c) => c.name),
    [
      "claim_communication",
      "read_frozen_email_payload",
      "start_communication_attempt",
      "finish_communication_attempt",
    ],
  );
  assert.equal(f.calls.at(-1)?.args?.p_provider_message_id, emailId);
});
test("SMS suppression detected immediately before attempt prevents provider request", async () => {
  const f = fixture("SMS");
  f.setStartState("failed");
  const result = await dispatchOne(f.db, f.env, f.transport);
  assert.equal(result.state, "failed");
  assert.equal(f.requests.length, 0);
});
test("SMS transport uncertainty is recorded exactly once and never automatically retried", async () => {
  const f = fixture("SMS");
  let requests = 0;
  const transport = (async () => {
    requests++;
    throw new Error("private provider detail");
  }) as typeof fetch;
  const result = await dispatchOne(f.db, f.env, transport);
  assert.equal(result.state, "uncertain");
  assert.equal(requests, 1);
  assert.equal(
    f.calls.at(-1)?.args?.p_error_code,
    "provider_transport_unknown",
  );
});
for (const [status, state] of [
  [400, "failed"],
  [429, "failed"],
  [503, "uncertain"],
  [409, "uncertain"],
  [408, "uncertain"],
] as const)
  test(`provider HTTP ${status} becomes ${state}`, async () => {
    const f = fixture();
    await dispatchOne(
      f.db,
      f.env,
      (async () =>
        new Response("private response body", { status })) as typeof fetch,
    );
    assert.equal(f.calls.at(-1)?.args?.p_outcome, state);
    assert.equal(f.calls.at(-1)?.args?.p_error_code, `provider_http_${status}`);
  });
test("provider successful response without receipt identifier remains uncertain", async () => {
  const f = fixture();
  await dispatchOne(
    f.db,
    f.env,
    (async () => new Response("{}", { status: 200 })) as typeof fetch,
  );
  assert.equal(f.calls.at(-1)?.args?.p_outcome, "uncertain");
});
test("provider acceptance followed by persistence failure never triggers another send", async () => {
  const f = fixture();
  f.failFinish();
  await assert.rejects(
    dispatchOne(f.db, f.env, f.transport),
    /persistence failed/,
  );
  assert.equal(f.requests.length, 1);
});

test("provider redirects cannot forward message data and remain uncertain", async () => {
  const f = fixture();
  const transport = (async (
    _url: string | URL | Request,
    init?: RequestInit,
  ) => {
    assert.equal(init?.redirect, "error");
    throw new TypeError("Redirect blocked");
  }) as typeof fetch;
  const result = await dispatchOne(f.db, f.env, transport);
  assert.equal(result.state, "uncertain");
  assert.equal(
    f.calls.at(-1)?.args?.p_error_code,
    "provider_transport_unknown",
  );
});
