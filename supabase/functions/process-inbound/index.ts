import { serveDisabledLegacyFunction } from "../_shared/disabled-legacy-function.ts";

serveDisabledLegacyFunction({
  slug: "process-inbound",
  replacement: "twilio-inbound-sms",
});
