import { serveDisabledLegacyFunction } from "../_shared/disabled-legacy-function.ts";

// Retired 2026-09-30: this legacy slug wrote inbound provider events alongside
// twilio-inbound-sms, so a dashboard pointed at both would record the same
// message through two paths. Inbound SMS is received by twilio-inbound-sms
// (TWILIO_INBOUND_WEBHOOK_URL) and delivery receipts by
// twilio-message-status-callback (TWILIO_STATUS_CALLBACK_URL); SMS sending is
// CloudTalk. This slug must not be registered in the Twilio console; it touches
// no database or secret, and TWILIO_WEBHOOK_URL is no longer read.
serveDisabledLegacyFunction({
  slug: "twilio-webhook",
  replacement: "twilio-inbound-sms (inbound SMS) and twilio-message-status-callback (delivery status)",
});
