# Full-plan scope and current goal

Dave's October13 standing instruction: approve and merge all additional PRs as they become ready, and complete every remaining part of the plan. This supersedes the historical per-PR permission checkpoint for this work only; reviews, exact-head checks and staging-first verification still apply.

The original scope is all25 October requests and20 substantive housecall requests in [the requirements matrix](../2026-10-08-vet-feedback/requirements.md). Preserve every row and the [original phase order](../2026-10-08-vet-feedback/execution-order.md); completing only operational tasks does not finish this goal. Existing implementations still need their required real workflow and practice evidence.

| Remaining package | Current evidence / next work |
|---|---|
| 4B operational templates, resource use and generation | PR250 merged as e4282c5a; staging/primary184 and exact production/domain verified. Four exact-head CI checks pass;78 rollback assertions on each hosted project;48 staging API/access and24 browser checks; canonical cleanup all zero. Local150 SQL files/6,184 assertions,54 API checks,24 browser checks,2 observed locks and12-table populated restore also pass. Practice templates/generation remain uncommissioned. [Receipt](../../docs/launch-evidence/2026-10-14-operational-tasks-rollout.md). |
| 4C daily tasks and reconciliation | Daily task UI is released. Local migration185 adds reviewed separate policy, service-only run/cursor/result APIs and typed recovery/read contracts.151 SQL suites/6,257 assertions,42 real API checks,4 observed worker queues, populated4-table restore and1,445 units pass. Edge/scheduler, rendered Operations controls and whole release acceptance remain pending. Hosted backends are184; no worker commissioning. [Plan](../2026-10-14-task-reconciliation/plan.md). |
| 5 supplier imports, iPhone scanning, controlled drugs | Inspect current ledgers; implement native preview/mapping/barcode/witness workflows; actual supplier samples and label/witness acceptance remain required. |
| 6 unpaid reminders, production and financing | Native terms/final-balance reminders and net-invoiced effective-rate attribution pending. Stripe selected; verify actual supported financing and settlement/refund route. |
| 7 clinical assistance, imaging, anesthesia and Gusto | Native reviewed draft workflows and connector contracts pending; actual supported account/device exchanges required. |
| 8 full release acceptance | Every original row, clinical register, actual vendor proofs, multi-pet rehearsal, restore/rollback and production verification must be audited on the final revision. |

Current progress includes PR250's completed hosted rollout and the next worker boundary implementation. This is not completion of all45 requirements or Susan's clinical sign-off. Remaining native packages can proceed while vendor details are pending.

[Provider inputs](provider-status.md), [4B plan](plan.md), [acceptance](acceptance.md).
