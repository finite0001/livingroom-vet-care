import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyCloudTalkSmsResponse,
  CLOUDTALK_SMS_ENDPOINT,
  cloudTalkSmsConfig,
  selectSmsProvider,
  SmsProviderConfigurationError,
} from "../../supabase/functions/_shared/cloudtalk-sms.ts";
import {
  dispatchOne,
  type OutboxEnvironment,
  type OutboxRow,
} from "../../supabase/functions/_shared/outbox-dispatch.ts";
import {
  dispatchOutboundSms,
  type OutboundSmsEnvironment,
  type OutboundSmsResult,
} from "../../supabase/functions/_shared/outbound-delivery-sms.ts";

const practice = "+17207646677";
const client = "+13035550100";
const rowId = "12345678-1234-4234-8234-123456789012";
const ok = (success: unknown = true, data: unknown = {}) =>
  new Response(JSON.stringify({ responseData: { success, data } }), { status: 200 });
const status = (code: number) =>
  new Response(JSON.stringify({ responseData: { status: code, message: "x" } }), { status: code });

function cloudTalkEnv(): OutboxEnvironment {
  return {
    APP_ENV: "staging",
    OUTBOUND_DELIVERY_MODE: "test",
    OUTBOUND_TEST_PHONES: client,
    CLOUDTALK_API_KEY_ID: "synthetic-id",
    CLOUDTALK_API_KEY_SECRET: "synthetic-secret",
    CLOUDTALK_ALLOWED_NUMBERS: practice,
    // Present to prove it is never used while CloudTalk is selected.
    TWILIO_ACCOUNT_SID: `AC${"a".repeat(32)}`,
    TWILIO_AUTH_TOKEN: "synthetic",
    TWILIO_FROM_NUMBER: "+13035550199",
  };
}

function outboxFixture(responder: () => Promise<Response> | Response = () => ok()) {
  const row: OutboxRow = {
    id: rowId,
    channel: "SMS",
    recipient: client,
    subject: "",
    body: "Synthetic CloudTalk reminder",
    provider: "cloudtalk",
    state: "claimed",
    lease_token: "lease",
    provider_config: null,
  };
  const calls: { name: string; args?: Record<string, unknown> }[] = [];
  const requests: { url: string; init: RequestInit }[] = [];
  let startState = "claimed";
  const db = {
    rpc: async (name: string, args?: Record<string, unknown>) => {
      calls.push({ name, args });
      return {
        data: ["read_frozen_email_payload", "document_link_delivery_context", "payment_delivery_context"].includes(name)
          ? null
          : name === "claim_communication"
          ? row
          : { ...row, state: startState },
        error: null,
      };
    },
  };
  const transport = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init: init! });
    return await responder();
  }) as typeof fetch;
  return {
    row,
    calls,
    requests,
    db,
    transport,
    env: cloudTalkEnv(),
    setStartState: (value: string) => {
      startState = value;
    },
    finish: () => calls.find((c) => c.name === "finish_communication_attempt")?.args,
    release: () => calls.find((c) => c.name === "release_communication_claim")?.args,
  };
}

test("SMS_PROVIDER defaults to CloudTalk and rejects every other value", () => {
  assert.equal(selectSmsProvider(undefined), "cloudtalk");
  assert.equal(selectSmsProvider("cloudtalk"), "cloudtalk");
  assert.equal(selectSmsProvider("twilio"), "twilio");
  for (const bad of ["", " ", "Twilio", "CLOUDTALK", "resend", "cloudtalk "]) {
    assert.throws(() => selectSmsProvider(bad), SmsProviderConfigurationError);
  }
});

test("CloudTalk sender must be an allowed practice number", () => {
  const base = { CLOUDTALK_API_KEY_ID: "id", CLOUDTALK_API_KEY_SECRET: "secret" };
  assert.equal(cloudTalkSmsConfig({ ...base, CLOUDTALK_ALLOWED_NUMBERS: practice }).from, practice);
  assert.equal(
    cloudTalkSmsConfig({ ...base, CLOUDTALK_ALLOWED_NUMBERS: `${practice},+13035550111`, CLOUDTALK_SMS_SENDER: practice }).from,
    practice,
  );
  for (const env of [
    { ...base, CLOUDTALK_ALLOWED_NUMBERS: `${practice},+13035550111` }, // ambiguous without explicit sender
    { ...base, CLOUDTALK_ALLOWED_NUMBERS: practice, CLOUDTALK_SMS_SENDER: "+13035550111" }, // not allowed
    { ...base, CLOUDTALK_ALLOWED_NUMBERS: practice, CLOUDTALK_SMS_SENDER: "+1 720 764 6677" }, // not exact
    { ...base, CLOUDTALK_ALLOWED_NUMBERS: "7207646677" }, // not E.164
    { ...base, CLOUDTALK_ALLOWED_NUMBERS: "" },
    { CLOUDTALK_API_KEY_ID: "id", CLOUDTALK_ALLOWED_NUMBERS: practice }, // no secret
    { CLOUDTALK_API_KEY_ID: "id:x", CLOUDTALK_API_KEY_SECRET: "s", CLOUDTALK_ALLOWED_NUMBERS: practice },
  ]) {
    assert.throws(() => cloudTalkSmsConfig(env), SmsProviderConfigurationError);
  }
});

test("CloudTalk responses map to accepted, rejected, retryable and ambiguous outcomes", async () => {
  assert.deepEqual(await classifyCloudTalkSmsResponse(ok()), { kind: "accepted", reference: null });
  assert.deepEqual(await classifyCloudTalkSmsResponse(ok("true", { id: 987654 })), { kind: "accepted", reference: "987654" });
  assert.deepEqual(await classifyCloudTalkSmsResponse(ok(false, "Limit exceeded")), {
    kind: "rejected",
    retryable: true,
    code: "cloudtalk_limit_exceeded",
  });
  assert.deepEqual(await classifyCloudTalkSmsResponse(ok(false, "Unknown number")), {
    kind: "rejected",
    retryable: false,
    code: "cloudtalk_unknown_number",
  });
  assert.deepEqual(await classifyCloudTalkSmsResponse(ok(false, "private carrier detail")), {
    kind: "rejected",
    retryable: false,
    code: "cloudtalk_rejected",
  });
  for (const code of [400, 401, 403, 404, 406]) {
    assert.deepEqual(await classifyCloudTalkSmsResponse(status(code)), {
      kind: "rejected",
      retryable: false,
      code: `cloudtalk_http_${code}`,
    });
  }
  assert.deepEqual(await classifyCloudTalkSmsResponse(status(429)), { kind: "rejected", retryable: true, code: "cloudtalk_http_429" });
  for (const code of [408, 409, 500, 502, 503]) {
    assert.equal((await classifyCloudTalkSmsResponse(status(code))).kind, "ambiguous");
  }
  assert.equal((await classifyCloudTalkSmsResponse(new Response("<html>", { status: 200 }))).kind, "ambiguous");
  assert.equal((await classifyCloudTalkSmsResponse(new Response("{}", { status: 200 }))).kind, "ambiguous");
  assert.equal((await classifyCloudTalkSmsResponse(new Response(null, { status: 202 }))).kind, "ambiguous");
});

test("outbox sends one exact CloudTalk request and never calls Twilio", async () => {
  const f = outboxFixture();
  const result = await dispatchOne(f.db, f.env, f.transport);
  assert.equal(result.state, "accepted");
  assert.equal(result.delivered, false);
  assert.equal(f.requests.length, 1);
  const [{ url, init }] = f.requests;
  assert.equal(url, CLOUDTALK_SMS_ENDPOINT);
  assert.ok(!url.includes("twilio"));
  const headers = new Headers(init.headers);
  assert.equal(headers.get("Authorization"), `Basic ${btoa("synthetic-id:synthetic-secret")}`);
  assert.equal(headers.get("Content-Type"), "application/json");
  assert.ok(headers.get("User-Agent"));
  assert.equal(init.redirect, "error");
  assert.deepEqual(JSON.parse(String(init.body)), { recipient: client, message: f.row.body, sender: practice });
  const start = f.calls.find((c) => c.name === "start_communication_attempt")!.args!;
  assert.deepEqual(start.p_provider_config, { from: practice, provider: "cloudtalk" });
  assert.equal(f.finish()?.p_outcome, "accepted");
  assert.equal(f.finish()?.p_provider_message_id, `local-accepted:${rowId}`);
  // Credentials never reach the database.
  assert.doesNotMatch(JSON.stringify(f.calls), /synthetic-secret|synthetic-id/);
});

test("CloudTalk 4xx and success:false are permanent failures, 5xx and timeouts are uncertain", async () => {
  for (const [responder, outcome, code] of [
    [() => status(400), "failed", "cloudtalk_http_400"],
    [() => status(403), "failed", "cloudtalk_http_403"],
    [() => status(429), "failed", "cloudtalk_http_429"],
    [() => ok(false, "Not allowed country."), "failed", "cloudtalk_country_not_allowed"],
    [() => status(500), "uncertain", "cloudtalk_http_500"],
    [() => new Response("not json", { status: 200 }), "uncertain", "cloudtalk_response_unreadable"],
    [() => {
      throw new DOMException("timed out", "TimeoutError");
    }, "uncertain", "provider_transport_unknown"],
  ] as const) {
    const f = outboxFixture(responder);
    const result = await dispatchOne(f.db, f.env, f.transport);
    assert.equal(result.state, outcome);
    assert.equal(f.requests.length, 1, "exactly one provider request, never an automatic resend");
    assert.equal(f.finish()?.p_outcome, outcome);
    assert.equal(f.finish()?.p_provider_message_id, null);
    assert.equal(f.finish()?.p_error_code, code);
  }
});

test("opt-out or consent loss found by the final database check prevents the CloudTalk request", async () => {
  const f = outboxFixture();
  f.setStartState("failed");
  const result = await dispatchOne(f.db, f.env, f.transport);
  assert.equal(result.state, "failed");
  assert.equal(f.requests.length, 0);
  assert.equal(f.finish(), undefined);
});

test("unknown SMS_PROVIDER fails closed before any claim", async () => {
  const f = outboxFixture();
  f.env.SMS_PROVIDER = "twillio";
  await assert.rejects(dispatchOne(f.db, f.env, f.transport), SmsProviderConfigurationError);
  assert.equal(f.calls.length, 0);
  assert.equal(f.requests.length, 0);
});

test("a row queued for another provider is released, never re-routed", async () => {
  const f = outboxFixture();
  f.row.provider = "twilio";
  await dispatchOne(f.db, f.env, f.transport);
  assert.equal(f.requests.length, 0);
  assert.equal(f.release()?.p_error_code, "sms_provider_mismatch");
  const g = outboxFixture();
  g.env.SMS_PROVIDER = "twilio";
  await dispatchOne(g.db, g.env, g.transport);
  assert.equal(g.requests.length, 0);
  assert.equal(g.release()?.p_error_code, "sms_provider_mismatch");
});

test("missing CloudTalk credentials or a disallowed sender release the claim without a request", async () => {
  for (const change of [
    (env: OutboxEnvironment) => delete env.CLOUDTALK_API_KEY_SECRET,
    (env: OutboxEnvironment) => (env.CLOUDTALK_SMS_SENDER = "+13035550199"),
    (env: OutboxEnvironment) => (env.CLOUDTALK_ALLOWED_NUMBERS = "not-a-number"),
  ]) {
    const f = outboxFixture();
    change(f.env);
    await dispatchOne(f.db, f.env, f.transport);
    assert.equal(f.requests.length, 0);
    assert.equal(f.release()?.p_error_code, "delivery_policy_or_configuration_blocked");
    assert.ok(!f.calls.some((c) => c.name === "start_communication_attempt"));
  }
});

test("test mode still restricts CloudTalk recipients", async () => {
  const f = outboxFixture();
  f.env.OUTBOUND_TEST_PHONES = "+13035550111";
  await dispatchOne(f.db, f.env, f.transport);
  assert.equal(f.requests.length, 0);
  assert.equal(f.release()?.p_error_code, "delivery_policy_or_configuration_blocked");
});

test("changed frozen sender metadata blocks a CloudTalk retry", async () => {
  const f = outboxFixture();
  f.row.provider_config = { from: "+13035550111", provider: "cloudtalk" };
  await dispatchOne(f.db, f.env, f.transport);
  assert.equal(f.requests.length, 0);
  assert.equal(f.release()?.p_error_code, "delivery_policy_or_configuration_blocked");
});

// dispatch-outbound-deliveries (legacy outbound_deliveries queue)
function outboundFixture(responder: () => Promise<Response> | Response = () => ok(), permitted: unknown = true) {
  const env: OutboundSmsEnvironment = {
    APP_ENV: "staging",
    OUTBOUND_DELIVERY_MODE: "test",
    OUTBOUND_TEST_PHONES: client,
    CLOUDTALK_API_KEY_ID: "synthetic-id",
    CLOUDTALK_API_KEY_SECRET: "synthetic-secret",
    CLOUDTALK_ALLOWED_NUMBERS: practice,
  };
  const rpcs: { name: string; args?: Record<string, unknown> }[] = [];
  const requests: string[] = [];
  let twilioCalls = 0;
  const twilioResult: OutboundSmsResult = {
    status: "ACCEPTED",
    provider: "twilio",
    providerMessageId: "SMx",
    statusNote: "twilio",
    errorText: null,
    nextAttemptAt: null,
  };
  const deps = {
    db: {
      rpc: async (name: string, args?: Record<string, unknown>) => {
        rpcs.push({ name, args });
        return { data: permitted, error: null };
      },
    },
    leaseOwner: "worker-a",
    transport: (async (url: string | URL | Request) => {
      requests.push(String(url));
      return await responder();
    }) as typeof fetch,
    sendTwilio: async () => {
      twilioCalls++;
      return twilioResult;
    },
    now: () => Date.parse("2026-09-28T12:00:00Z"),
    retryDelayMs: 60000,
  };
  const delivery = { id: "35000000-0000-4000-8000-000000000001", recipient: client, attempt_count: 1, max_attempts: 3 };
  return { env, deps, delivery, rpcs, requests, twilioCalls: () => twilioCalls };
}

test("outbound deliveries: CloudTalk accepted after the consent check, Twilio untouched", async () => {
  const f = outboundFixture();
  const result = await dispatchOutboundSms(f.delivery, "Reminder", f.env, f.deps);
  assert.equal(result.status, "ACCEPTED");
  assert.equal(result.provider, "cloudtalk");
  assert.equal(result.providerMessageId, `local-accepted:${f.delivery.id}`);
  assert.deepEqual(f.rpcs, [{ name: "outbound_delivery_sms_permitted", args: { p_delivery_id: f.delivery.id, p_lease_owner: "worker-a" } }]);
  assert.deepEqual(f.requests, [CLOUDTALK_SMS_ENDPOINT]);
  assert.equal(f.twilioCalls(), 0);
});

test("outbound deliveries: opted-out recipient is failed with no provider request", async () => {
  const f = outboundFixture(ok, false);
  const result = await dispatchOutboundSms(f.delivery, "Reminder", f.env, f.deps);
  assert.equal(result.status, "FAILED");
  assert.equal(f.requests.length, 0);
  assert.equal(f.twilioCalls(), 0);
});

test("outbound deliveries: throttling retries, rejection fails, ambiguity is UNKNOWN", async () => {
  let f = outboundFixture(() => status(429));
  let result = await dispatchOutboundSms(f.delivery, "Reminder", f.env, f.deps);
  assert.equal(result.status, "QUEUED");
  assert.equal(result.nextAttemptAt, "2026-09-28T12:01:00.000Z");
  f = outboundFixture(() => status(429));
  result = await dispatchOutboundSms({ ...f.delivery, attempt_count: 3 }, "Reminder", f.env, f.deps);
  assert.equal(result.status, "FAILED");
  f = outboundFixture(() => status(400));
  result = await dispatchOutboundSms(f.delivery, "Reminder", f.env, f.deps);
  assert.equal(result.status, "FAILED");
  assert.equal(result.nextAttemptAt, null);
  for (const responder of [() => status(503), () => Promise.reject(new Error("reset"))]) {
    f = outboundFixture(responder);
    result = await dispatchOutboundSms(f.delivery, "Reminder", f.env, f.deps);
    assert.equal(result.status, "UNKNOWN");
    assert.equal(result.nextAttemptAt, null);
    assert.equal(f.requests.length, 1);
  }
});

test("outbound deliveries: explicit Twilio uses the retained sender; bad config fails closed", async () => {
  let f = outboundFixture();
  f.env.SMS_PROVIDER = "twilio";
  let result = await dispatchOutboundSms(f.delivery, "Reminder", f.env, f.deps);
  assert.equal(result.provider, "twilio");
  assert.equal(f.twilioCalls(), 1);
  assert.equal(f.requests.length, 0);

  f = outboundFixture();
  f.env.SMS_PROVIDER = "sms";
  result = await dispatchOutboundSms(f.delivery, "Reminder", f.env, f.deps);
  assert.equal(result.status, "FAILED");
  assert.equal(f.rpcs.length + f.requests.length + f.twilioCalls(), 0);

  f = outboundFixture();
  delete f.env.CLOUDTALK_API_KEY_ID;
  result = await dispatchOutboundSms(f.delivery, "Reminder", f.env, f.deps);
  assert.equal(result.status, "FAILED");
  assert.equal(f.requests.length + f.twilioCalls(), 0);

  f = outboundFixture();
  f.env.OUTBOUND_TEST_PHONES = "+13035550111";
  result = await dispatchOutboundSms(f.delivery, "Reminder", f.env, f.deps);
  assert.equal(result.status, "FAILED");
  assert.equal(f.rpcs.length + f.requests.length, 0);

  f = outboundFixture();
  result = await dispatchOutboundSms(f.delivery, "x".repeat(1601), f.env, f.deps);
  assert.equal(result.status, "FAILED");
  assert.equal(f.requests.length, 0);
});
