import { serveDisabledLegacyFunction } from "../_shared/disabled-legacy-function.ts";

serveDisabledLegacyFunction({
  slug: "resend-webhook",
  replacement: "resend-delivery-webhook",
});
