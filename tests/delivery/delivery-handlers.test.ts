import test from "node:test";
import assert from "node:assert/strict";
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

async function invoke(name: string, options: HarnessOptions = {}) {
  const sms = name === "send-sms";
  const recipient = sms ? "+13035550100" : "tester@example.com";
  const writes: { table: string; value: Record<string, unknown> }[] = [];
  const providerCalls: RequestInit[] = [];
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
  return { status: response.status, body: await response.json(), writes, providerCalls };
}

for (const name of ["send-email", "send-sms", "send-provider-email"]) {
  test(`${name}: policy and role failures cause no writes or provider calls`, async () => {
    for (const options of [{ mode: "disabled" }, { mode: "invalid" }, { rolesError: true }, { emptyRoles: true }, { recipientMismatch: true }]) {
      const result = await invoke(name, options);
      assert.ok(result.status >= 400);
      assert.equal(result.writes.length, 0);
      assert.equal(result.providerCalls.length, 0);
      assert.doesNotMatch(JSON.stringify(result.body), /private role error/);
    }
  });
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

test("conversation update failure prevents provider calls", async () => {
  for (const name of ["send-email", "send-sms"]) {
    const result = await invoke(name, { updateError: true });
    assert.equal(result.status, 500);
    assert.equal(result.providerCalls.length, 0);
  }
});
