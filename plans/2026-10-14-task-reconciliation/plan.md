# Bounded operational-task reconciliation — 4C

Prepared October14 UTC and rebased onto verified PR250 merge `e4282c5a2d1fa1ac958ddab678f21208dfb1440b`. Daily task UI is released; staging/primary migration184 and exact production/domain checks pass. [Rollout](../../docs/launch-evidence/2026-10-14-operational-tasks-rollout.md). This package finishes reconciliation and run evidence; it does not commission automation. Preserve every requirement in [the full plan](../2026-10-13-operational-tasks/full-plan-status.md).

| Step | Deliverable | Status |
|---|---|---|
| 1 | Private default-off reconciliation policy, immutable requests/results and durable sweep cursor | Planned |
| 2 | Separate service-only schedule-first start/execute/recover RPCs | Planned |
| 3 | Authenticated, default-off Edge handler and inactive scheduler registration | Shared request/receipt contract and handler implemented with47 unit counterexamples; real DB, Edge entrypoint and scheduler registration still pending |
| 4 | Operations run evidence, explicit job/cadence and staff bounded review controls | Planned |
| 5 | SQL/Auth/concurrency/restore/worker acceptance, staged rollout and production verification | Planned |

[Research](research/scheduler-findings.md), [implementation and acceptance](implementation.md). Susan’s templates and effective generation dates remain reviewed practice configuration; standing engineering approval does not invent those values.

The contract checkpoint passes strict standalone type checking, focused lint and `npm run check` with1,442 units. [Receipt](../../docs/launch-evidence/2026-10-14-task-reconciliation-contract-local.json). The unchanged lockfile's install audit reports5 moderate/13 high findings; release security review remains required. No dependency was added or upgraded in this checkpoint.

Use a generated additive migration; update every migration/count/restore tripwire. Keep Lovable types unchanged. This worktree owns only the4C package. No email, provider call, inventory change, diagnostic release or clinical interval change belongs here. The shared handler is not deployed or claimed as a working reconciliation system while its service RPCs and genuine acceptance are absent.
