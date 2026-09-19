import { test } from "node:test";
import assert from "node:assert/strict";
import twilio from "twilio";
import { Webhook } from "svix";
import {
  boundedBody,
  verifiedResend,
  verifiedTwilio,
} from "../../supabase/functions/_shared/inbound/verification.ts";
const secret = `whsec_${Buffer.from("synthetic-secret-for-signature-tests").toString("base64")}`;
const verifier = new Webhook(secret);
test("official Svix proof validates raw body and rejects changed body or expired timestamp", () => {
  const raw = '{"type":"email.received"}';
  const id = "msg_synthetic";
  const now = new Date();
  const headers = new Headers({
    "svix-id": id,
    "svix-timestamp": String(Math.floor(now.getTime() / 1000)),
    "svix-signature": verifier.sign(id, now, raw),
  });
  const verify = (body: string, values: Record<string, string>) =>
    verifier.verify(body, values);
  assert.equal(verifiedResend(raw, headers, verify).id, id);
  assert.deepEqual(verifiedResend(raw, headers, verify).event, {
    type: "email.received",
  });
  assert.throws(() => verifiedResend(raw + " ", headers, verify), /Invalid/);
  const old = new Date(Date.now() - 600000);
  headers.set("svix-timestamp", String(Math.floor(old.getTime() / 1000)));
  headers.set("svix-signature", verifier.sign(id, old, raw));
  assert.throws(() => verifiedResend(raw, headers, verify), /expired/);
});
test("verified Resend parses only the signed body and rejects non-object JSON", () => {
  for (const raw of ["null", "[]", '"string"', "{"]) {
    const id = "msg_synthetic_json";
    const now = new Date();
    const headers = new Headers({
      "svix-id": id,
      "svix-timestamp": String(Math.floor(now.getTime() / 1000)),
      "svix-signature": verifier.sign(id, now, raw),
    });
    assert.throws(
      () => verifiedResend(raw, headers, (body, proof) => verifier.verify(body, proof)),
      /Invalid webhook JSON object/,
    );
  }
});
test("official Twilio validator covers every form field and exact configured URL", () => {
  const url = "https://hooks.example.test/sms?route=a%2Fb";
  const token = "synthetic";
  const params = {
    MessageSid: `SM${"a".repeat(32)}`,
    Body: "Synthetic",
    FutureParameter: "included",
  };
  const signature = twilio.getExpectedTwilioSignature(token, url, params);
  const req = new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": signature,
    },
  });
  const verify = (sig: string, target: string, data: Record<string, string>) =>
    twilio.validateRequest(token, sig, target, data);
  assert.deepEqual(
    {
      ...verifiedTwilio(
        req,
        new URLSearchParams(params).toString(),
        url,
        verify,
      ),
    },
    params,
  );
  assert.throws(
    () =>
      verifiedTwilio(
        req,
        new URLSearchParams({
          ...params,
          FutureParameter: "changed",
        }).toString(),
        url,
        verify,
      ),
    /Invalid/,
  );
  assert.throws(
    () =>
      verifiedTwilio(
        req,
        new URLSearchParams(params).toString(),
        url.replace("a%2Fb", "a/b"),
        verify,
      ),
    /Unexpected/,
  );
  assert.throws(
    () =>
      verifiedTwilio(
        req,
        new URLSearchParams(params).toString() + "&Body=duplicate",
        url,
        verify,
      ),
    /Duplicate/,
  );
});
test("body streaming limit applies even without a trustworthy Content-Length", async () => {
  await assert.rejects(
    boundedBody(
      new Request("https://example.test", {
        method: "POST",
        body: "x".repeat(65),
      }),
      64,
    ),
    /too large/,
  );
  assert.equal(
    await boundedBody(
      new Request("https://example.test", { method: "POST", body: "valid" }),
      64,
    ),
    "valid",
  );
});
