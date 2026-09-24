import { serveDisabledLegacyFunction } from "../_shared/disabled-legacy-function.ts";

serveDisabledLegacyFunction({
  slug: "twilio-webhook",
  replacement: "twilio-message-status-callback/twilio-inbound-sms",
});
