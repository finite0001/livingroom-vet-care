# Bounded operational-task reconciliation — 4C

Prepared October14 UTC from PR250 head2a257457. Daily task UI is already in that package. This plan finishes reconciliation and run evidence; it does not commission automation. Merge and verify PR250’s migration184 first. Preserve every requirement in [the full plan](../2026-10-13-operational-tasks/full-plan-status.md).

| Step | Deliverable | Status |
|---|---|---|
| 1 | Private default-off reconciliation policy, immutable requests/results and durable sweep cursor | Planned |
| 2 | Separate service-only schedule-first start/execute/recover RPCs | Planned |
| 3 | Authenticated, default-off Edge handler and inactive scheduler registration | Planned |
| 4 | Operations run evidence, explicit job/cadence and staff bounded review controls | Planned |
| 5 | SQL/Auth/concurrency/restore/worker acceptance, staged rollout and production verification | Planned |

[Research](research/scheduler-findings.md), [implementation and acceptance](implementation.md). Susan’s templates and effective generation dates remain reviewed practice configuration; standing engineering approval does not invent those values.

Use a generated additive migration; update every migration/count/restore tripwire. Keep Lovable types unchanged. This worktree owns only the4C package and must rebase onto the verified PR250 merge before publication. No email, provider call, inventory change, diagnostic release or clinical interval change belongs here.
