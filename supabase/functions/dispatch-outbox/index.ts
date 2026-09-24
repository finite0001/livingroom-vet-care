import { serveDisabledLegacyFunction } from "../_shared/disabled-legacy-function.ts";

serveDisabledLegacyFunction({
  slug: "dispatch-outbox",
  replacement: "dispatch-outbound-deliveries",
});
