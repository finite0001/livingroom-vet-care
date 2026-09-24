import { test } from "node:test";
import assert from "node:assert/strict";
import { Webhook } from "svix";
import { receiveResend, type WebhookEnvironment } from "../../supabase/functions/_shared/inbound/handlers.ts";

const verifier = new Webhook(`whsec_${Buffer.from("synthetic-auth-mail-webhook-secret").toString("base64")}`);
const verify = (raw: string, headers: Record<string, string>) => verifier.verify(raw, headers);
const env: WebhookEnvironment = {
  RESEND_FROM: "Practice <care@reply.example.test>",
  RESEND_AUTH_FROM_ADDRESS: "access@auth.example.test",
  RESEND_INBOUND_ADDRESSES: "care@reply.example.test",
};
function request(type = "email.delivered", from: unknown = "Access <access@auth.example.test>", to = ["owner@example.test"]) {
  const raw = JSON.stringify({ type, created_at: "2026-09-13T12:00:00Z", data: {
    email_id: "11223344-1234-4234-8234-123456789abc", from, to,
    subject: "PRIVATE_AUTH_SUBJECT", html: "PRIVATE_RECOVERY_LINK",
  } });
  const now = new Date();
  const id = "msg_auth_separation";
  return new Request("https://hooks.example.test/resend", { method: "POST", body: raw, headers: {
    "svix-id": id, "svix-timestamp": String(Math.floor(now.getTime() / 1000)),
    "svix-signature": verifier.sign(id, now, raw),
  } });
}
function database(error: unknown = null) {
  const calls: unknown[] = [];
  return { calls, rpc: async (name: string, args?: Record<string, unknown>) => {
    calls.push({ name, args });
    return { data: { recorded: true }, error };
  } };
}

test("signed reserved Auth statuses and duplicates never enter the client ledger", async () => {
  const db = database();
  for (const status of ["sent", "delivered", "bounced", "complained", "failed"]) {
    for (let replay = 0; replay < 2; replay++) {
      assert.deepEqual(await receiveResend(request(`email.${status}`), db, env, verify), {
        purpose: "authentication", status,
      });
    }
  }
  assert.deepEqual(db.calls, []);
});
test("unknown client callbacks still fail with retry, including missing or misleading sender", async () => {
  for (const sender of ["care@reply.example.test", "other@example.test", null,
    "access@auth.example.test.attacker.test", "access@auth.example.test <other@example.test>"]) {
    const db = database({ code: "unmatched_provider_message" });
    await assert.rejects(receiveResend(request("email.delivered", sender), db, env, verify),
      (e: { status?: number }) => e.status === 503);
    assert.equal(db.calls.length, 1);
    assert.ok(!JSON.stringify(db.calls).includes("PRIVATE_"));
  }
});
test("known client statuses retain their durable persistence path", async () => {
  const db = database();
  assert.deepEqual(await receiveResend(request("email.delivered", "care@reply.example.test"), db, env, verify), { recorded: true });
  assert.equal(db.calls.length, 1);
});
test("unconfigured Auth separation preserves existing unknown-status retry", async () => {
  const db = database({ code: "unmatched_provider_message" });
  await assert.rejects(receiveResend(request(), db, {}, verify), (e: { status?: number }) => e.status === 503);
  assert.equal(db.calls.length, 1);
});
test("ambiguous or malformed sender configuration fails closed before persistence", async () => {
  for (const delta of [
    { RESEND_AUTH_FROM_ADDRESS: "" }, { RESEND_AUTH_FROM_ADDRESS: "bad" },
    { RESEND_AUTH_FROM_ADDRESS: "care@reply.example.test" }, { RESEND_FROM: undefined },
    { RESEND_INBOUND_ADDRESSES: "access@auth.example.test" },
  ]) {
    const db = database();
    await assert.rejects(receiveResend(request(), db, { ...env, ...delta }, verify), (e: { status?: number }) => e.status === 503);
    assert.deepEqual(db.calls, []);
  }
});
test("incoming private Auth mail is not mistaken for an outbound status", async () => {
  const db = database();
  await assert.rejects(receiveResend(request("email.received", "access@auth.example.test", ["owner@example.test"]), db, env, verify),
    (e: { status?: number }) => e.status === 400);
  assert.deepEqual(db.calls, []);
  await assert.rejects(receiveResend(request("email.received", "access@auth.example.test", ["care@reply.example.test"]), db, env, verify),
    (e: { status?: number }) => e.status === 400);
  assert.deepEqual(db.calls, []);
  await receiveResend(request("email.received", "family@example.test", ["care@reply.example.test"]), db, env, verify);
  assert.equal(db.calls.length, 1);
});
test("invalid signature cannot exploit the Auth acknowledgement path", async () => {
  const db = database();
  const req = request();
  req.headers.set("svix-signature", "v1,invalid");
  await assert.rejects(receiveResend(req, db, env, verify), (e: { status?: number }) => e.status === 401);
  assert.deepEqual(db.calls, []);
});
