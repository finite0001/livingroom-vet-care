# Disposable source-reconciliation scheduler isolation

Date: 2026-10-17. Scope: test harness only; no product SQL, Edge Function, frontend, hosted configuration or clinical activation change. See the [sanitized receipt](2026-10-17-source-reconciliation-scheduler.json).

## Failure and evidence limits

PR 272's [first CI run](https://github.com/finite0001/livingroom-vet-care/actions/runs/39042768951) passed all 165 canonical SQL suites / 7,235 assertions, then failed within the native-prescribing runner's source-reconciliation child. That child's private stderr was captured in a temporary parent log that CI did not retain. Its exact original failure is therefore unknown. The step overlapped a quarter-hour scheduler boundary; this timing is suggestive, not a confirmed diagnosis.

The unchanged original source oracle passed a separate focused local run. A broader local attempt timed out earlier in estimate concurrency, before reaching this oracle; that attempt is not acceptance evidence.

The oracle compares every ordinary public/auth/storage/extensions table before and after an isolated schema-only clone proof. Its original implementation left pg_cron running. Autonomous scheduler ledger appends can therefore invalidate the source comparison independently of any tested stock producer.

## Repair

The runner now pauses scheduling only after checking an explicitly synthetic runtime name, its exact project configuration and the Docker project/workdir labels. It observes scheduling off and waits for existing jobs to drain before taking the first snapshot. The drain covers client connections, background workers and logged starting/connecting/sending/running tasks. The [upstream pg_cron implementation](https://github.com/citusdata/pg_cron/blob/main/src/pg_cron.c) distinguishes the client and background-worker modes.

All source tables, strict row comparisons, fixture assertions and producer replay checks remain included. No scheduler ledger rows are deleted or excluded. Job definitions remain installed. The helper restores the prior on/off setting in `finally`, including after a source-proof exception; it rechecks ownership before a restoration write. Restoration means the effective scheduler setting, not byte-identical `postgresql.auto.conf`. Existing off remains off without an administrative write.

The source runner includes the helper's SHA256 in its checked input manifest. Nine offline regression tests cover wrong identity/config/container, already-off state, live-job drain, timeout, failed pause, exception restoration and a replaced container. Together with the existing harness tests, all 17 pass.

## Controlled live counterexample

Two final owned-runtime receipts separately test client connections (`cron.use_background_workers=off`) and background workers (`on`). Both freeze the same repaired runner and helper before execution and verify those hashes afterward. Each records an independently observed synthetic ledger writer and an in-flight job before pause. The original runner is executed from its unchanged retained bytes, with its original repository file location supplied for fixture resolution; its wrapper invocation is a diagnostic, not an unmodified full CI acceptance run.

In each mode, under the same writer, the original oracle rejects a changed source snapshot. The repaired oracle passes all 961 assertions and 136 actual canonical replays in each mode, including unchanged source and populated clone comparisons. The job definitions are unchanged; the writer resumes after restoration. Marked clones and both owned runtimes' containers, volumes and private working directories are removed. No provider or hosted operation is used.

Earlier diagnostic receipts are retained privately, including the initial receipt that did not bind the subsequently added helper hash. Only the final two frozen receipts are acceptance evidence for the final helper. These controlled counterexamples establish a harness race and its correction; they do not recover the missing original CI stderr or establish that race as the original CI cause.

Exact-head GitHub CI remains a separate release gate. The original call-note access/upgrade/staging evidence and its immutable input inventories are preserved in [the Phase 3B.1 receipt](2026-10-17-clinical-call-note-sources.md). This harness repair does not authorize merge, primary migration 202, call generation or clinical processing.
