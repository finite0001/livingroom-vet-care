# Hosted upgrade preflight after lab provenance

This is a read-only preflight against dedicated project `mgadheotkdnrsatfivjy`, using repository checkpoint `7c5def9`. It does not record a deployment or authorize public cutover.

The live catalog still contains 47 migration receipts, latest `20260913270000`. Exact counts found zero Auth users, Storage objects, clients and pets. These specific counts do not establish that every application table is empty.

Supabase CLI2.115.0 completed this command successfully with the dedicated target explicit and vault updates excluded:

```sh
supabase db push --project-ref mgadheotkdnrsatfivjy --skip-vault --dry-run
```

It reported fourteen pending migrations, in repository order: document links2800, document SMS2900, payment ledger3000, Stripe inbox3100, document history3200, reconciliation observations3300, payment collection3400, reconciliation resolution3500, capability persistence3600, payment delivery3700, reconciliation discovery3800, delivery history3900, audited retry4000 and lab provenance4100. No seeds or role files were included. There was no missing-history/reconciliation error and no migration was applied.

The original Lovable backend was not targeted. Frontend configuration still requires a separate commissioned preview backend; the dedicated project remains reserved for eventual production. See [deployment configuration](deployment-environment.md).

Before the coordinated upgrade, revalidate the exact approved source, all migration history and current data, preserve new private recovery exports, and review pending migrations and compatible Edge handlers together. The batch includes changes to payment reconciliation uniqueness and retry constraints, so a successful dry run alone does not prove application compatibility. Re-run the dry run if the source or hosted history changes. Do not infer provider activation, clinician approval, staff acceptance or backup coverage from this result.
