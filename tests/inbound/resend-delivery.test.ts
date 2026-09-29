import { test } from "node:test";
import assert from "node:assert/strict";
import { Webhook } from "svix";
import { receiveResendDelivery } from "../../supabase/functions/_shared/inbound/handlers.ts";
import { WebhookError } from "../../supabase/functions/_shared/inbound/verification.ts";

// resend-delivery-webhook: Resend is outbound only; it has its own signing secret.
const verifier = new Webhook(`whsec_${Buffer.from("synthetic-resend-delivery-secret").toString("base64")}`);
const verify = (raw: string, headers: Record<string, string>) => verifier.verify(raw, headers);
const emailId = "11223344-1234-4234-8234-123456789abc";
// The Resend account is shared: only receipts from our own sender domain are ours.
const env = { RESEND_FROM: "The Practice <care@send.example.test>" };
function request(type: string, data: Record<string, unknown> = {}) {
  const raw = JSON.stringify({ type, created_at: "2026-09-27T12:00:00Z", data: {
    email_id: emailId, from: "care@send.example.test", to: ["client@example.test"], ...data,
  } });
  const now = new Date();
  const id = `msg_${type}`;
  return new Request("https://hooks.example.test/resend-delivery", { method: "POST", body: raw, headers: {
    "svix-id": id, "svix-timestamp": String(Math.floor(now.getTime() / 1000)), "svix-signature": verifier.sign(id, now, raw),
  } });
}
function database(error: unknown = null) {
  const calls: { name: string; args?: Record<string, unknown> }[] = [];
  return { calls, rpc: async (name: string, args?: Record<string, unknown>) => {
    calls.push({ name, args });
    return { data: error ? null : { recorded: true }, error };
  } };
}

test("Resend receiving is refused on the delivery endpoint without persistence", async () => {
  const db = database();
  let legacy = 0;
  await assert.rejects(receiveResendDelivery(request("email.received"), db, env, verify, async () => { legacy++; return "settled" as const; }),
    (error: unknown) => error instanceof WebhookError && error.status === 410);
  assert.equal(db.calls.length, 0);
  assert.equal(legacy, 0);
});

test("canonical outbox receipts persist durably and never touch the legacy table", async () => {
  for (const type of ["sent", "delivered", "bounced", "complained", "failed"]) {
    const db = database();
    let legacy = 0;
    assert.deepEqual(await receiveResendDelivery(request(`email.${type}`), db, env, verify, async () => { legacy++; return "settled" as const; }), { recorded: true });
    assert.equal(db.calls.length, 1);
    assert.equal(db.calls[0].name, "receive_communication_event");
    assert.equal(db.calls[0].args?.p_event_type, type);
    assert.equal(legacy, 0);
  }
});

test("an uncorrelated terminal receipt may settle a legacy outbound delivery; unknown ones are acknowledged", async () => {
  const settled: unknown[] = [];
  const result = await receiveResendDelivery(request("email.bounced", { bounce: { message: "Mailbox full" } }),
    database({ code: "23503" }), env, verify, async (input) => { settled.push(input); return "settled" as const; });
  assert.deepEqual(result, { recorded: true, legacy: true, status: "bounced" });
  assert.deepEqual(settled, [{ providerMessageId: emailId, status: "FAILED", note: "Resend webhook reported email.bounced.", errorText: "Mailbox full" }]);

  // Transient legacy failures still ask the provider to retry.
  for (const legacy of [async () => false as const, async () => { throw new Error("db down"); }]) {
    await assert.rejects(receiveResendDelivery(request("email.delivered"), database({ code: "23503" }), env, verify, legacy),
      (error: unknown) => error instanceof WebhookError && error.status === 503);
  }
  // Other database failures never fall back.
  let calls = 0;
  await assert.rejects(receiveResendDelivery(request("email.delivered"), database({ code: "23505" }), env, verify, async () => { calls++; return "settled" as const; }),
    (error: unknown) => error instanceof WebhookError && error.status === 503);
  assert.equal(calls, 0);
});

test("an own-domain receipt nobody knows is acknowledged once, never retried", async () => {
  // Legacy table has no eligible row (record_outbound_delivery_callback returned NULL).
  const db = database({ code: "23503" });
  let legacyCalls = 0;
  assert.deepEqual(
    await receiveResendDelivery(request("email.delivered"), db, env, verify, async () => { legacyCalls++; return "unmatched" as const; }),
    { acknowledged: true, recorded: false, status: "delivered" },
  );
  assert.equal(db.calls.length, 1);
  assert.equal(legacyCalls, 1);
  // Non-terminal receipts and deployments without the legacy path acknowledge too.
  assert.deepEqual(await receiveResendDelivery(request("email.sent"), database({ code: "23503" }), env, verify, async () => { legacyCalls++; return "settled" as const; }),
    { acknowledged: true, recorded: false, status: "sent" });
  assert.deepEqual(await receiveResendDelivery(request("email.failed"), database({ code: "23503" }), env, verify),
    { acknowledged: true, recorded: false, status: "failed" });
  assert.equal(legacyCalls, 1);
});

test("receipts for other businesses on the shared Resend account are acknowledged with zero database calls", async () => {
  for (const from of ["billing@greentree.vet", "Ondara <hello@ondara.pet>", "camp@campsequoialake.com", "care@example.test", "not-an-address", undefined]) {
    for (const type of ["sent", "delivered", "bounced", "complained", "failed"]) {
      const db = database();
      let legacy = 0;
      const result = await receiveResendDelivery(request(`email.${type}`, { from, subject: "Private subject", to: ["someone@elsewhere.test"] }),
        db, env, verify, async () => { legacy++; return "settled" as const; });
      assert.deepEqual(result, { acknowledged: true, ignored: "foreign_sender" });
      assert.equal(db.calls.length, 0, `${from} ${type} must not reach the database`);
      assert.equal(legacy, 0);
      assert.ok(!JSON.stringify(result).includes("Private subject"));
    }
  }
  // The Auth sender's domain is ours as well.
  const db = database();
  assert.deepEqual(await receiveResendDelivery(request("email.delivered", { from: "auth@auth.example.test" }), db, {
    ...env, RESEND_AUTH_FROM_ADDRESS: "auth@auth.example.test", AGENTMAIL_INBOX_ADDRESS: "inbox@agent.example.test",
  }, verify), { purpose: "authentication", status: "delivered" });
  assert.equal(db.calls.length, 0);
  // Without a parseable RESEND_FROM nothing can be classified: fail closed, still no database call.
  await assert.rejects(receiveResendDelivery(request("email.delivered"), db, {}, verify), (e: WebhookError) => e.status === 503);
  assert.equal(db.calls.length, 0);
});

test("forged delivery proofs and the AgentMail inbox as Auth sender fail closed", async () => {
  const db = database();
  const forged = request("email.delivered");
  forged.headers.set("svix-signature", "v1,Zm9yZ2Vk");
  await assert.rejects(receiveResendDelivery(forged, db, env, verify), (e: WebhookError) => e.status === 401);
  await assert.rejects(receiveResendDelivery(request("email.delivered"), db, {
    RESEND_FROM: "care@send.example.test", RESEND_AUTH_FROM_ADDRESS: "care@reply.example.test", AGENTMAIL_INBOX_ADDRESS: "care@reply.example.test",
  }, verify), (e: WebhookError) => e.status === 503);
  assert.equal(db.calls.length, 0);
});
