# Approved live backend rollout — September 14, 2026

Owner authorized the backend rollout and live Lovable publication. Application target: `mgadheotkdnrsatfivjy`. Retained legacy Lovable Cloud: `ugpyjacqganaqtsiekay`. Separate staging `kothoqicubowyhwfsrte` is unchanged.

## Deployment and validation

- Backed up primary public/auth/storage schema, data and migration ledger privately before changes.
- Rehearsed the actual backup plus 58 pending migrations in an isolated temporary database; 111 staff/migration SQL assertions passed. Local role normalization was required; this is not proof of hosted ownership/default-privilege parity or a complete disaster recovery rehearsal.
- Applied the 58 pending migrations through the Supabase CLI, bringing the primary ledger from 52 to 110, through `20260914230000`.
- Deployed 30 Edge Functions, all ACTIVE; unfinished `send-provider-email` and `suggest-replies` were excluded. Deno frozen checks passed.
- Retained the sole legacy administrator's UUID and password hash, profile and active ADMIN role. Verified an actual Auth session, RLS profile read and migration workspace RPC; anonymous access was denied. Test session signed out. No invitations were sent.
- Legacy inventory contained eight app settings, one profile and one role; no clients, pets or storage objects. Primary had no clinical/client records to reconcile. Existing primary app settings were retained.
- Verified all 30 endpoints reject unsupported/unauthorized requests or report disabled configuration. No provider requests or messages were sent.
- Frontend lint/type/unit/build check passed (583 unit tests; existing AuthContext refresh warning). The preceding code checkpoint passed 42 browser tests.
- Updated the frontend public backend configuration, CLI project reference and exact password-reset redirect allowlist. Public signup remains disabled.

## Deliberately disabled

Stripe remains sandbox-only. Payments, refunds, collections, event processing and webhooks remain disabled. Outbound delivery remains disabled; public contact currently reports unavailable until separately commissioned. APP_ENV remains staging to retain the provider safety boundary even though the frontend is publicly published. No SMTP/provider commissioning is implied by this release.

## Publication and rollback

Lovable syncs `codex/lovable-publication`. The Cloud panel still administers the retained legacy backend; use the explicit target reference above for future migrations and deployments. Browser configuration contains only the target project's public publishable key.

If frontend rollback is necessary, restore the pre-cutover frontend environment from the preceding Git commit and republish in Lovable. Do not reset either database or remove migrated accounts. Reconcile any records written after cutover before routing writes back to the legacy backend. Private backups and credential-bearing verification artifacts remain outside the repository.

## Live publication evidence

Lovable published application commit `104bbbc` and displayed “Your website was updated.” Verified `https://livingroom-vet-care.lovable.app` renders the homepage, and `/hub` redirects to the working `/hub/login` screen without a session. Served `/assets/index-Cz0opQfS.js` contains the primary project reference, with neither the legacy nor separate staging reference. This validates the actual public artifact, not only a local build.

The Lovable security panel reports two broad SECURITY DEFINER execution warnings and a dependency summary; these were not auto-fixed or dismissed. Its Cloud panel remains attached to legacy. Runtime primary checks above establish the specific tested authorization boundaries, not a complete security audit.

## Custom domain checkpoint

The custom domain previously served a GoDaddy parked page. Registered `thelivingroom.vet` and `www.thelivingroom.vet` in Lovable with the requested www-to-root redirect. Saved the root A record from Parked to Lovable-provided `185.158.133.1`, TTL 600; authoritative DNS confirms the new address. No root AAAA record existed. Existing www CNAME points to the root and was retained. Fastmail MX, DKIM and sending records are unchanged.

The owner completed GoDaddy SMS verification. Authoritative DNS and public resolver 1.1.1.1 confirm TXT `_lovable` = `lovable_verify=69fd3dd2aa053fd7456850e222334ec22edb8ecba2d2a4f2049a6f4d3508448a`. Lovable marks `thelivingroom.vet` Live and Primary domain. HTTPS GET returns 200 with certificate verification enabled. The served `/assets/index-Cz0opQfS.js` contains the primary backend reference and neither legacy nor staging reference. Browser checks confirm the homepage renders and `/hub` redirects unauthenticated visitors to `/hub/login` with the sign-in form.

The root custom-domain launch is verified. The separate www address still awaits its own TXT verification: `_lovable.www` = `lovable_verify=7fab9dafe2dd2164e22c087b7604b92c8d208de2430fd1101924edcb2a4fd06b`. This record is prepared in GoDaddy; a second SMS identity verification is pending. Existing www CNAME already resolves through the root to the required hosting IP. No www HTTPS/redirect success is claimed yet.
