import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { test } from "node:test";
import { verifyCloudTalkWebhook } from "../../supabase/functions/_shared/cloudtalk-webhook.ts";

const companyId = "practice-123";
const number = "+12025550178";
const secretBytes = randomBytes(32);
const secret = `whsec_${secretBytes.toString("base64")}`;

function signedRequest(overrides: Record<string, unknown> = {}, timestamp = Math.floor(Date.now() / 1000)) {
  const event = {
    event_id: "event-123",
    type: "message.received",
    version: "v1",
    occurred_at: new Date().toISOString(),
    company_id: companyId,
    data: {
      id: "message-123",
      channel: "sms",
      external_number: "+12025550143",
      internal_number: { number_e164: number },
      body: "hello",
    },
    ...overrides,
  };
  const raw = JSON.stringify(event);
  const id = "delivery-456";
  const signature = createHmac("sha256", secretBytes).update(`${id}.${timestamp}.${raw}`).digest("base64");
  const headers = new Headers({
    "svix-id": id,
    "svix-timestamp": String(timestamp),
    "svix-signature": `v1,${signature}`,
  });
  return { raw, headers };
}

test("accepts a signed event for the practice number even when delivery ID differs from event ID", async () => {
  const { raw, headers } = signedRequest();
  const event = await verifyCloudTalkWebhook(raw, headers, secret, companyId, [number]);
  assert.equal(event?.event_id, "event-123");
});

test("rejects a tampered body, stale delivery, or other account; ignores another owned-account number", async () => {
  const { raw, headers } = signedRequest();
  await assert.rejects(verifyCloudTalkWebhook(raw.replace("hello", "changed"), headers, secret, companyId, [number]));
  const stale = signedRequest({}, Math.floor(Date.now() / 1000) - 600);
  await assert.rejects(verifyCloudTalkWebhook(stale.raw, stale.headers, secret, companyId, [number]));
  await assert.rejects(verifyCloudTalkWebhook(raw, headers, secret, "another-account", [number]));
  assert.equal(await verifyCloudTalkWebhook(raw, headers, secret, companyId, ["+12025550999"]), null);
});

test("ignores a signed event type the application does not handle", async () => {
  const { raw, headers } = signedRequest({ type: "contact.created" });
  assert.equal(await verifyCloudTalkWebhook(raw, headers, secret, companyId, [number]), null);
});
