import { test } from "node:test";
import assert from "node:assert/strict";
import twilio from "twilio";
import { receiveTwilio, type ProviderEvent } from "../../supabase/functions/_shared/inbound/handlers.ts";
import { processOneInbound } from "../../supabase/functions/_shared/inbound/process.ts";
import { digestMetadata } from "../../supabase/functions/_shared/inbound/verification.ts";
const token = "v1." + "a".repeat(43);
const body = `Please explain this https://thelivingroom.vet/shared/11223344-1234-4234-8234-123456789abc#${token}. Thank you.`;
const sid = `SM${"b".repeat(32)}`;
const account = `AC${"c".repeat(32)}`;
const url = "https://hooks.example.test/twilio";
const secret = "synthetic-signing-test-key";
function fixture(event?: ProviderEvent) {
  const calls: { name: string; args?: Record<string, unknown> }[] = [];
  return { calls, db: { rpc: async (name: string, args?: Record<string, unknown>) => { calls.push({ name, args }); return { data: name === "claim_communication_event" ? event : { id: "synthetic" }, error: null }; } } };
}
async function signedInbound(message = body) {
  const params = { AccountSid: account, MessageSid: sid, From: "+13035550100", To: "+13035550199", Body: message, MessageStatus: "received" };
  const request = new Request(url, { method: "POST", body: new URLSearchParams(params), headers: { "Content-Type": "application/x-www-form-urlencoded", "x-twilio-signature": twilio.getExpectedTwilioSignature(secret, url, params) } });
  const f = fixture();
  await receiveTwilio(request, f.db, { TWILIO_ACCOUNT_SID: account, TWILIO_FROM_NUMBER: params.To, TWILIO_WEBHOOK_URL: url }, (sig, target, values) => twilio.validateRequest(secret, sig, target, values));
  return f;
}
test("validly signed quoted SMS is verified raw then persisted redacted with original dedupe hash", async () => {
  const f = await signedInbound();
  const args = f.calls[0].args!;
  const metadata = args.p_metadata as Record<string, unknown>;
  assert.ok(!JSON.stringify(f.calls).includes(token));
  assert.equal(metadata.body, body.replace(token, "[private-document-access-redacted]"));
  assert.equal(metadata.body_hash, await digestMetadata({ body }));
  assert.equal(args.p_event_id, `${sid}/inbound`);
  assert.equal(args.p_payload_hash, await digestMetadata({ from: "+13035550100", to: "+13035550199", body, opt_action: null }));
  assert.deepEqual((await signedInbound()).calls, f.calls);
  assert.notEqual((await signedInbound(body.replace(token, "v1." + "d".repeat(43)))).calls[0].args!.p_payload_hash, args.p_payload_hash);
});
test("verified provider fetch matches raw body hash and completes only redacted SMS", async () => {
  const signed = await signedInbound();
  const event: ProviderEvent = { id: "event", provider: "twilio", event_type: "inbound", resource_id: sid, lease_token: "lease", metadata: signed.calls[0].args!.p_metadata as Record<string, unknown> };
  const f = fixture(event);
  const payload = { sid, account_sid: account, direction: "inbound", from: "+13035550100", to: "+13035550199", body, date_created: "2026-09-12T12:00:00Z", num_media: "0" };
  await processOneInbound(f.db, { TWILIO_ACCOUNT_SID: account, TWILIO_AUTH_TOKEN: secret }, async () => new Response(JSON.stringify(payload)));
  assert.equal(f.calls.at(-1)!.name, "complete_inbound_communication");
  assert.equal(f.calls.at(-1)!.args!.p_body, body.replace(token, "[private-document-access-redacted]"));
  assert.ok(!JSON.stringify(f.calls).includes(token));
  const forged = fixture(event);
  await processOneInbound(forged.db, { TWILIO_ACCOUNT_SID: account, TWILIO_AUTH_TOKEN: secret }, async () => new Response(JSON.stringify({ ...payload, body: body.replace(token, "v1." + "d".repeat(43)) })));
  assert.equal(forged.calls.at(-1)!.name, "release_communication_event");
  assert.equal(forged.calls.at(-1)!.args!.p_review, true);
});
test("incoming email canonical capabilities redacted from text, HTML, subject and attachment metadata", async () => {
  const id = "11223344-1234-4234-8234-123456789abc";
  const f = fixture({ id: "event", provider: "resend", event_type: "inbound", resource_id: id, lease_token: "lease", metadata: { from: "family@example.test", to: "care@example.test" } });
  await processOneInbound(f.db, { RESEND_API_KEY: "synthetic" }, async () => new Response(JSON.stringify({ id, from: "family@example.test", to: ["care@example.test"], text: body, html: `<p>${body}</p>`, subject: body, created_at: "2026-09-12T12:00:00Z", attachments: [{ id: "attachment", filename: `${token}.pdf`, size: 1, content_type: "application/pdf" }] })));
  assert.equal(f.calls.at(-1)!.name, "complete_inbound_communication");
  assert.ok(!JSON.stringify(f.calls).includes(token));
  assert.ok(String(f.calls.at(-1)!.args!.p_body).includes("Thank you."));
});

for (const prefix of ["p1", "s1"]) {
  test(`${prefix} payment capabilities are redacted after raw SMS verification`, async () => {
    const capability = prefix + "." + "q".repeat(43);
    const quoted = `Please review https://thelivingroom.vet/pay/11223344-1234-4234-8234-123456789abc#${capability}`;
    const signed = await signedInbound(quoted);
    const metadata = signed.calls[0].args!.p_metadata as Record<string, unknown>;
    assert.equal(metadata.body_hash, await digestMetadata({body: quoted}));
    assert.equal(metadata.body, quoted.replace(capability, "[private-payment-access-redacted]"));
    const f = fixture({id: "event", provider: "twilio", event_type: "inbound", resource_id: sid, lease_token: "lease", metadata});
    await processOneInbound(f.db, {TWILIO_ACCOUNT_SID: account, TWILIO_AUTH_TOKEN: secret}, async () => new Response(JSON.stringify({sid, account_sid: account, direction: "inbound", from: "+13035550100", to: "+13035550199", body: quoted, date_created: "2026-09-12T12:00:00Z", num_media: "0"})));
    assert.equal(f.calls.at(-1)!.name, "complete_inbound_communication");
    assert.equal(f.calls.at(-1)!.args!.p_body, metadata.body);
    assert.ok(!JSON.stringify([...signed.calls, ...f.calls]).includes(capability));
  });
  test(`${prefix} quoted email capabilities are removed from all saved text and metadata`, async () => {
    const capability = prefix + "." + "q".repeat(43);
    const id = "11223344-1234-4234-8234-123456789abc";
    const f = fixture({id: "event", provider: "resend", event_type: "inbound", resource_id: id, lease_token: "lease", metadata: {from: "family@example.test", to: "care@example.test"}});
    await processOneInbound(f.db, {RESEND_API_KEY: "synthetic"}, async () => new Response(JSON.stringify({id, from: "family@example.test", to: ["care@example.test"], text: capability, html: `<p>${capability}</p>`, subject: capability, created_at: "2026-09-12T12:00:00Z", attachments: [{id: "attachment", filename: `${capability}.pdf`, size: 1, content_type: "application/pdf"}]})));
    assert.equal(f.calls.at(-1)!.name, "complete_inbound_communication");
    assert.ok(!JSON.stringify(f.calls).includes(capability));
    assert.equal(f.calls.at(-1)!.args!.p_body, "[private-payment-access-redacted]");
  });
}
