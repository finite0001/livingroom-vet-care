import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as policy from "../../supabase/functions/_shared/delivery-policy.ts";

interface HarnessOptions {
  mode?: string;
  rolesError?: boolean;
  emptyRoles?: boolean;
  auditError?: boolean;
  updateError?: boolean;
  providerStatus?: number;
  networkError?: boolean;
  recipientMismatch?: boolean;
  optedIn?: boolean;
}

interface DispatcherHarnessOptions {
  mode?: string;
  token?: string;
  configuredToken?: string;
  providerStatus?: number;
  networkError?: boolean;
  recordError?: boolean;
  deliveries?: Array<Record<string, unknown>>;
}

interface WebhookHarnessOptions {
  body?: string;
  event?: Record<string, unknown>;
  headers?: Record<string, string>;
  recordError?: boolean;
}

const twilioCallbackUrl = "https://edge.example/functions/v1/twilio-message-status-callback";
const twilioInboundUrl = "https://edge.example/functions/v1/twilio-inbound-sms";
const twilioAuthToken = "twilio-secret";
const resendWebhookSecret = `whsec_${Buffer.from("resend-secret").toString("base64")}`;

function signTwilio(body: string, url = twilioCallbackUrl): string {
  const params = [...new URLSearchParams(body).entries()].sort(([left], [right]) => left.localeCompare(right));
  const signedValue = params.reduce((value, [key, paramValue]) => `${value}${key}${paramValue}`, url);
  return createHmac("sha1", twilioAuthToken).update(signedValue).digest("base64");
}

function signResend(rawBody: string, id = "msg_test", timestamp = Math.floor(Date.now() / 1000).toString()): Record<string, string> {
  const signature = createHmac("sha256", Buffer.from(resendWebhookSecret.slice("whsec_".length), "base64"))
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest("base64");
  return {
    "svix-id": id,
    "svix-timestamp": timestamp,
    "svix-signature": `v1,${signature}`,
  };
}

async function invoke(name: string, options: HarnessOptions = {}) {
  const sms = name === "send-sms";
  const recipient = sms ? "+13035550100" : "tester@example.com";
  const writes: { table: string; value: Record<string, unknown> }[] = [];
  const providerCalls: RequestInit[] = [];
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  const env: Record<string, string> = {
    APP_ENV: "staging", OUTBOUND_DELIVERY_MODE: options.mode ?? "test",
    OUTBOUND_TEST_EMAILS: "tester@example.com", OUTBOUND_TEST_PHONES: "+13035550100",
    RESEND_API_KEY: "fake", RESEND_FROM: "send@example.com", RESEND_REPLY_TO: "care@example.com",
    TWILIO_ACCOUNT_SID: `AC${"0".repeat(32)}`, TWILIO_AUTH_TOKEN: "fake", TWILIO_FROM_NUMBER: "+13035550199",
  };
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "staff" } }, error: null }) },
    from(table: string) {
      let operation = "read";
      const result = () => {
        if (operation !== "read") return { data: { id: "message" }, error: options.auditError && ["outbound_message_attempts", "document_deliveries"].includes(table) || options.updateError && table === "conversations" ? new Error("private database detail") : null };
        const data: Record<string, unknown> = {
          profiles: { id: "staff", is_active: true, role: "STAFF" },
          user_roles: options.emptyRoles ? [] : [{ role: "STAFF" }],
          conversations: { id: "conversation", client_id: "client" },
          clients: { primary_email: options.recipientMismatch ? "another@example.com" : recipient, primary_phone: options.recipientMismatch ? "+13035550101" : recipient },
          sms_consent: [{ phone_number: recipient, opted_in: options.optedIn !== false }],
          provider_contacts: { id: "provider", is_active: true, email: options.recipientMismatch ? "another@example.com" : recipient },
        };
        return { data: data[table], error: table === "user_roles" && options.rolesError ? new Error("private role error") : null };
      };
      const query = {
        select() { return query; }, eq() { return query; },
        maybeSingle() { return Promise.resolve(result()); }, single() { return Promise.resolve(result()); },
        insert(value: Record<string, unknown>) { operation = "insert"; writes.push({ table, value }); return query; },
        update(value: Record<string, unknown>) { operation = "update"; writes.push({ table, value }); return query; },
        then(resolve: (value: unknown) => unknown) { return Promise.resolve(result()).then(resolve); },
      };
      return query;
    },
    rpc(rpcName: string, args: Record<string, unknown>) {
      rpcCalls.push({ name: rpcName, args });
      if (rpcName === "enqueue_staff_outbound_message") {
        return Promise.resolve({
          data: [{ message_id: "message", outbound_delivery_id: "delivery", enqueue_status: "QUEUED" }],
          error: options.auditError ? new Error("private queue detail") : null,
        });
      }
      return Promise.resolve({ data: null, error: new Error("unexpected rpc") });
    },
  };
  let handler: ((request: Request) => Promise<Response>) | undefined;
  const source = readFileSync(new URL(`../../supabase/functions/${name}/index.ts`, import.meta.url), "utf8").replace(/^import .*;\n/gm, "");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  runInNewContext(compiled, {
    ...policy, serve: (fn: typeof handler) => { handler = fn; }, createClient: () => client,
    Deno: { env: { get: (key: string) => env[key] } }, Response, Request, URLSearchParams, btoa,
    fetch: async (_url: string, init: RequestInit) => {
      providerCalls.push(init);
      if (options.networkError) throw new Error("sensitive provider response");
      return new Response("sensitive provider response", { status: options.providerStatus ?? 202 });
    },
  });
  assert.ok(handler);
  const response = await handler(new Request("https://edge.example", { method: "POST", body: JSON.stringify({ to: recipient, body: "test body", subject: "test", conversation_id: "conversation", provider_id: "provider" }) }));
  return { status: response.status, body: await response.json(), writes, providerCalls, rpcCalls };
}

async function invokeDispatcher(options: DispatcherHarnessOptions = {}) {
  const providerCalls: { url: string; init: RequestInit }[] = [];
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  const env: Record<string, string> = {
    APP_ENV: "staging", OUTBOUND_DELIVERY_MODE: options.mode ?? "test",
    OUTBOUND_TEST_EMAILS: "tester@example.com", OUTBOUND_TEST_PHONES: "+13035550100",
    RESEND_API_KEY: "fake", RESEND_FROM: "send@example.com", RESEND_REPLY_TO: "care@example.com",
    TWILIO_ACCOUNT_SID: `AC${"0".repeat(32)}`, TWILIO_AUTH_TOKEN: "fake", TWILIO_FROM_NUMBER: "+13035550199",
    OUTBOUND_DISPATCHER_TOKEN: options.configuredToken ?? "worker-secret",
  };
  const deliveries = options.deliveries ?? [{
    id: "email-delivery",
    channel: "EMAIL",
    recipient: "tester@example.com",
    payload: { body: "Email body", subject: "Email subject" },
    attempt_count: 1,
    max_attempts: 3,
  }, {
    id: "sms-delivery",
    channel: "SMS",
    recipient: "+13035550100",
    payload: { kind: "appointment_reminder", pet_name: "Mabel", appointment_type: "wellness", appointment_scheduled_at: "2026-10-01T16:00:00Z" },
    attempt_count: 1,
    max_attempts: 3,
  }];
  const client = {
    rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      if (name === "claim_due_outbound_deliveries") return Promise.resolve({ data: deliveries, error: null });
      if (name === "record_outbound_delivery_result") return Promise.resolve({ data: null, error: options.recordError ? new Error("private settlement detail") : null });
      return Promise.resolve({ data: null, error: new Error("unexpected rpc") });
    },
  };
  let handler: ((request: Request) => Promise<Response>) | undefined;
  const source = readFileSync(new URL("../../supabase/functions/dispatch-outbound-deliveries/index.ts", import.meta.url), "utf8").replace(/^import .*;\n/gm, "");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  runInNewContext(compiled, {
    ...policy, serve: (fn: typeof handler) => { handler = fn; }, createClient: () => client,
    Deno: { env: { get: (key: string) => env[key] } }, Response, Request, URLSearchParams, btoa, Date,
    fetch: async (url: string, init: RequestInit) => {
      providerCalls.push({ url, init });
      if (options.networkError) throw new Error("sensitive provider response");
      const sms = url.includes("twilio.com");
      return new Response(JSON.stringify(sms ? { sid: "SM123" } : { id: "em_123" }), { status: options.providerStatus ?? 202, headers: { "Content-Type": "application/json" } });
    },
  });
  assert.ok(handler);
  const headers = new Headers({ "content-type": "application/json" });
  if (options.token !== undefined) headers.set("x-outbound-dispatch-token", options.token);
  const response = await handler(new Request("https://edge.example", {
    method: "POST",
    headers,
    body: JSON.stringify({ batch_size: 10, lease_owner: "test-worker" }),
  }));
  return { status: response.status, body: await response.json(), providerCalls, rpcCalls };
}

async function invokeWebhook(name: "twilio-message-status-callback" | "twilio-inbound-sms" | "resend-delivery-webhook", options: WebhookHarnessOptions = {}) {
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  const env: Record<string, string> = {
    SUPABASE_URL: "https://supabase.example",
    SUPABASE_SERVICE_ROLE_KEY: "service-role",
    TWILIO_AUTH_TOKEN: twilioAuthToken,
    TWILIO_STATUS_CALLBACK_URL: twilioCallbackUrl,
    TWILIO_INBOUND_WEBHOOK_URL: twilioInboundUrl,
    RESEND_WEBHOOK_SECRET: resendWebhookSecret,
  };
  const client = {
    rpc(rpcName: string, args: Record<string, unknown>) {
      rpcCalls.push({ name: rpcName, args });
      return Promise.resolve({ data: null, error: options.recordError ? new Error("private callback detail") : null });
    },
  };
  let handler: ((request: Request) => Promise<Response>) | undefined;
  const source = readFileSync(new URL(`../../supabase/functions/${name}/index.ts`, import.meta.url), "utf8").replace(/^import .*;\n/gm, "");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  runInNewContext(compiled, {
    serve: (fn: typeof handler) => { handler = fn; }, createClient: () => client,
    Deno: { env: { get: (key: string) => env[key] } }, Response, Request, URLSearchParams, URL, TextEncoder,
    btoa, atob, Date, JSON, crypto: webcrypto,
  });
  assert.ok(handler);

  let body = options.body;
  const headers = new Headers(options.headers ?? {});
  if (name === "twilio-message-status-callback" || name === "twilio-inbound-sms") {
    const url = name === "twilio-inbound-sms" ? twilioInboundUrl : twilioCallbackUrl;
    body ??= name === "twilio-inbound-sms"
      ? new URLSearchParams({ MessageSid: "SM-inbound", From: "+13035550100", To: "+13035550199", Body: "hello" }).toString()
      : new URLSearchParams({ MessageSid: "SM123", MessageStatus: "delivered" }).toString();
    if (!headers.has("x-twilio-signature")) headers.set("x-twilio-signature", signTwilio(body, url));
    headers.set("content-type", "application/x-www-form-urlencoded");
  } else {
    body ??= JSON.stringify(options.event ?? { type: "email.delivered", data: { email_id: "em_123" } });
    const signedHeaders = signResend(body);
    for (const [key, value] of Object.entries(signedHeaders)) if (!headers.has(key)) headers.set(key, value);
    headers.set("content-type", "application/json");
  }

  const requestUrl = name === "twilio-message-status-callback"
    ? twilioCallbackUrl
    : name === "twilio-inbound-sms"
      ? twilioInboundUrl
      : "https://edge.example/functions/v1/resend-delivery-webhook";
  const response = await handler(new Request(requestUrl, {
    method: "POST",
    headers,
    body,
  }));
  const contentType = response.headers.get("content-type") ?? "";
  const parsedBody = contentType.includes("application/json") ? await response.json() : await response.text();
  return { status: response.status, body: parsedBody, rpcCalls, contentType };
}

for (const name of ["send-email", "send-sms", "send-provider-email"]) {
  test(`${name}: policy and role failures cause no writes or provider calls`, async () => {
    for (const options of [{ mode: "disabled" }, { mode: "invalid" }, { rolesError: true }, { emptyRoles: true }, { recipientMismatch: true }]) {
      const result = await invoke(name, options);
      assert.ok(result.status >= 400);
      assert.equal(result.writes.length, 0);
      assert.equal(result.providerCalls.length, 0);
      assert.equal(result.rpcCalls.length, 0);
      assert.doesNotMatch(JSON.stringify(result.body), /private role error/);
    }
  });
}

for (const name of ["send-email", "send-sms"]) {
  test(`${name}: staff sends queue an outbound delivery without provider calls`, async () => {
    const result = await invoke(name);
    assert.equal(result.body.success, true);
    assert.equal(result.body.queued, true);
    assert.equal(result.body.accepted, false);
    assert.equal(result.body.delivered, false);
    assert.equal(result.body.message_id, "message");
    assert.equal(result.body.outbound_delivery_id, "delivery");
    assert.equal(result.providerCalls.length, 0);
    assert.equal(result.writes.length, 0);
    assert.equal(result.rpcCalls.length, 1);
    assert.equal(result.rpcCalls[0].name, "enqueue_staff_outbound_message");
    assert.equal(result.rpcCalls[0].args.p_channel, name === "send-sms" ? "SMS" : "EMAIL");
    assert.equal(result.rpcCalls[0].args.p_recipient, recipientForName(name));
    assert.equal(result.rpcCalls[0].args.p_body, "test body");
  });

  test(`${name}: queue failures stay private and do not call providers`, async () => {
    const result = await invoke(name, { auditError: true });
    assert.equal(result.status, 500);
    assert.equal(result.body.accepted, false);
    assert.equal(result.body.delivered, false);
    assert.equal(result.body.retry_safe, true);
    assert.equal(result.providerCalls.length, 0);
    assert.equal(result.rpcCalls.length, 1);
    assert.doesNotMatch(JSON.stringify(result.body), /private queue detail/);
  });
}

function recipientForName(name: string): string {
  return name === "send-sms" ? "+13035550100" : "tester@example.com";
}

for (const name of ["send-provider-email"]) {
  test(`${name}: provider acceptance is recorded without asserting delivery`, async () => {
    const result = await invoke(name);
    assert.equal(result.body.accepted, true);
    assert.equal(result.body.delivered, false);
    const audit = result.writes.find((write) => ["outbound_message_attempts", "document_deliveries"].includes(write.table));
    assert.equal(audit?.value.delivered, false);
    assert.match(String(audit?.value.status_note), /accepted.*unconfirmed/);
    if (name !== "send-sms") assert.equal(JSON.parse(String(result.providerCalls[0].body)).reply_to, "care@example.com");
  });
  test(`${name}: provider rejection, network uncertainty and audit errors stay truthful`, async () => {
    const rejected = await invoke(name, { providerStatus: 422 });
    assert.equal(rejected.body.accepted, false);
    assert.equal(rejected.body.delivered, false);
    assert.doesNotMatch(JSON.stringify(rejected), /sensitive provider response/);
    const uncertain = await invoke(name, { networkError: true });
    assert.equal(uncertain.body.acceptance_unknown, true);
    assert.equal(uncertain.body.retry_safe, false);
    const auditFailure = await invoke(name, { auditError: true });
    assert.equal(auditFailure.status, 500);
    assert.equal(auditFailure.body.accepted, true);
    assert.equal(auditFailure.body.delivered, false);
    assert.equal(auditFailure.body.retry_safe, false);
  });
}

test("SMS requires affirmative consent before writes", async () => {
  const result = await invoke("send-sms", { optedIn: false });
  assert.equal(result.status, 403);
  assert.equal(result.writes.length, 0);
  assert.equal(result.providerCalls.length, 0);
});

test("dispatcher requires token and enabled delivery mode before claiming rows", async () => {
  for (const options of [{ token: undefined }, { token: "wrong" }, { token: "worker-secret", mode: "disabled" }]) {
    const result = await invokeDispatcher(options);
    assert.ok(result.status >= 400);
    assert.equal(result.rpcCalls.length, 0);
    assert.equal(result.providerCalls.length, 0);
  }
});

test("dispatcher claims due deliveries, sends providers, and records accepted results", async () => {
  const result = await invokeDispatcher({ token: "worker-secret" });
  assert.equal(result.status, 200);
  assert.equal(result.body.success, true);
  assert.equal(result.body.claimed, 2);
  assert.equal(result.body.processed, 2);
  assert.equal(result.body.accepted, 2);
  assert.equal(result.providerCalls.length, 2);
  assert.equal(result.rpcCalls[0].name, "claim_due_outbound_deliveries");
  assert.equal(result.rpcCalls[0].args.p_lease_owner, "test-worker");
  assert.equal(result.rpcCalls[0].args.p_batch_size, 10);
  const resultCalls = result.rpcCalls.filter((call) => call.name === "record_outbound_delivery_result");
  assert.equal(resultCalls.length, 2);
  assert.deepEqual(resultCalls.map((call) => call.args.p_status), ["ACCEPTED", "ACCEPTED"]);
  assert.equal(resultCalls[0].args.p_provider, "resend");
  assert.equal(resultCalls[0].args.p_provider_message_id, "em_123");
  assert.equal(resultCalls[1].args.p_provider, "twilio");
  assert.equal(resultCalls[1].args.p_provider_message_id, "SM123");
  assert.match(String(result.providerCalls[1].init.body), /Mabel/);
});

test("dispatcher retries provider rejections while attempts remain", async () => {
  const result = await invokeDispatcher({ token: "worker-secret", providerStatus: 503 });
  assert.equal(result.status, 200);
  assert.equal(result.body.retrying, 2);
  const resultCalls = result.rpcCalls.filter((call) => call.name === "record_outbound_delivery_result");
  assert.deepEqual(resultCalls.map((call) => call.args.p_status), ["QUEUED", "QUEUED"]);
  assert.ok(resultCalls.every((call) => typeof call.args.p_next_attempt_at === "string"));
});

test("dispatcher marks terminal provider rejections failed and network uncertainty unknown", async () => {
  const rejected = await invokeDispatcher({
    token: "worker-secret",
    providerStatus: 422,
    deliveries: [{
      id: "sms-delivery",
      channel: "SMS",
      recipient: "+13035550100",
      payload: { body: "hello" },
      attempt_count: 1,
      max_attempts: 3,
    }],
  });
  assert.equal(rejected.body.failed, 1);
  const rejectedResult = rejected.rpcCalls.find((call) => call.name === "record_outbound_delivery_result");
  assert.equal(rejectedResult?.args.p_status, "FAILED");
  assert.equal(rejectedResult?.args.p_next_attempt_at, null);

  const unknown = await invokeDispatcher({ token: "worker-secret", networkError: true });
  assert.equal(unknown.body.unknown, 2);
  assert.deepEqual(
    unknown.rpcCalls.filter((call) => call.name === "record_outbound_delivery_result").map((call) => call.args.p_status),
    ["UNKNOWN", "UNKNOWN"],
  );
  assert.doesNotMatch(JSON.stringify(unknown.body), /sensitive provider response/);
});

test("dispatcher reports settlement failures without leaking private database details", async () => {
  const result = await invokeDispatcher({ token: "worker-secret", recordError: true });
  assert.equal(result.status, 500);
  assert.equal(result.body.settlement_failed, true);
  assert.equal(result.body.processed, 0);
  assert.equal(result.providerCalls.length, 1);
  assert.doesNotMatch(JSON.stringify(result.body), /private settlement detail/);
});

test("Twilio callback verifies signatures before recording terminal status", async () => {
  const invalid = await invokeWebhook("twilio-message-status-callback", { headers: { "x-twilio-signature": "bad" } });
  assert.equal(invalid.status, 403);
  assert.equal(invalid.rpcCalls.length, 0);

  const delivered = await invokeWebhook("twilio-message-status-callback");
  assert.equal(delivered.status, 200);
  assert.equal(delivered.body.recorded, true);
  assert.equal(delivered.rpcCalls.length, 1);
  assert.equal(delivered.rpcCalls[0].name, "record_outbound_delivery_callback");
  assert.equal(delivered.rpcCalls[0].args.p_provider, "twilio");
  assert.equal(delivered.rpcCalls[0].args.p_provider_message_id, "SM123");
  assert.equal(delivered.rpcCalls[0].args.p_status, "DELIVERED");
});

test("Twilio callback ignores non-terminal statuses and maps failures", async () => {
  const sentBody = new URLSearchParams({ MessageSid: "SM123", MessageStatus: "sent" }).toString();
  const sent = await invokeWebhook("twilio-message-status-callback", { body: sentBody, headers: { "x-twilio-signature": signTwilio(sentBody) } });
  assert.equal(sent.status, 200);
  assert.equal(sent.body.ignored, true);
  assert.equal(sent.rpcCalls.length, 0);

  const failedBody = new URLSearchParams({ MessageSid: "SM123", MessageStatus: "undelivered", ErrorCode: "30007", ErrorMessage: "Filtered" }).toString();
  const failed = await invokeWebhook("twilio-message-status-callback", { body: failedBody, headers: { "x-twilio-signature": signTwilio(failedBody) } });
  assert.equal(failed.rpcCalls[0].args.p_status, "FAILED");
  assert.match(String(failed.rpcCalls[0].args.p_error_text), /30007/);
});

test("Twilio inbound SMS verifies signatures before recording client messages", async () => {
  const invalid = await invokeWebhook("twilio-inbound-sms", { headers: { "x-twilio-signature": "bad" } });
  assert.equal(invalid.status, 403);
  assert.equal(invalid.rpcCalls.length, 0);

  const inbound = await invokeWebhook("twilio-inbound-sms");
  assert.equal(inbound.status, 200);
  assert.match(String(inbound.body), /<Response/);
  assert.equal(inbound.rpcCalls.length, 1);
  assert.equal(inbound.rpcCalls[0].name, "record_inbound_sms");
  assert.equal(inbound.rpcCalls[0].args.p_from, "+13035550100");
  assert.equal(inbound.rpcCalls[0].args.p_to, "+13035550199");
  assert.equal(inbound.rpcCalls[0].args.p_body, "hello");
  assert.equal(inbound.rpcCalls[0].args.p_provider_message_id, "SM-inbound");
});

test("Twilio inbound SMS forwards Advanced Opt-Out metadata to the database RPC", async () => {
  const body = new URLSearchParams({ MessageSid: "SM-stop", From: "+13035550100", To: "+13035550199", Body: "please stop", OptOutType: "STOP" }).toString();
  const result = await invokeWebhook("twilio-inbound-sms", {
    body,
    headers: { "x-twilio-signature": signTwilio(body, twilioInboundUrl) },
  });
  assert.equal(result.status, 200);
  assert.equal(result.rpcCalls[0].args.p_opt_out_type, "STOP");
});

test("Resend webhook verifies Svix signatures before recording delivery events", async () => {
  const invalid = await invokeWebhook("resend-delivery-webhook", { headers: { "svix-id": "msg", "svix-timestamp": Math.floor(Date.now() / 1000).toString(), "svix-signature": "v1,bad" } });
  assert.equal(invalid.status, 403);
  assert.equal(invalid.rpcCalls.length, 0);

  const delivered = await invokeWebhook("resend-delivery-webhook");
  assert.equal(delivered.status, 200);
  assert.equal(delivered.body.recorded, true);
  assert.equal(delivered.rpcCalls[0].name, "record_outbound_delivery_callback");
  assert.equal(delivered.rpcCalls[0].args.p_provider, "resend");
  assert.equal(delivered.rpcCalls[0].args.p_provider_message_id, "em_123");
  assert.equal(delivered.rpcCalls[0].args.p_status, "DELIVERED");
});

test("Resend webhook rejects stale signatures and maps failure/ignored events", async () => {
  const oldBody = JSON.stringify({ type: "email.delivered", data: { email_id: "em_old" } });
  const stale = await invokeWebhook("resend-delivery-webhook", { body: oldBody, headers: signResend(oldBody, "msg_old", "1000") });
  assert.equal(stale.status, 403);
  assert.equal(stale.rpcCalls.length, 0);

  const bouncedEvent = { type: "email.bounced", data: { email_id: "em_bounced", bounce: { message: "Mailbox unavailable" } } };
  const bouncedBody = JSON.stringify(bouncedEvent);
  const bounced = await invokeWebhook("resend-delivery-webhook", { body: bouncedBody, headers: signResend(bouncedBody), event: bouncedEvent });
  assert.equal(bounced.rpcCalls[0].args.p_status, "FAILED");
  assert.match(String(bounced.rpcCalls[0].args.p_error_text), /Mailbox unavailable/);

  const openedBody = JSON.stringify({ type: "email.opened", data: { email_id: "em_opened" } });
  const opened = await invokeWebhook("resend-delivery-webhook", { body: openedBody, headers: signResend(openedBody) });
  assert.equal(opened.body.ignored, true);
  assert.equal(opened.rpcCalls.length, 0);
});
