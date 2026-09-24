import { serveDisabledLegacyFunction } from "../_shared/disabled-legacy-function.ts";

serveDisabledLegacyFunction({
  slug: "public-contact",
  replacement: "direct contact_submissions insert guarded by database trigger",
});
