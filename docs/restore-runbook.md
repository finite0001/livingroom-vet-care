# Backup and restore procedure

This is an operational runbook, not a claim that production restoration has been rehearsed. A repeatable synthetic local rehearsal restores an actual database archive and separate physical private Storage files; see [the local procedure](../scripts/restore-rehearsal/README.md). Hosted backup coverage, recovery objectives and production restore acceptance remain launch gates.

1. Identify the exact source project, backup timestamp, database backup coverage and private Storage object inventory. Set recovery objectives with the practice owner.
2. Restore into an isolated destination with outgoing messages and scheduled jobs disabled. Do not restore over a live practice as an experiment.
3. Apply required schema versions and restore application rows, preserving IDs and relationships. Restore Storage files separately and compare checksums/object counts; a database backup alone is not proof that file bytes were restored.
4. Validate client/patient/encounter/document relationships, invoice totals, stock ledger, signed-note history, Auth identity mapping and RLS using dedicated test accounts.
5. Reconfigure server secrets, Auth redirect/SMTP settings, provider webhooks and jobs. Do not copy live delivery enablement blindly.
6. Exercise a synthetic login and complete visit; check files, audit history and failed-job visibility. Record elapsed restoration time and data completeness.
7. For an incident cutover, freeze writers and dispatchers, reconcile records created since the backup, switch endpoints, then enable a single worker set. Keep the old system read-only until reconciliation is complete.
8. Rollback after new writes requires reconciliation back to the old destination; simply changing an environment URL can lose those writes. Record the decision owner and exact transition time.

## Local rehearsal evidence

The isolated rehearsal creates synthetic signed SOAP/addendum history, a private uploaded original, an issued invoice/credit and stock movements. It restores into a separately named destination, verifies fresh Auth login and unchanged IDs/relations/audit history, checks exact original bytes through private Storage and signed URLs, and proves immutable-history and anonymous-access controls remain effective. It excludes Edge/runtime workers and provider credentials by construction; it does not claim a hosted disabled-worker probe. Artifacts contain disposable credentials and must remain in the protected temporary directory, outside Git.

An observed platform-baseline restore failure is now handled explicitly: inherited realtime partition constraints cannot be individually dropped by `pg_restore --clean`. The runner drops only the isolated destination realtime schema before restoring the complete archive with errors fatal and the restore transaction atomic. Auth, REST and Storage must all become healthy before verification. No archive entries are skipped to obtain a pass.

### Completed synthetic rehearsal — September 12, 2026

A fresh source and a separate fresh destination completed the procedure successfully. Backup took 12.93 seconds; database/file restore plus verification took 6.21 seconds after destination startup; total time including verified cleanup was 123.6 seconds including both local stack starts and checked cleanup. These tiny-fixture timings are observations, not production recovery objectives.

Verified evidence:

- Exact captured application rows, IDs, relationships, signed SOAP/addendum, audit entries, migration ledger, Auth identity/password mapping and Storage object metadata survived restoration.
- Fresh local login, private original download and signed-URL download succeeded. The 78-byte synthetic original matched SHA-256 `1fc62aca512802276c79f6f3fc12c6dc743239fde62ad71938e6b698dc1d9c5e`; the full physical Storage inventory also matched.
- Issued invoice charges remained 9000 cents, the immutable accounting credit 500 cents, and the stock ledger balance 8 units.
- Anonymous/public access and ready-original replacement/removal failed or affected zero rows. Clinical/billing/stock mutations affected no rows; privileged signed-history/addendum/ledger rewrites with a verified active synthetic actor raised SQLSTATE23514 and their exact immutable-history messages. Final captured history remained unchanged.
- Outbox empty; pg_cron absent; no Edge runtime or provider credentials. Every stop command succeeded, and resource inspection confirmed generated containers and volumes absent before result.json or PASS was written. Existing local projects and cloud projects were untouched.

Protected evidence is retained outside Git in the operator's temporary `lrv-restore-synthetic-e4rdfqms` directory. Database archive SHA-256: `f3154b9e0228e17af91b84b1f2cc61cb954edb472dcecf6db3c484188376a4bf`. The result includes exact runner/fixture hashes so this pre-commit local run can be tied to the tested source. Earlier retained diagnostic artifacts preserve the initial partition-constraint failure and successful destination-only retry; neither the backup nor restore errors were filtered to manufacture a pass.
