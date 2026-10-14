# Bounded operational-task reconciliation — 4C

Prepared October14 UTC and rebased onto verified PR250 merge `e4282c5a2d1fa1ac958ddab678f21208dfb1440b`. Daily task UI is released; staging/primary migration184 and exact production/domain checks pass. [Rollout](../../docs/launch-evidence/2026-10-14-operational-tasks-rollout.md). This package finishes reconciliation and run evidence; it does not commission automation. Preserve every requirement in [the full plan](../2026-10-13-operational-tasks/full-plan-status.md).

| Step | Deliverable | Status |
|---|---|---|
| 1 | Private default-off reconciliation policy, immutable requests/results and durable sweep cursor | Local migration185 and typed recovery/read contracts implemented; real SQL/API/restore checks pass |
| 2 | Separate service-only schedule-first start/execute/recover RPCs | Local implementation passes104 package assertions,42 actual API checks,28 real HTTP checks and21 browser checks; full combined regression and populated16-family/18-relation restore pass; hosted release acceptance remains pending |
| 3 | Authenticated, default-off Edge handler and inactive scheduler registration | Pinned Edge entrypoint and inactive five-minute job implemented; default-off and real lost-response recovery verified locally |
| 4 | Operations run evidence, explicit job/cadence and staff bounded review controls | Implemented; reviewer recovery, pagination,31-day/DST validation, mobile layout and dirty navigation pass21 browser checks |
| 5 | SQL/Auth/concurrency/restore/worker acceptance, staged rollout and production verification | Final npm check passes1,447 units; expanded canonical151-suite/6,288-assertion regression and combined18-relation restore pass. The36-check hosted rollback script also passes locally. CI and hosted rollout remain pending |

[Research](research/scheduler-findings.md), [implementation and acceptance](implementation.md). Susan’s templates and effective generation dates remain reviewed practice configuration; standing engineering approval does not invent those values.

The contract checkpoint passes strict standalone type checking, focused lint and `npm run check` with1,442 units. [Receipt](../../docs/launch-evidence/2026-10-14-task-reconciliation-contract-local.json). The unchanged lockfile's install audit reports5 moderate/13 high findings; release security review remains required. No dependency was added or upgraded in this checkpoint.

Generated additive migration `20261014154223_operational_task_reconciliation.sql` and all migration/count/restore tripwires are updated. Lovable types are untouched. [Backend checkpoint](../../docs/launch-evidence/2026-10-14-task-reconciliation-backend-local.json) includes a real5s PostgREST timeout, later-source rollback, inactive-assignee repair, concurrent pause/replay and exact restored recovery. The parent task workflow still passes54 API/2-lock/24-browser/populated12-table checks. Owned containers/volumes and restore databases were removed. Hosted backends remain184; the package is not ready for merge or commissioning until its remaining integration and acceptance are complete.

Integration checkpoint: service Edge entrypoint, separate reviewed reconciliation policy, inactive scheduler reservation/retry and Operations/task-template controls are now implemented. The earlier contract/backend checkpoints above are historical. Read-only preflight on staging and primary confirms184 migrations with only canonical185 pending and all protected gates unchanged; primary retains its three existing outbox rows. No hosted schema change, delivery activation or legacy write has occurred.

Final local release proof: [receipt](../../docs/launch-evidence/2026-10-14-task-reconciliation-release-local.json). The elapsed window is now invariant under caller timezone, including repeated-hour boundaries. All scheduling layers ran together with populated task/ledger restore and canonical zero/off cleanup. The uniquely owned runtime and volumes were removed. No provider request or hosted schema change occurred.
