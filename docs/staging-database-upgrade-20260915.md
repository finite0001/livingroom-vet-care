# Staging database upgrade — September 15, 2026

Upgraded `kothoqicubowyhwfsrte` from 99 to 110 canonical migrations, through `20260914230000`, after restoring its actual backup and rehearsing the eleven pending migrations. This enables the merged ezyVet migration reconciliation UI and the associated importer authorization checks in staging. The public/primary project was not deployed in this checkpoint.

## Backup and restored-data rehearsal

The protected custom-format PostgreSQL archive covers public, auth, storage and the migration ledger in one snapshot (2,582,504 bytes). It remains outside Git under `~/.codex/private/lrv-staging-20260915`, with owner-only permissions. Initial interrupted Docker dump files were incomplete and were not used. The successful native archive was restored into an isolated local database owned by postgres; local extension prerequisites were supplied by the Supabase PostgreSQL 17.6 image.

All eleven frozen migration hashes match the repository and deployment candidate. The restored-data rehearsal passed 21 SQL suites / 1,095 assertions and preserved fingerprints for all 227 preexisting tables. The rehearsal database was removed. This is tested data preservation, not a blanket claim of ownership/default-privilege parity or a backup of external provider configuration. Staging had no Storage objects.

## Concurrency harness correction

The attachment-originals harness reused one eight-second deadline for both observing the holder and observing its waiter. A slow holder startup could exhaust the waiter observation window. Each phase now has its own eight-second window; the actual blocking-PID check, authorization callback order, result assertions and ten-second completion timeout remain intact.

Two deterministic tests pass, and removing the reset reproduces the original failure. An independent read-only review found no issues. Two earlier real runs failed to observe contention and are not counted as passes. The corrected run used native psql/pg_dump against the same local Supabase container, preserving every default database assertion: **1,135 SQL assertions and 318 contention checks passed**, exit 0. Its owned database and sessions were independently verified absent afterward. The local machine experienced substantial load and temporary PostgreSQL latency during the run. No provider calls or physical Storage operations were tested.

## Hosted verification

Supabase CLI applied exactly the eleven rehearsed migrations using an explicit staging project reference, without seeds or roles. The resulting ledger contains 110 entries through `20260914230000`.

- Saved client, pet, appointment, invoice, invoice item, catalog product, profile and staff-role table fingerprints match the pre-upgrade values.
- The existing active administrator can list migration history; an authenticated identity without administrator access receives SQLSTATE `42501`.
- All four new migration tables have RLS enabled and no direct SELECT/INSERT/UPDATE/DELETE grants for anon, authenticated or service_role. Anonymous history execution and service-role execution of the internal claim core remain denied.
- Import runs, migration manifests, attempt events, communication outbox and payment-provider profiles remain empty.
- A fresh comparison of 16 deployed files across ezyvet-import v7, capture-ezyvet-attachment v2 and retrieve-reviewed-ezyvet-original v2 matches merged source. Those functions required no redeployment.
- After browser connectivity recovered, the signed-in administrator opened **Your saved migrations** at `/hub/tools/ezyvet` on the protected staging site and received the expected empty result. No source import was started.

Machine-readable hashes and counts are in [the evidence receipt](evidence/staging-99-to-110-20260915.json). The prior [frontend deployment receipt](pilot-staging-deployment-20260915.md) describes the earlier 99-migration checkpoint; this upgrade supersedes that database status.

## Remaining acceptance work

Run the controlled read-only ezyVet source acceptance workflow before relying on imported production records. Stripe sandbox payment/refund acceptance still needs a working practice account connection and configuration. Client email/SMS delivery commissioning, Antech onboarding and Dr. Susan Edler's clinical-form review remain separate launch gates.
