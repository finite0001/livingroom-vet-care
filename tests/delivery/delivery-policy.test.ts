import test from "node:test";
import assert from "node:assert/strict";
import { authorizeDelivery, normalizeEmail, normalizePhone, requireEmailConfiguration } from "../../supabase/functions/_shared/delivery-policy.ts";

test("delivery fails closed for missing, disabled, or malformed environments and modes", () => {
  for (const env of [{}, { APP_ENV: "production" }, { APP_ENV: "production", OUTBOUND_DELIVERY_MODE: "disabled" }, { APP_ENV: "prod", OUTBOUND_DELIVERY_MODE: "live" }, { APP_ENV: "production", OUTBOUND_DELIVERY_MODE: "LIVE" }, { APP_ENV: "staging", OUTBOUND_DELIVERY_MODE: "live" }, { APP_ENV: "development", OUTBOUND_DELIVERY_MODE: "live" }]) {
    assert.throws(() => authorizeDelivery(env, "EMAIL", "client@example.com"));
  }
  assert.equal(authorizeDelivery({ APP_ENV: "production", OUTBOUND_DELIVERY_MODE: "live" }, "EMAIL", "client@example.com").recipient, "client@example.com");
});

test("test email allowlists require exact normalized mailboxes and never redirect", () => {
  const env = { APP_ENV: "staging", OUTBOUND_DELIVERY_MODE: "test", OUTBOUND_TEST_EMAILS: " Tester@Example.com , other@example.com" };
  assert.equal(authorizeDelivery(env, "EMAIL", "TESTER@example.com").recipient, "tester@example.com");
  for (const recipient of ["client@example.com", "tester+client@example.com", "tester@example.com.evil", "other@example.com,tester@example.com"]) assert.throws(() => authorizeDelivery(env, "EMAIL", recipient));
  for (const list of [undefined, "", "*", "@example.com", "tester@example.com,", "tester@example.com,bad"]) assert.throws(() => authorizeDelivery({ ...env, OUTBOUND_TEST_EMAILS: list }, "EMAIL", "tester@example.com"));
});

test("SMS allowlists are channel specific and require explicit E164 country codes", () => {
  const env = { APP_ENV: "development", OUTBOUND_DELIVERY_MODE: "test", OUTBOUND_TEST_PHONES: "+1 (303) 555-0100", OUTBOUND_TEST_EMAILS: "tester@example.com" };
  assert.equal(authorizeDelivery(env, "SMS", "+13035550100").recipient, "+13035550100");
  for (const recipient of ["3035550100", "+13035550101", "+13035550100 ext 2", "0013035550100", "+013035550100", "+13035550100,+13035550101"]) assert.throws(() => authorizeDelivery(env, "SMS", recipient));
  assert.throws(() => authorizeDelivery({ ...env, OUTBOUND_TEST_PHONES: undefined }, "SMS", "+13035550100"));
  assert.equal(normalizePhone("+44 20 7946 0018"), "+442079460018");
});

test("mailbox validation rejects recipient and header injection", () => {
  for (const value of [null, [], "Person <client@example.com>", "client@example.com\r\nBcc:evil@example.com", "a..b@example.com", ".a@example.com", "a.@example.com", "a@-example.com"]) assert.equal(normalizeEmail(value), null);
  assert.equal(normalizeEmail(" Client@Example.com "), "client@example.com");
});

test("email requires a usable practice reply mailbox and configured sender", () => {
  const valid = { RESEND_API_KEY: "test-key", RESEND_FROM: "Practice <send@example.com>", RESEND_REPLY_TO: "care@example.com" };
  assert.equal(requireEmailConfiguration(valid).replyTo, "care@example.com");
  for (const config of [{ ...valid, RESEND_API_KEY: "" }, { ...valid, RESEND_FROM: "" }, { ...valid, RESEND_REPLY_TO: undefined }, { ...valid, RESEND_REPLY_TO: "care@example.com,evil@example.com" }, { ...valid, RESEND_FROM: "Practice\r\nBcc:evil@example.com <send@example.com>" }]) assert.throws(() => requireEmailConfiguration(config));
});
