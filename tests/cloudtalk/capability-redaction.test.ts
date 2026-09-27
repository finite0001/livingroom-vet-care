import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { test } from "node:test";
import { verifyCloudTalkWebhook } from "../../supabase/functions/_shared/cloudtalk-webhook.ts";
import {
  redactPrivateCapabilities,
  redactPrivateCapabilitiesDeep,
} from "../../supabase/functions/_shared/private-capability-redaction.ts";

const grant = "3f1c2a4b-5d6e-4f70-8a91-b2c3d4e5f607";
const tail = "Ab_-" + "x".repeat(39);
const documentToken = `v1.${tail}`;
const guard = /(v1|p1|s1)\.[A-Za-z0-9_-]{43}/;

test("replaces a whole document link URL with the placeholder", () => {
  const text = `Your documents from The Living Room Veterinary Care: https://livingroomvet.example/shared/${grant}#${documentToken}`;
  assert.equal(redactPrivateCapabilities(text), "Your documents from The Living Room Veterinary Care: [secure document link]");
});

test("keeps surrounding punctuation and text, including a local development origin", () => {
  assert.equal(
    redactPrivateCapabilities(`See (http://localhost:8080/shared/${grant}#${documentToken}). Thanks`),
    "See ([secure document link]). Thanks",
  );
});

test("replaces payment collection, payment status and estimate links", () => {
  assert.equal(
    redactPrivateCapabilities(`Pay: https://app.example/pay/${grant}#p1.${tail}`),
    "Pay: [secure payment link]",
  );
  assert.equal(
    redactPrivateCapabilities(`Status https://app.example/payment/return/${grant}#s1.${tail} ok`),
    "Status [secure payment link] ok",
  );
  assert.equal(
    redactPrivateCapabilities(`Estimate https://app.example/estimate/${grant}#e1.${tail}`),
    "Estimate [secure estimate link]",
  );
});

test("replaces a bare token pasted without its URL", () => {
  assert.equal(redactPrivateCapabilities(`code ${documentToken}`), "code [secure document link]");
});

test("leaves ordinary text, bare grant URLs and short look-alikes unchanged", () => {
  for (const text of [
    "Is Luna due for her visit?",
    `https://app.example/shared/${grant}`,
    "version v1.2.3 is fine",
    `v1.${"x".repeat(42)}`,
  ]) {
    assert.equal(redactPrivateCapabilities(text), text);
  }
});

test("never leaves anything the persistence guard would reject", () => {
  const samples = [
    `x${documentToken}y`,
    `v1.v1.${tail}`,
    `https://a.example/shared/${grant}#${documentToken}${documentToken}`,
    `p1.${tail}${"z".repeat(20)} s1.${tail}`,
  ];
  for (const sample of samples) {
    const redacted = redactPrivateCapabilities(sample);
    assert.ok(!guard.test(redacted), `still guarded: ${redacted}`);
    assert.equal(redactPrivateCapabilities(redacted), redacted, "redaction is idempotent");
  }
});

test("redacts every string value in nested event data and rejects absurd nesting", () => {
  const data = {
    id: "ct-1",
    body: `Docs: https://app.example/shared/${grant}#${documentToken}`,
    internal_number: { number_e164: "+17207646677" },
    parts: [{ text: `p1.${tail}` }, 5, null, true],
  };
  assert.deepEqual(redactPrivateCapabilitiesDeep(data), {
    id: "ct-1",
    body: "Docs: [secure document link]",
    internal_number: { number_e164: "+17207646677" },
    parts: [{ text: "[secure payment link]" }, 5, null, true],
  });
  assert.equal(data.body.includes(documentToken), true, "input is not mutated");
  let deep: unknown = "leaf";
  for (let index = 0; index < 40; index++) deep = { next: deep };
  assert.throws(() => redactPrivateCapabilitiesDeep(deep), /Invalid CloudTalk/);
});

test("verified message.sent echo of an app document link reaches the database redacted", async () => {
  const secretBytes = randomBytes(32);
  const secret = `whsec_${secretBytes.toString("base64")}`;
  const raw = JSON.stringify({
    event_id: "event-doc-link",
    type: "message.sent",
    version: "v1",
    occurred_at: new Date().toISOString(),
    company_id: "practice-123",
    data: {
      id: "message-doc-link",
      channel: "sms",
      external_number: "+12025550143",
      internal_number: { number_e164: "+12025550178" },
      body: `Your documents: https://app.example/shared/${grant}#${documentToken}`,
    },
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", secretBytes).update(`delivery-1.${timestamp}.${raw}`).digest("base64");
  const headers = new Headers({ "svix-id": "delivery-1", "svix-timestamp": String(timestamp), "svix-signature": `v1,${signature}` });
  const event = await verifyCloudTalkWebhook(raw, headers, secret, "practice-123", ["+12025550178"]);
  assert.equal(event?.data.body, "Your documents: [secure document link]");
  assert.ok(!JSON.stringify(event).includes(documentToken));
  assert.ok(!JSON.stringify(event).includes(grant));
});
