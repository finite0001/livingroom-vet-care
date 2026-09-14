# Synthetic local database and Storage restore rehearsal

Requirements: Docker, the repository-pinned Supabase CLI (2.115.0), Node22+, Python3, and `npm ci --ignore-scripts` in this worktree. No hosted credentials are needed. Ports58320/58321/58322/58324 and59320/59321/59322/59324 must be unused.

Run from this repository:

```sh
python3 scripts/restore-rehearsal/run.py --run-synthetic-local-rehearsal
```

The explicit flag is mandatory. The runner creates randomly named local projects and private temporary artifact directories. It never resets or backs up an existing practice/project. Source and destination use separate database and Storage volumes. All source migrations are replayed; the destination starts with only the platform baseline before restoring the full database archive, including Auth, Storage metadata, application rows, migration ledger, owners and grants. Physical Storage files are copied separately while writers are stopped.

Synthetic fixtures include a confirmed local Auth identity/password, signed SOAP and immutable addendum, a linked private PDF original uploaded through the real Storage API, an issued invoice and accounting credit, and reasoned stock movements. Restored login, RLS, relationships, original IDs, original byte hashes, signed URL retrieval, denied public/anonymous access and immutable writes are checked. Read/denied-write checks must leave the captured clinical/audit/ledger snapshot unchanged. The complete physical file inventory must match before and after restoration.

No Edge runtime, providers, SMTP delivery or scheduled workers are commissioned. Auth uses the local mail catcher; fixture users are confirmed via admin API without requesting email. The restored outbox is empty and pg_cron absent. These are no-sends-by-construction checks, not a claim of a hosted disabled-worker HTTP probe.

The runner prints its protected artifact directory and writes `result.json`, `database.dump`, physical `storage/` and `restored-storage/` inventories, `synthetic-fixture.json`, local status/config and a command log. The artifact directory is0700; generated credentials and logs are0600. Physical Storage copies retain their file modes inside that protected directory. Even synthetic Auth/session/database credentials in these artifacts must stay outsideGit and should be deleted when the evidence is no longer needed. Commit only sanitized result summaries. Use `--resume-backup <printed-artifact-directory>` with the explicit run flag to retry only the destination. The runner validates the stored run ID, database checksum and each physical file checksum first; it never reuses an existing destination volume. Failed runs retain protected diagnostics, and generated containers/volumes are stopped and removed in `finally`. Every stop return code and subsequent container/volume absence check must pass before `result.json` and PASS are emitted; a resumed attempt removes any stale prior success receipt. Cleanup checks exact generated project prefix, config path and available Docker project/workdir labels; it never enumerates unrelated projects for deletion.

This tests one frozen synthetic point in time on the same local platform versions. It is not production backup coverage, hosted PITR, cross-version upgrade validation, a promised RTO/RPO, an incident cutover or writer reconciliation. Real recovery still requires the practice-specific controls in `docs/restore-runbook.md`.

The fresh destination realtime schema is dropped before archive restoration because PostgreSQL cannot individually drop inherited primary-key constraints of the platform baseline partitions during `pg_restore --clean`. Its full schema/data are then restored from the archive; no archive errors or managed schemas are skipped. The restore uses `--exit-on-error --single-transaction`. API readiness waits cover Auth, PostgREST and Storage.

Privileged immutability probes retain the database administrator role while setting the real active synthetic actor claims. They require SQLSTATE23514 and the exact signed-record/addendum/ledger message; an authentication or unrelated SQL failure cannot count as proof.

## Rehearse the current staging baseline locally

```sh
python3 scripts/restore-rehearsal/run.py --run-synthetic-local-rehearsal --rehearse-staging-baseline
```

This mode uses the 84-version ledger read from staging `kothoqicubowyhwfsrte` on September 14, 2026, recorded in `staging-baseline-20260914.json`. It checks every baseline version and name against local migration files. It creates clinical, billing, Auth and physical document fixtures before applying the 14 missing migrations to reach 98. The CLI must refuse the three historical gaps (6500, 6900 and 7000) before explicit local `--include-all` application. The eleven September14 migrations are applied in the same upgrade.

Both canonical inventory comparisons and all existing physical restore checks remain mandatory. This mode does not reproduce the obsolete six extra grants from the older 51-version fixture. Its receipt identifies the baseline and hashes the observed ledger. The source schema is reconstructed from local migration bodies: matching hosted version/name history does **not** prove hosted function-body parity. Hosted drift inspection and a populated schema9 saved-artifact fixture remain separate requirements.

The two baseline flags are mutually exclusive. Neither accepts `--resume-backup` as evidence of a fresh upgrade. Restore-only resume retains the original upgrade receipt and checks exact current migration hashes.

## Rehearse the older hosted migration gaps locally

```sh
python3 scripts/restore-rehearsal/run.py --run-synthetic-local-rehearsal --rehearse-observed-hosted-gaps
```

This optional mode recreates the observed 51-version subset through2700 plus3000/3100/3300/3400 in a randomly named local source. It creates the synthetic records before applying the missing2800/2900/3200,3500–6300,6500,6900,7000 and9000 migrations and the eleven September14 migrations. It requires ordinary local push to refuse the historical gaps, then performs explicit local `--include-all` dry run and application. The final98-version ledger must match the repository, and every captured fixture row except the migration ledger must remain identical.

Before restoring the archive, the separate destination applies all98 migrations in canonical order. Every public function definition, security-definer flag, configuration, effective anon/authenticated/service-role execution permission and application trigger binding must match the backfilled source. The normal physical Storage/database restoration and access checks then run. After the actual restore, the destination must match that same canonical inventory again, including table/sequence grants, RLS flags and policies, and default privileges. Evidence records `post_restore_canonical_match` separately from the pre-restore upgrade comparison. `result.json` includes the initial, missing and final version lists, migration hashes and successful comparison evidence only after cleanup passes.

The gap mode rejects `--resume-backup`: a resumed destination does not repeat the upgrade and cannot attest to it. A restore-only resume remains available. For a retained gap backup, it verifies the original migration hashes, builds a fresh canonical destination and repeats the post-restore comparison. Its backfill receipt retains the original upgrade evidence; it does not claim the upgrade was repeated. This mode has a frozen98/51 inventory and exact missing-version list; future migration additions require reviewing and updating it. It never links to a hosted project. This synthetic rehearsal does not establish who applied the hosted migrations, approve a hosted backfill, or test provider delivery.

## Compare a hosted read-only routine inventory

Gap mode now writes `initial-routine-inventory.json` before applying missing migrations. Run `routine-inventory.sql` through an authorized read-only database connection and save its `inventory` value as JSON outsideGit, then compare:

```sh
python3 scripts/restore-rehearsal/compare-routine-inventories.py /private/path/initial-routine-inventory.json /private/path/hosted-routine-inventory.json
python3 -B -m unittest discover -s scripts/restore-rehearsal -p 'test_*.py'
```

The comparison exits nonzero for different migration versions, function bodies, owners, security-definer settings, search-path configuration, effective execution grants or trigger bindings/enable modes. It reports changed routine names and fields, not function bodies. The SQL sets a consistent deparser search path and C sort ordering, excluding extension-owned routines managed by Supabase. MD5 is used only to detect definition differences, not to authenticate the source. Full artifact SHA256 hashes remain in protected evidence.

This is a public-function/trigger inventory, not a complete schema, RLS-policy, role-membership, data, provider or deployment audit. Matching inventories do not authorize a hosted mutation. The canonical backfill comparison also checks function ownership and trigger enable mode in addition to its existing checks.

The current gap rehearsal also reproduces the six observed extra direct execution grants on its generated local source before capturing the initial inventory. Migration4600 must remove those extras while retaining the intended staff/consent access; the final98-migration canonical comparison verifies convergence. This fixture changes only local function ACLs and records that reproduction in the protected result. The separate `supabase/tests/explicit_rpc_grants_upgrade.py` runner also proves correction and rollback without changing bodies, owners or global default ACLs.

A fresh 51→84 run on September13,2026 passed both canonical comparisons, populated record and private-file verification, and checked cleanup in256.84seconds. The [sanitized receipt](../../docs/evidence/fresh-gap-restore-local-20260913.json) includes exact runner/fixture hashes and post-restore inventory counts. This local timing is not a production recovery target.

The current fixture also preserves two attachment metadata runs (one completed and one pending), a committed page with two ordered observations of one stable snapshot, and their raw/stable metadata digests. These receipts contain no file bytes or temporary download URLs. The [attachment metadata receipt](../../docs/evidence/attachment-metadata-restore-local-20260913.json) records the51→86 upgrade and actual restoration against canonical permissions.

The87-migration fixture also uploads two API originals through the authenticated staff Storage API, verifies both through privileged readback, completes one capture and preserves the other as reserved. Restore checks exact immutable capture/intent rows and both physical originals; direct owner/anonymous downloads stay denied.

Final 51→87 rehearsal evidence, including ready and reserved API originals, is in [`attachment-originals-restore-local-20260913.json`](../../docs/evidence/attachment-originals-restore-local-20260913.json). The matching full SQL and observed contention receipt is [`attachment-originals-sql-contention-local-20260913.json`](../../docs/evidence/attachment-originals-sql-contention-local-20260913.json).

The current84→98 staging-baseline rehearsal passed on September14,2026 in131.03seconds, including physical restore, both canonical inventory comparisons and checked cleanup. The [sanitized receipt](../../docs/evidence/canonical-staging-baseline-restore-20260914.json) separately records a read-only match of473 hosted routines and252 trigger bindings. It explicitly retains the outstanding populated schema9/saved-artifact and hosted relation/RLS coverage limitations. The updated legacy51→98 mode has not been executed for this receipt.

The current fixture also creates an approval, its correction and a separately canceled approval through actual authenticated RPC calls against the physically uploaded API original. The restore snapshot includes both immutable decision tables. Destination verification recovers exact decision outcomes, retries both historical approvals, confirms that cancellation cannot overwrite an approval or revive a canceled decision, verifies reviewed-original byte retrieval, and checks denied anonymous recovery/direct table access plus privileged update/delete rejection. These review-history checks do not yet establish restoration of schema9 releases or saved email/link artifacts.

The [decision restore receipt](../../docs/evidence/canonical-api-decisions-restore-20260914.json) records the passing84→98 run with two approval versions and one cancellation, exact authenticated recovery, original-byte checks and verified cleanup. Decision rows are populated after upgrade; pre-upgrade populated preservation remains the native fixture.
