import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SMS_CONSENT_DISCLOSURE,
  SMS_CONSENT_PHONE_REQUIRED,
  SMS_CONSENT_PRIVACY_PATH,
  SMS_CONSENT_TERMS_PATH,
  smsConsentPhoneError,
} from "../../src/features/contact/sms-consent.ts";
const read = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20260927120000_contact_sms_consent.sql");
test("carrier-reviewed disclosure is exact and identical in the page and database", () => {
  assert.equal(
    SMS_CONSENT_DISCLOSURE,
    "I agree to receive text messages from The Living Room Vet at the phone number provided, including appointment reminders, visit follow-ups, prescription notices, and replies to my questions. Message frequency varies. Message and data rates may apply. Reply STOP to opt out or HELP for help. Consent is not a condition of service. See our Privacy Policy and Terms.",
  );
  assert.ok(migration.includes(`'${SMS_CONSENT_DISCLOSURE}'::text`));
  assert.ok(!SMS_CONSENT_DISCLOSURE.includes("'"));
});
test("disclosure links resolve to the published policy sections", () => {
  const anchor = (title: string) => title.replace(/\s+/g, "-").toLowerCase();
  assert.equal(SMS_CONSENT_PRIVACY_PATH, `/privacy#${anchor("Text Messages")}`);
  assert.equal(SMS_CONSENT_TERMS_PATH, `/terms#${anchor("Text Message Program")}`);
  assert.match(read("src/pages/Privacy.tsx"), /title: "Text Messages"/);
  const terms = read("src/pages/Terms.tsx");
  assert.match(terms, /title: "Text Message Program"/);
  assert.match(terms, /checking the optional text message consent box/);
});
test("consent without a phone number is a phone-field error; no consent needs no phone", () => {
  assert.equal(smsConsentPhoneError({ phone: "", sms_consent: true }), SMS_CONSENT_PHONE_REQUIRED);
  assert.equal(smsConsentPhoneError({ phone: "  ", sms_consent: true }), SMS_CONSENT_PHONE_REQUIRED);
  assert.equal(SMS_CONSENT_PHONE_REQUIRED, "Enter a mobile number to receive texts");
  assert.equal(smsConsentPhoneError({ phone: "720-555-0100", sms_consent: true }), null);
  assert.equal(smsConsentPhoneError({ phone: "", sms_consent: false }), null);
});
test("migration stores server-owned consent evidence under CHECK and immutability", () => {
  assert.match(migration, /add column sms_consent boolean not null default false/);
  assert.match(migration, /add constraint contact_submissions_sms_consent_check/);
  assert.match(migration, /or new\.sms_consent_text is distinct from old\.sms_consent_text/);
  assert.match(migration, /case when consent then contact_sms_consent_disclosure\(\) end,case when consent then now\(\) end/);
  assert.doesNotMatch(migration, /grant (insert|update)[^;]*contact_submissions/i);
});
