import { serveDisabledLegacyFunction } from "../_shared/disabled-legacy-function.ts";

serveDisabledLegacyFunction({
  slug: "enqueue-message",
  replacement: "send-email/send-sms",
});
