# Protected frontend preview — September 13, 2026

Preview: https://livingroom-vet-care-ghauhti0c-daves-projects-e0da43ba.vercel.app

Vercel deployment `dpl_5tny8bc9T2rroXczmE9X6z33Dewm` is READY, target `staging` (preview environment). Project `prj_Dn1g9AIBEth78S7V3pqhYHueICl7` belongs to `daves-projects-e0da43ba`. Source is the current implementation stack plus payment trigger hardening (`d9dd2bb`), with the deployment diagnostic/build and ignore-file changes in this increment.

## Configuration

- Preview-only backend: `kothoqicubowyhwfsrte`, its exact HTTPS Supabase origin and its active publishable browser key. No provider or service-role key is in browser configuration.
- Staging preflight found 72 migrations through5200, zero Auth users, clients and pets. This deployment did not change the database.
- Vercel Authentication protection remains `all_except_custom_domains`; no custom domain is assigned. An unauthenticated request returns302; authenticated CLI requests use Vercel's generated project bypass credential, which is not recorded here.
- Automatic Git deployment was disconnected immediately after project linking automatically connected the repository. No production environment variables were set, no main merge occurred, and neither the Lovable site nor domain DNS changed.
- Automatic system-variable exposure is disabled. Preview explicitly sets `VERCEL_ENV=preview`.
- Vercel still injects `VITE_VERCEL_OBSERVABILITY_CLIENT_CONFIG`; the guarded build removes that specific process setting before Vite environment resolution. The application does not opt its private pages into this browser telemetry configuration. Unknown public settings remain rejected, with sanitized variable names but never values in the diagnostic.

## Verified evidence

- All six deployment configuration tests pass, including real build-entry rejection of repository fallback and credential-value redaction.
- Hosted guarded build reports `Verified preview backend configuration. Contact intake disabled.` and completes successfully.
- The served entry bundle includes `/payment/return`, `/payment/cancel` and the separate PaymentPage chunk; its Supabase origin is exclusively `https://kothoqicubowyhwfsrte.supabase.co`. The old backend reference and excluded telemetry setting are absent from that entry bundle.
- Authenticated HTTP requests to `/payment/return`, `/payment/cancel` and `/hub/login` return200. The return route has `Cache-Control: private, no-store`, `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex, nofollow, noarchive`.
- PR111's frontend, database and Edge checks all pass in run34778062210. Those checks cover its source revision, not this subsequent deployment-script change.

## Platform findings

The initial CLI `--target preview` attempt became a first production deployment. The environment guard rejected it because production settings were absent; no aliases were assigned. Explicit `--target staging` creates the intended preview. Earlier preview attempts failed closed on the unexpected injected telemetry variable. The documented READY deployment supersedes those failed attempts.

## Remaining acceptance

HTTP and bundle inspection do not establish rendered staff or payment workflow acceptance. Staff accounts, exact staging Auth return settings, controlled provider integration, clinician review and all commercial-readiness gates remain pending. Stripe sandbox configuration remains on owner-selected `mgadheotkdnrsatfivjy`; this preview neither moves its keys to staging nor enables payments. Keep the public domain cutover separate until the full release is accepted.
