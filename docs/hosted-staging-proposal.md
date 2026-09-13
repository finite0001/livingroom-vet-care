# Hosted staging — database and Edge stack initialized

On September 13, 2026, the owner asked whether the existing project could serve testing and authorized a separate project if recommended. Separate staging was recommended to isolate synthetic records and provider testing from future live operations. Supabase requoted and confirmed the additional **$10/month** before creation.

- Project: `livingroom-vet-staging` (`kothoqicubowyhwfsrte`).
- Organization: Camp Sequoia Lake (`bzohhpylbpjkopbmrzmh`), sharing organization billing and administration.
- Region: `us-west-1`; created September 13, 2026; observed `ACTIVE_HEALTHY`.
- Future-production project `mgadheotkdnrsatfivjy` and original Lovable project `ugpyjacqganaqtsiekay` remain distinct.

## Verified initialization

The exact 71 migration files from PR107 commit `f1c7764` were copied into a private, explicitly linked CLI directory. File hashes were checked before applying; hosted migration receipts now contain all 71 versions through `20260913510000`.

Read-only hosted checks found zero Auth users, clients, pets and Storage objects. All four Storage buckets are private. Record-release and reminder-automation policy tables are empty. No clinical acceptance was recorded.

Auth public settings confirm public signup disabled and email autoconfirm disabled. Applied configuration also disables anonymous signup, enables TOTP enrollment/verification and requires email confirmation. The Auth site remains a localhost placeholder with no additional redirects until the protected frontend origin is commissioned. No staff invitations were sent.

## CLI findings

Supabase CLI 2.115 initially failed the first migration because its temporary connection could not resolve `extensions.gen_random_bytes`. The failed migration rolled back. Running from the private linked directory with `PGOPTIONS='-c search_path=public,extensions'` passed the exact dry run and full push. Historical migrations were not edited, and migration receipts were not repaired.

`supabase config push` applies changes immediately; it is not a review command, and piping a negative response did not prevent application. Also, the attempted `--workdir` invocation did not apply the intended private Auth configuration. Executing with the private directory as the actual process working directory applied the intended closed configuration, subsequently verified through the live Auth settings endpoint. The brief default configuration occurred while the project had no users or records.

Server flags were successfully set explicitly on staging: `APP_ENV=staging`, `OUTBOUND_DELIVERY_MODE=disabled`, and `REMINDER_SCHEDULER_ENABLED=false`. No mail/payment provider keys were installed. The three recovered ezyVet client/site settings were subsequently saved; authentication is incomplete and imports remain disabled.

## Remaining commissioning

Protected frontend deployment, its exact APP_URL/Auth redirects and hosted workflow acceptance remain pending. Provider credentials and callbacks, SMTP/mailboxes, staff access and controlled payment/import/delivery tests are not commissioned. The preview build guard must continue rejecting the future-production and original Lovable references.

The owner confirmed authorized ezyVet account and API access are available. The source is GreenTree’s production ezyVet site. Client ID, secret and site UID are stored in staging; existing credentials have passed production OAuth and a bounded contact read without a partner ID; resource sample/mapping acceptance remains pending. No real patient import has run.

Staging creation does not approve clinical forms, authorize client messages, configure mailboxes or permit public cutover. Dr. Susan Edler’s clinical review and provider acceptance remain separate requirements.

## Existing project concurrency check

The owner is unsure whether another session deployed to the future-production project. A fresh read-only check still finds 51 migration receipts through `20260913340000`, including 3000/3100/3300/3400 and excluding 2800/2900/3200. This matches the prior observation but does not establish the deployment actor or prove no other session is active. Keep new deployment work explicitly targeted to staging; do not backfill the existing project based on assumed ownership.

The owner identified Vet Connect Hub as the existing ezyVet setup. See the [connection handoff](ezyvet-existing-connection-handoff.md) for repository evidence and secret-name mapping.

## Edge deployment and live boundary checks

Deployed 28 functions from the unchanged PR107 source (`f1c7764`) using an isolated CLI directory, explicit staging project reference and the repository’s per-function JWT settings. Live management inspection confirms all 28 ACTIVE at version 1. `invite-staff` is excluded until private mailbox/Auth SMTP acceptance; `suggest-replies` is excluded because its AI provider is uncommissioned. No provider callbacks or schedules were registered.

All 28 endpoints received a single anonymous empty POST: 21 returned401 and seven returned503 (unconfigured public contact, provider webhooks, document retrieval and public payment endpoints). These are negative boundary checks, not staff/provider workflow acceptance. The protected retired send handlers returned401 at the gateway, so this check does not claim their internal410 behavior was exercised.

Post-deployment SQL confirms zero Auth accounts, clients, pets, Storage objects and communication outbox rows. Release and reminder policy tables remain empty; pg_cron is not installed. The live deployment manifest is recorded in `staging-edge-manifest.json`.
