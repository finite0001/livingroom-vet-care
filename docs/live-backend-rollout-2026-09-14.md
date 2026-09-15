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

Live publication verification is recorded after the deployment completes.
