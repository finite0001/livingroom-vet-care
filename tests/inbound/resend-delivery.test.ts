import { test } from "node:test";
import assert from "node:assert/strict";
import { Webhook } from "svix";
import { receiveResendDelivery } from "../../supabase/functions/_shared/inbound/handlers.ts";
import { WebhookError } from "../../supabase/functions/_shared/inbound/verification.ts";

// resend-delivery-webhook: Resend is outbound only; it has its own signing secret.
const verifier = new Webhook(`whsec_${Buffer.from("synthetic-resend-delivery-secret").toString("base64")}`);
const verify = (raw: string, headers: Record<string, string>) => verifier.verify(raw, headers);
const emailId = "11223344-1234-4234-8234-123456789abc";
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
  await assert.rejects(receiveResendDelivery(request("email.received"), db, {}, verify, async () => { legacy++; return true; }),
    (error: unknown) => error instanceof WebhookError && error.status === 410);
  assert.equal(db.calls.length, 0);
  assert.equal(legacy, 0);
});

test("canonical outbox receipts persist durably and never touch the legacy table", async () => {
  for (const type of ["sent", "delivered", "bounced", "complained", "failed"]) {
    const db = database();
    let legacy = 0;
    assert.deepEqual(await receiveResendDelivery(request(`email.${type}`), db, {}, verify, async () => { legacy++; return true; }), { recorded: true });
    assert.equal(db.calls.length, 1);
    assert.equal(db.calls[0].name, "receive_communication_event");
    assert.equal(db.calls[0].args?.p_event_type, type);
    assert.equal(legacy, 0);
  }
});

test("an uncorrelated terminal receipt may settle a legacy outbound delivery, otherwise it retries", async () => {
  const settled: unknown[] = [];
  const result = await receiveResendDelivery(request("email.bounced", { bounce: { message: "Mailbox full" } }),
    database({ code: "23503" }), {}, verify, async (input) => { settled.push(input); return true; });
  assert.deepEqual(result, { recorded: true, legacy: true, status: "bounced" });
  assert.deepEqual(settled, [{ providerMessageId: emailId, status: "FAILED", note: "Resend webhook reported email.bounced.", errorText: "Mailbox full" }]);

  for (const legacy of [async () => false, async () => { throw new Error("db down"); }, undefined]) {
    await assert.rejects(receiveResendDelivery(request("email.delivered"), database({ code: "23503" }), {}, verify, legacy),
      (error: unknown) => error instanceof WebhookError && error.status === 503);
  }
  // A sent receipt is not terminal: it keeps retrying until the outbox row correlates.
  let calls = 0;
  await assert.rejects(receiveResendDelivery(request("email.sent"), database({ code: "23503" }), {}, verify, async () => { calls++; return true; }),
    (error: unknown) => error instanceof WebhookError && error.status === 503);
  assert.equal(calls, 0);
  // Other database failures never fall back.
  await assert.rejects(receiveResendDelivery(request("email.delivered"), database({ code: "23505" }), {}, verify, async () => { calls++; return true; }),
    (error: unknown) => error instanceof WebhookError && error.status === 503);
  assert.equal(calls, 0);
});

test("forged delivery proofs and the AgentMail inbox as Auth sender fail closed", async () => {
  const db = database();
  const forged = request("email.delivered");
  forged.headers.set("svix-signature", "v1,Zm9yZ2Vk");
  await assert.rejects(receiveResendDelivery(forged, db, {}, verify), (e: WebhookError) => e.status === 401);
  await assert.rejects(receiveResendDelivery(request("email.delivered"), db, {
    RESEND_FROM: "care@send.example.test", RESEND_AUTH_FROM_ADDRESS: "care@reply.example.test", AGENTMAIL_INBOX_ADDRESS: "care@reply.example.test",
  }, verify), (e: WebhookError) => e.status === 503);
  assert.equal(db.calls.length, 0);
});
