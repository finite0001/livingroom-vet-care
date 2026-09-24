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


### Current-stack rehearsal — September 13, 2026 UTC

A fresh rehearsal at `d26517703e6c9c2e3cb7687f5b0e67b9e34bebbe` completed source backup, separate destination restore, verification and checked cleanup successfully. The captured/restored migration ledger contains all65 repository migrations, latest `20260913450000`. Neither the existing foundation stack nor a hosted project was reset.

Fresh local login, identical captured rows/IDs, signed SOAP/addendum,9000-cent invoice,500-cent credit,8-unit stock balance, private78-byte original checksum, anonymous/public denial and immutable-history checks all passed. The complete physical file inventory matched. Outbox remained empty and cron absent. Every generated container/volume was removed before PASS. This fixture does not populate the newer payment, scheduler-run or outbox-retry tables; full schema restoration is verified, while populated evidence for those workflows remains outside this rehearsal's claims.

Backup took12.43seconds; restore/verification after destination startup took5.08seconds; total including starts and checked cleanup was116.88seconds. These tiny synthetic timings are not a promised production RTO/RPO. Protected artifacts remain outsideGit at the operator's temporary `lrv-restore-synthetic-ggu8etoj` directory; do not publish its credentials or database archive.

- Database archive SHA-256: `d7a61a54f983755f6e7ecc7079cc37b68549f080396dbf9c6f397ce091d3e3dd`.
- Runner SHA-256: `3371c900e3d0ee34c31fe889d3c82211935169152adc766092f504c5afb72244`.
- Fixture SHA-256: `31a761212e4aeddb17407b9bece6e31b826d4e94949b298e3b6fa8c9aa739d85`.

Hosted backup/PITR settings, physical Storage backup ownership, recovery objectives, provider reconfiguration and real incident cutover remain pending.

### Prescription release restoration and permission checks

The84-migration rehearsal adds approved prescription/item history, a correction, a prepared review, an unfinished item run and a frozen schema8 release. The source upgrade preserves existing51-migration clinical/billing/Auth/Storage fixtures. Four explicit release audit entries are matched to their exact policy/package/source/invalidation rows; prior audit rows cannot change.

The expanded post-restore comparison detected that restoring as `supabase_admin` with ordinary ownership reassignment inherited its permissive creation defaults. Private application functions acquired unintended API-role execution despite matching owners and bodies. Earlier data and pre-restore canonical comparisons did not establish post-restore permission equality. No hosted project was changed by this finding.

The runner temporarily revokes only the owned destination restore account's default public-schema API grants before restoration. The archive still restores all explicit owners, ACLs and default ACLs. PostgreSQL's [session-authorization option](https://www.postgresql.org/docs/17/app-pgrestore.html) was also tested but failed against the platform's realtime cleanup sequence; the scoped creation-default correction preserves the compatible archive path. Verification compares restored functions, effective API-role table/sequence grants, row-level-security flags/policies, default privileges and triggers against a canonical installation. This is a required equality check, not a post-restore blanket permission rewrite.

Local CLI health grace expired under workstation load. The owned runner allows that CLI grace to expire but then independently requires Auth, PostgREST and Storage HTTP readiness within120seconds; missing readiness still fails and cleans up the owned resources. Resume verifies database/private-file hashes and exact migration sources, and performs the same canonical comparison on the restored database. Hosted backup/PITR and production recovery commissioning remain separate.

Final resumed restoration passed using the same checksum-verified populated backup:473 functions,252 triggers,191 relations,235 policies and six public-schema default-privilege records match canonical state. Two prescription versions, three review requests, two item runs and the released snapshot match their original rows. Fresh local login, signed clinical/billing/stock fixtures, private original checksums and checked cleanup passed. [Sanitized evidence](evidence/prescription-release-restore-local-20260913.json) records both runner hashes and the51→84 backfill. Reported resumed timing excludes the earlier startup/failure investigations and is not a production recovery target.
