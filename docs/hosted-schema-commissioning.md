# Dedicated hosted schema commissioning — 2026-09-13 UTC

The dedicated project `mgadheotkdnrsatfivjy` / `livingroom-vet-care` in the approved Camp Sequoia Lake organization now contains all 47 repository migrations through `20260913270000_invoice_email`. This is schema commissioning, not a frontend release, provider activation, clinical acceptance or completed backup/restore rehearsal.

## Preflight and target

Source checkpoint: `191c0fa`, including invoice backend `69e3c20` and UI `48f2dd5`. PR42–44 passed frontend, database and Edge CI before commissioning. Supabase reported ACTIVE_HEALTHY, Postgres 17.6.1.166, US West. Hosted history had the exact first 16 repository versions through clinical core; no receipt reconciliation or replay was needed.

Exact counts showed no Auth users, profiles, clients, pets or Storage objects. Existing private buckets were client-files, message-attachments and voicemails; patient-documents did not exist. The SHA-256 digest function was available. Independent source review and the CLI dry run agreed on 31 pending migrations in chronological order, with no provider calls, cron schedules or secret configuration in that batch.

All CLI operations named the dedicated project explicitly because the checked-in config still identifies the original Lovable backend. No command targeted that original backend. Use CLI operations sequentially: simultaneous login-role initialization can invalidate another operation's temporary login credentials. One initial schema-dump attempt failed authentication during parallel preflight; the sequential retry succeeded before any migrations were applied.

## Private pre-change exports

Public schema and data exports are retained locally under `~/.local/share/livingroom-vet/commissioning/20260913-pre-schema/`, outside Git, with mode 0600. They contain no Auth or Storage object export; those populations were verified empty. These files are recovery inputs, not proof of a complete managed backup or successful restoration.

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| public-schema.sql | 141519 | afd41af3c5c1681e19deedc6347a44ef90482283255a437dd6d67b31d0df8323 |
| public-data.sql | 5590 | 1c1c6d26010f84ad85ca54c43b40d1785b6d8cc625f45601ae2fd4438a6f298a |

## Applied operation and live verification

Supabase CLI 2.115.0 executed:

```sh
supabase db push --project-ref mgadheotkdnrsatfivjy --skip-vault --dry-run
supabase db push --project-ref mgadheotkdnrsatfivjy --skip-vault --yes
supabase db push --project-ref mgadheotkdnrsatfivjy --skip-vault --dry-run
```

The middle command applied all 31 pending migrations successfully; no seed or role files were included. The final dry run reported `upToDate: true` and zero pending migrations. CLI recorded the exact repository versions, including the existing lexically ordered versions beyond hour 23.

Live catalog and exact count queries confirmed:

- 47 migration receipts; latest version 20260913270000.
- 120 public tables; zero public tables without row-level security.
- Only app_settings has rows: eight. Every other public table is empty, including the outbox, clinical release policy and certificate issuer registry.
- Auth users and Storage objects remain zero.
- patient-documents is private, capped at 20,971,520 bytes, allowing PDF/JPEG/PNG only.

RLS being enabled does not alone establish that every policy or hosted user workflow is correct. The isolated regression suite remains separate evidence; no local fixture or immutable synthetic clinical record was inserted into this hosted project.

## Remaining commissioning work

Deploy compatible reviewed Edge handlers explicitly, then verify hosted gateway/authentication and private Storage behavior. Do not bulk-deploy legacy send-provider-email or suggest-replies. Provider credentials, Auth SMTP, staff bootstrap, separate preview environment, frontend environment switch, custom-domain cutover, monitoring and restore rehearsal remain pending. Existing outbound-disabled settings were not changed; no provider message, payment, real invitation or clinical approval was created. DNS sending verification remains separately pending user approval.
