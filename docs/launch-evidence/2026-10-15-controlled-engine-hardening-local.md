# Controlled-stock engine — upgrade and recovery hardening

> Historical October 15, 2026 receipt for the 189-migration release. Its hosted observations, counts, deployment identifiers and original proof results describe that dated run. The October 18 forward-port performs no hosted comparison or deployment; current 203-migration local verification is recorded separately below and does not refresh these historical observations.

The isolated candidate installer now checks a pinned canonical prior snapshot before engine DDL. The reference covers 116 functions and 30 relations, including effective grants, RLS, columns, constraints, triggers and indexes. Its migration-source and snapshot-source hashes are bound. An exclusive practice barrier precedes the comparison. Deliberate helper-definition, private-grant, RLS and immutable-trigger changes each fail with the intended drift error; no engine schema remains, and prior metadata matches exactly after rollback. The reference is generated from the canonical 189 migration replay, never from a deployed database to bless drift.

Both hosted backends match the pinned prior hash `247ea0b70e8379a56c0ffc9a68d78dd545c369dc100e8ccddc825827cec5d9ad` in read-only catalog comparisons. That establishes compatibility of the covered metadata at the observation time. It is not a hosted migration, whole-database security audit or clinical permission. [Machine receipt](2026-10-15-controlled-engine-hardening-local.json).

The local gate passes 133 genuine Auth/PostgREST checks and eight observed queues. An admitted managed writer pauses at its final container wait; the actual exclusive freeze waits for that writer to commit. A new generic writer then queues behind the exclusive barrier. Committing a synthetic suspension denies the generic route and fresh preparation while preserving exact saved-receipt recovery. Private configuration changes occur only in an owned SQL fixture; no commissioning RPC is exposed.

The populated restore adds eight exact isolation rejections—read/execute/cancel/prepare under both repeatable-read and serializable—and four stale-context checks. A technical row carrying an older server/transaction identity is not active authority, cannot authorize a generic managed adjustment, and does not alter saved recovery. A fresh owned action replaces it, posts once, recovers exactly and clears the context. Every restored relation fingerprint matches again after rollback. Those claims are SQL-fixture evidence, separately identified from genuine Auth/HTTP checks.

All 155 canonical SQL suites/6,540 assertions, the 24-action managed native lifecycle, four late injected failures, eleven independent corruption failures and 412-relation exact restore pass. Failure/corruption counts now come from the executed SQL probe tables. Application checks pass 1,471 tests, type checks and production build with four existing lint warnings. Owned actors/sessions are retired and the isolated containers/volumes removed. No provider requests occur.

[PR #258 is merged and its application deployment verified](2026-10-15-controlled-engine-candidate-rollout.md). This hardening batch remains outside canonical migrations/application execution. A production engine migration still needs complete opening/old-source/hold/exception coverage, independent release review, exact-head CI and stage-first installation/rollback/advisor verification. C2 workflows and C3 actual practice configuration/counts/Susan’s rules remain required and inactive. No migration190, hosted engine schema, provider, payment, payroll, email, secret or Edge deployment is added here.


## October 18 forward-port — current 203-migration local proof

The original October 15 results above and their JSON fields remain unchanged as historical evidence. This forward-port starts from main `7cdb2ba833659e65410531483e6d1ce10226d9d9` and replays all 203 canonical migrations in a uniquely owned disposable stack. The full current result is the machine receipt’s separate `current_203_forward_port` section. No hosted comparison or deployment was performed.

The independently retained `trusted-prior-189.json` is byte-for-byte unchanged (SHA-256 `7c39d7d55b7aed8f11159555bbcd880c5910b1fa2891e495c28d2a1b6dbc5ac1`), as is `prior-snapshot.sql` (`fe7344ba56108a8844e6bdcb7e7375c5cb4223b3c9eecc9b96ccfc648c3f24cd`). The first 189 current migration files still match the original source-set digest. After all 203 migrations, the covered 116-function/30-relation catalog equals that frozen reference before engine DDL. The expected catalog was not regenerated from the current candidate, current replay or a hosted catalog. The four deliberate prior drifts each reject atomically and restore exact prior metadata.

The final source-bound owned run passed:

- All 166 current canonical SQL suites / 7,315 assertions with the candidate installed; all ten canonical writer definitions unchanged.
- 133 genuine local Auth/PostgREST checks and eight observed lock queues, including admitted-writer drain, new-writer waiting before native resources, suspension refusal and exact saved recovery.
- 24 managed actions across nine native producers, plus separate receiving/adjustment smoke coverage; four late failures and eleven corruption failures counted from executed SQL proof tables.
- Eight restored isolation refusals, four stale-context/recovery checks and 456 exact restored relation fingerprints. Those restore/context claims use explicitly labeled SQL fixtures; physical post-backup history and Storage binary restore are not established.
- All 394 bound input hashes still matched after completion. Owned actors/sessions were retired; the marked clones and owned stack were removed. Container, volume and private-work removal were independently rechecked. Hosted writes and provider requests: zero.

Sanitized candidate result SHA-256: `7b1d7aa177abdd7b8aef1954e635844c8d7a86f3d7123e570bcea47037cb309c`. Protected runner-log SHA-256: `cbf11ba30dd65f981c4ada6db65cc4c0ed821ec52093880663a07f264dcfdaee`. No application build or unit-test count is claimed for this test-only forward-port; exact-head CI remains required. This does not complete production C1b acceptance, C2 workflows, C3 actual practice configuration/counts/Susan’s approval, or clinical activation.
