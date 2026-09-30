import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SMS_BLOCKED_FALLBACK, formatConsentDate, smsBlockedReason, smsBlockedText, smsChipText, smsResumedText,
} from "../../src/hub/features/communications/sms-consent-status.ts";
import type { SmsConsentStatus } from "../../src/hub/features/communications/sms-consent-status.ts";

const PHONE = "+18059076214";
const blocked = (overrides: Partial<SmsConsentStatus>): SmsConsentStatus =>
  ({ can_message: false, phone_number: PHONE, ...overrides });

test("dates are shown in the practice time zone", () => {
  // 03:00 UTC on Oct 1 is still Sep 30 in Denver.
  assert.equal(formatConsentDate("2026-10-01T03:00:00Z"), "Sep 30, 2026");
  assert.equal(formatConsentDate(null), null);
  assert.equal(formatConsentDate("not a date"), null);
});

test("a STOP reply is named with its date and how to resume", () => {
  const status = blocked({ block_reason: "sms_stop", blocked_since: "2026-09-30T18:00:00Z" });
  assert.equal(smsBlockedReason(status), "client replied STOP on Sep 30, 2026");
  assert.equal(smsBlockedText(status), "Client replied STOP on Sep 30, 2026. Texts resume if they reply START, or when staff record new explicit consent.");
  assert.equal(smsChipText(status), "SMS blocked: client replied STOP on Sep 30, 2026");
});

test("carrier and other suppressions say consent does not lift them", () => {
  assert.equal(
    smsBlockedText(blocked({ block_reason: "undeliverable", blocked_since: "2026-09-29T18:00:00Z" })),
    "SMS is blocked: carrier reported the number undeliverable on Sep 29, 2026. Recording consent does not lift this.",
  );
  assert.match(smsBlockedText(blocked({ block_reason: "complaint" }))!, /does not lift this\.$/);
  assert.match(smsBlockedText(blocked({ block_reason: "suppressed" }))!, /do-not-text list\. Recording consent does not lift this\.$/);
});

test("withdrawals, missing consent and shared numbers are explained", () => {
  assert.equal(smsBlockedText(blocked({ block_reason: "staff_opt_out", blocked_since: "2026-09-30T18:00:00Z" })),
    "SMS consent withdrawn by staff on Sep 30, 2026. Record new explicit consent to resume texts.");
  assert.equal(smsBlockedText(blocked({ block_reason: "consent_withdrawn", blocked_since: "2026-09-30T18:00:00Z" })), "SMS consent withdrawn on Sep 30, 2026.");
  assert.equal(smsBlockedText(blocked({ block_reason: "consent_missing" })), "No SMS consent on record for this number.");
  assert.equal(smsBlockedReason(blocked({ block_reason: "consent_missing" })), "no SMS consent on record for this number");
  assert.match(smsBlockedText(blocked({ block_reason: "shared_phone" }))!, /shared by more than one household/);
  assert.equal(smsBlockedText(blocked({ block_reason: "no_phone", phone_number: null })), "No valid primary phone number.");
});

test("older servers without a reason fall back to the generic text", () => {
  assert.equal(smsBlockedText(blocked({})), SMS_BLOCKED_FALLBACK);
  assert.equal(smsChipText(blocked({})), "SMS blocked");
  assert.equal(smsBlockedReason(blocked({})), null);
});

test("resumption by START keyword names the keyword, date and the STOP it followed", () => {
  const status: SmsConsentStatus = {
    can_message: true, phone_number: PHONE, block_reason: null,
    last_resumed: { source: "sms_keyword", keyword: "START", at: "2026-09-30T19:00:00Z", by: null, after_reason: "cloudtalk_sms_stop", after_since: "2026-09-30T18:00:00Z" },
  };
  assert.equal(smsResumedText(status), "Texts resumed: client replied START on Sep 30, 2026 (after STOP on Sep 30, 2026)");
  assert.equal(smsChipText(status), "Texts resumed");
  assert.equal(smsBlockedText(status), null);
});

test("resumption by staff names who re-consented", () => {
  const status: SmsConsentStatus = {
    can_message: true, phone_number: PHONE,
    last_resumed: { source: "staff_consent", keyword: null, at: "2026-09-30T20:00:00Z", by: "Jamie Rivera", after_reason: "staff_sms_opt_out", after_since: "2026-09-29T20:00:00Z" },
  };
  assert.equal(smsResumedText(status), "Texts resumed: re-consented by Jamie Rivera on Sep 30, 2026");
  assert.equal(smsResumedText({ ...status, last_resumed: { ...status.last_resumed!, by: null } }), "Texts resumed: re-consented by staff on Sep 30, 2026");
});

test("a resumption is not shown while texting is blocked again", () => {
  const status = blocked({
    block_reason: "sms_stop", blocked_since: "2026-10-01T18:00:00Z",
    last_resumed: { source: "sms_keyword", keyword: "START", at: "2026-09-30T19:00:00Z", by: null, after_reason: "cloudtalk_sms_stop", after_since: "2026-09-30T18:00:00Z" },
  });
  assert.equal(smsResumedText(status), null);
  assert.equal(smsChipText(status), "SMS blocked: client replied STOP on Oct 1, 2026");
});

test("consent that was never blocked shows the plain chip", () => {
  assert.equal(smsChipText({ can_message: true, phone_number: PHONE }), "SMS consent on file");
});
