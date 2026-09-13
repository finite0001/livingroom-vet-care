# Hosted upgrade preflight — current history differs from earlier baseline

## Fresh read-only result at `8117a72`

The explicit-target dry run now exits with `LegacyDbPushMissingRemoteError`. Remote history contains51 migrations: the original47 plus payment3000, Stripe inbox3100, reconciliation observations3300 and payment collection3400. Local document migrations2800,2900 and3200 are absent ahead of the latest remote receipt;3500–4500 are also not recorded remotely at the latest 65-migration source baseline.

A separate direct catalog query confirmed51 receipts. `document_link_outbox_links` and `read_document_link_history(text,uuid)` are absent, so at least these gaps are actual missing objects, not merely missing history labels. Exact counts still found zero Auth users, Storage objects, clients and pets; this does not prove every application table is empty.

No deployment or repair was performed. The CLI's suggested `--include-all` flag is not itself evidence that backfilling is safe. The owner has been asked whether another session is deploying; authorship and the reason for the partial payment upgrade are unconfirmed. Coordinate the single deployment owner, compare applied definitions to their reviewed source, snapshot the current state and review interleaved migration dependencies before a new explicit dry run or application. Do not reset the database, mark absent migrations applied, or replay applied payment migrations to force history alignment.

The earlier successful fourteen-migration preflight below is historical and no longer describes the current pending set. Existing frontend configuration and preview safeguards remain unchanged.

## Earlier preflight after lab provenance


This is a read-only preflight against dedicated project `mgadheotkdnrsatfivjy`, using repository checkpoint `7c5def9`. It does not record a deployment or authorize public cutover.

The live catalog still contains 47 migration receipts, latest `20260913270000`. Exact counts found zero Auth users, Storage objects, clients and pets. These specific counts do not establish that every application table is empty.

Supabase CLI2.115.0 completed this command successfully with the dedicated target explicit and vault updates excluded:

```sh
supabase db push --project-ref mgadheotkdnrsatfivjy --skip-vault --dry-run
```

It reported fourteen pending migrations, in repository order: document links2800, document SMS2900, payment ledger3000, Stripe inbox3100, document history3200, reconciliation observations3300, payment collection3400, reconciliation resolution3500, capability persistence3600, payment delivery3700, reconciliation discovery3800, delivery history3900, audited retry4000 and lab provenance4100. No seeds or role files were included. There was no missing-history/reconciliation error and no migration was applied.

The original Lovable backend was not targeted. Frontend configuration still requires a separate commissioned preview backend; the dedicated project remains reserved for eventual production. See [deployment configuration](deployment-environment.md).

Before the coordinated upgrade, revalidate the exact approved source, all migration history and current data, preserve new private recovery exports, and review pending migrations and compatible Edge handlers together. The batch includes changes to payment reconciliation uniqueness and retry constraints, so a successful dry run alone does not prove application compatibility. Re-run the dry run if the source or hosted history changes. Do not infer provider activation, clinician approval, staff acceptance or backup coverage from this result.

## Isolated gap rehearsal — 2026-09-13 source baseline

The guarded local rehearsal passed using the65-migration source at `1067294` with the new runner changes. It recreated the observed51-version subset, created synthetic clinical/Auth/Storage/invoice/credit/stock records, confirmed ordinary local push refused the three older gaps, then applied all14 missing versions with explicit local `--include-all`. All captured rows except migration history remained identical.

A separate fresh installation applied all65 migrations in canonical order. Every public function definition, security-definer flag, configuration, effective anon/authenticated/service-role execution permission and noninternal public trigger binding matched the backfilled source. The upgraded database and physical private Storage were then backed up and restored into that separate destination. Fresh login, original IDs/rows, signed history, private bytes, denied anonymous/public access and immutable writes passed. Both generated projects and volumes were verified removed.

Protected evidence remains outsideGit at `/var/folders/j9/dv101nxj5_xd3rjcjkq6_xd40000gn/T/lrv-restore-synthetic-oju0xcbk/result.json`. Backup took12.54s, restore/verification5.70s and complete rehearsal123.92s. These are local observations, not hosted recovery objectives.

- Executed runner SHA256: `1dbcf20eb23d23822ae7db05aabf7b5f166debac9eb0b8dc624533f7ebcf9f66`
- Executed fixture SHA256: `24b5d352287ae723c42c9bc11069eb08c7a1e71d57aa85635a3bd6f5415109d1` (subsequent formatting only wraps one console message).
- Database archive SHA256: `7a5323a7340c863c774344f8cbce42707eb7d1c04cb3d02ff1cc9ba2a4adc3d0`

This closes the local migration-order rehearsal gap. It does not compare actual hosted function bodies, establish deployment ownership, authorize hosted application or test real provider delivery. New payment/scheduler/retry tables are included in the schema comparison/restore but are not populated by this clinical restore fixture. Re-run hosted read-only preflight and coordinate the deployment owner before preparing a hosted backfill. [Runner instructions](../scripts/restore-rehearsal/README.md) describe the explicit mode and refusal to treat a resumed backup as a fresh upgrade.

## Direct hosted routine comparison after PR100

A fresh read-only query against `mgadheotkdnrsatfivjy` still found the same 51 receipts and zero Auth users, clients, pets and Storage objects. The local recreation of that exact migration subset was compared with the hosted public application catalog using the committed routine-inventory SQL. All 259 function definition hashes, owners, security-definer settings and configurations matched. All 168 trigger definitions and enable modes matched. No application routine was missing or extra.

Six effective execution-grant differences were found:

| Function | Expected role access | Extra hosted access |
| --- | --- | --- |
| `admin_set_staff_active(uuid,boolean)` | authenticated | anon, service_role |
| `admin_update_staff_role(uuid,user_role)` | authenticated | anon, service_role |
| `clock_in()` | authenticated | service_role |
| `clock_out()` | authenticated | service_role |
| `review_ezyvet_snapshot(uuid,text,uuid,uuid,text)` | authenticated | service_role |
| `get_consent_submission(text)` | anon, authenticated | service_role |

The source migrations revoke PUBLIC but omit some direct-role revocations; this is consistent with grants inherited from environment-specific defaults when the functions were created. It does not establish who applied those defaults. None of the pending migrations through4500 corrects these grants. The first five functions retain internal active-staff/ADMIN and actor checks; consent lookup intentionally permits an unexpired bearer token anonymously. This comparison does not demonstrate an anonymous privilege escalation. An additive explicit-grant correction with regression evidence is being prepared; no hosted permission was changed.

The stronger local backfill/restore rehearsal passed in122.15s and verified cleanup, now also comparing function owners and trigger enable modes against canonical installation. Five comparison regression tests cover matching input and counterexamples involving body/authority/grant changes, disabled/replica-only triggers, changed history, missing routines and malformed inventories.

Protected evidence: `/var/folders/j9/dv101nxj5_xd3rjcjkq6_xd40000gn/T/lrv-restore-synthetic-andmkoob/`.

- Executed runner SHA256: `5f3c63eef06cc840927f49f91a0e50b1238b7671c3834be721beb8ec4448efa4`
- Initial local inventory SHA256: `c09cf2bf0d740aed1507e0026acb6e1cf5f0d50e8aacf4273c29b7d863680078`
- Hosted inventory SHA256: `72d7b8bba46d7b34156aa464f77e0b05595db902c6f94c47b662bc5ff0aa27be`

The inventory covers public application functions/triggers, not all RLS policies, table constraints, role memberships or managed schemas. Actual hosted correction, deployment ownership, recovery exports and final explicit dry run remain necessary before upgrade.
