# Synthetic local database and Storage restore rehearsal

Requirements: Docker, the repository-pinned Supabase CLI (2.115.0), Node22+, Python3, and `npm ci --ignore-scripts` in this worktree. No hosted credentials are needed. Ports58320/58321/58322/58324 and59320/59321/59322/59324 must be unused.

Run from this repository:

```sh
python3 scripts/restore-rehearsal/run.py --run-synthetic-local-rehearsal
```

The explicit flag is mandatory. The runner creates randomly named local projects and private temporary artifact directories. It never resets or backs up an existing practice/project. Source and destination use separate database and Storage volumes. All source migrations are replayed; the destination starts with only the platform baseline before restoring the full database archive, including Auth, Storage metadata, application rows, migration ledger, owners and grants. Physical Storage files are copied separately while writers are stopped.

Synthetic fixtures include a confirmed local Auth identity/password, signed SOAP and immutable addendum, a linked private PDF original uploaded through the real Storage API, an issued invoice and accounting credit, and reasoned stock movements. Restored login, RLS, relationships, original IDs, original byte hashes, signed URL retrieval, denied public/anonymous access and immutable writes are checked. Read/denied-write checks must leave the captured clinical/audit/ledger snapshot unchanged. The complete physical file inventory must match before and after restoration.

No Edge runtime, providers, SMTP delivery or scheduled workers are commissioned. Auth uses the local mail catcher; fixture users are confirmed via admin API without requesting email. The restored outbox is empty and pg_cron absent. These are no-sends-by-construction checks, not a claim of a hosted disabled-worker HTTP probe.

The runner prints its protected artifact directory and writes `result.json`, `database.dump`, physical `storage/` and `restored-storage/` inventories, `synthetic-fixture.json`, local status/config and a command log. The artifact directory is0700; generated credentials and logs are0600. Physical Storage copies retain their file modes inside that protected directory. Even synthetic Auth/session/database credentials in these artifacts must stay outsideGit and should be deleted when the evidence is no longer needed. Commit only sanitized result summaries. Use `--resume-backup <printed-artifact-directory>` with the explicit run flag to retry only the destination. The runner validates the stored run ID, database checksum and each physical file checksum first; it never reuses an existing destination volume. Failed runs retain protected diagnostics, and generated containers/volumes are stopped and removed in `finally`. Cleanup checks exact generated project prefix, config path and available Docker project/workdir labels; it never enumerates unrelated projects for deletion.

This tests one frozen synthetic point in time on the same local platform versions. It is not production backup coverage, hosted PITR, cross-version upgrade validation, a promised RTO/RPO, an incident cutover or writer reconciliation. Real recovery still requires the practice-specific controls in `docs/restore-runbook.md`.

The fresh destination realtime schema is dropped before archive restoration because PostgreSQL cannot individually drop inherited primary-key constraints of the platform baseline partitions during `pg_restore --clean`. Its full schema/data are then restored from the archive; no archive errors or managed schemas are skipped. The restore uses `--exit-on-error --single-transaction`. API readiness waits cover Auth, PostgREST and Storage.
