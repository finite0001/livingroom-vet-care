import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dispatchOne,
  type OutboxEnvironment,
} from "../../supabase/functions/_shared/outbox-dispatch.ts";
import {
  documentLinkConfig,
  materializeDocumentLink,
} from "../../supabase/functions/_shared/document-link-capability.ts";
async function fixture() {
  const grant = {
    id: "11223344-1234-4234-8234-123456789abc",
    origin: "https://thelivingroom.vet",
    key_version: "test",
    capability_context: "Synthetic immutable context",
    message_template: "Your reviewed documents: {{document_link}}",
  };
  const env: OutboxEnvironment = {
    APP_ENV: "staging",
    OUTBOUND_DELIVERY_MODE: "test",
    OUTBOUND_TEST_PHONES: "+13035550100",
    TWILIO_ACCOUNT_SID: `AC${"a".repeat(32)}`,
    TWILIO_AUTH_TOKEN: "synthetic",
    TWILIO_FROM_NUMBER: "+13035550199",
    DOCUMENT_LINK_ORIGIN: grant.origin,
    DOCUMENT_LINK_ACTIVE_KEY_VERSION: "test",
    DOCUMENT_LINK_KEYS: JSON.stringify({ test: btoa("a".repeat(32)) }),
    DOCUMENT_LINK_PUBLIC_ENABLED: "true",
  };
  const materialized = await materializeDocumentLink(
    grant,
    documentLinkConfig({
      origin: env.DOCUMENT_LINK_ORIGIN,
      activeKeyVersion: "test",
      keys: env.DOCUMENT_LINK_KEYS,
      publicEnabled: "true",
    }),
  );
  const context = {
    grant,
    token_hash: materialized.token_hash,
    message_hash: materialized.message_hash,
    artifact_hash: "a".repeat(64),
  };
  const row = {
    id: grant.id,
    channel: "SMS",
    recipient: "+13035550100",
    subject: "",
    body: grant.message_template,
    provider: "twilio",
    state: "claimed",
    lease_token: "synthetic lease",
    provider_config: null,
  };
  const calls: { name: string; args?: Record<string, unknown> }[] = [];
  const requests: RequestInit[] = [];
  let startState = "claimed";
  let contextError = false;
  const db = {
    rpc: async (name: string, args?: Record<string, unknown>) => {
      calls.push({ name, args });
      return {
        data: name === "claim_communication"
          ? row
          : name === "document_link_delivery_context"
          ? context
          : name === "read_frozen_email_payload"
          ? null
          : { ...row, state: startState },
        error: name === "document_link_delivery_context" && contextError
          ? new Error("ineligible")
          : null,
      };
    },
  };
  const transport: typeof fetch = async (_url, init) => {
    requests.push(init!);
    return new Response(JSON.stringify({ sid: `SM${"b".repeat(32)}` }));
  };
  return {
    env,
    context,
    materialized,
    calls,
    requests,
    db,
    transport,
    failStart() {
      startState = "failed";
    },
    failContext() {
      contextError = true;
    },
  };
}
test("actual SMS dispatcher materializes reviewed private link only in provider body and sends mandatory proof", async () => {
  const f = await fixture();
  const result = await dispatchOne(f.db, f.env, f.transport);
  assert.equal(result.state, "accepted");
  assert.equal(
    new URLSearchParams(String(f.requests[0].body)).get("Body"),
    f.materialized.materialized_message,
  );
  const metadata = f.calls.find((c) =>
    c.name === "start_communication_attempt"
  )!.args!.p_provider_config as Record<string, string>;
  assert.equal(
    metadata.document_link_message_hash,
    f.materialized.message_hash,
  );
  assert.equal(metadata.document_link_token_hash, f.materialized.token_hash);
  assert.equal(metadata.document_link_artifact_hash, f.context.artifact_hash);
  assert.ok(!JSON.stringify(f.calls).includes(f.materialized.token));
  assert.ok(!JSON.stringify(result).includes(f.materialized.token));
});
for (
  const scenario of [
    "removed key",
    "replaced key",
    "changed origin",
    "disabled retrieval",
    "message digest mismatch",
    "token digest mismatch",
    "changed template",
    "source ineligible",
  ] as const
) {
  test(`SMS ${scenario} prevents provider attempt`, async () => {
    const f = await fixture();
    if (scenario === "removed key") f.env.DOCUMENT_LINK_KEYS = "{}";
    if (scenario === "replaced key") {
      f.env.DOCUMENT_LINK_KEYS = JSON.stringify({ test: btoa("b".repeat(32)) });
    }
    if (scenario === "changed origin") {
      f.env.DOCUMENT_LINK_ORIGIN = "https://other.example";
    }
    if (scenario === "disabled retrieval") {
      f.env.DOCUMENT_LINK_PUBLIC_ENABLED = "false";
    }
    if (scenario === "message digest mismatch") {
      f.context.message_hash = "f".repeat(64);
    }
    if (scenario === "token digest mismatch") {
      f.context.token_hash = "f".repeat(64);
    }
    if (scenario === "changed template") {
      f.context.grant.message_template = "Changed {{document_link}}";
    }
    if (scenario === "source ineligible") f.failContext();
    await dispatchOne(f.db, f.env, f.transport);
    assert.equal(f.requests.length, 0);
    assert.ok(!f.calls.some((c) => c.name === "start_communication_attempt"));
    assert.equal(f.calls.at(-1)!.name, "release_communication_claim");
    assert.ok(!JSON.stringify(f.calls).includes(f.materialized.token));
  });
}
test("source changes between materialization and final database guard prevent transport", async () => {
  const f = await fixture();
  f.failStart();
  assert.equal((await dispatchOne(f.db, f.env, f.transport)).state, "failed");
  assert.equal(f.requests.length, 0);
});
test("ambiguous secure SMS transport is recorded once without token or automatic retry", async () => {
  const f = await fixture();
  let sends = 0;
  const result = await dispatchOne(f.db, f.env, async () => {
    sends++;
    throw new Error(`provider timeout ${f.materialized.token}`);
  });
  assert.equal(result.state, "uncertain");
  assert.equal(sends, 1);
  assert.equal(
    f.calls.at(-1)!.args!.p_error_code,
    "provider_transport_unknown",
  );
  assert.ok(!JSON.stringify(f.calls).includes(f.materialized.token));
});
