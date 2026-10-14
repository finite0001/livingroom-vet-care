# Full-plan scope and current goal

Dave's October13 standing instruction: approve and merge all additional PRs as they become ready, and complete every remaining part of the plan. This supersedes the historical per-PR permission checkpoint for this work only; reviews, exact-head checks and staging-first verification still apply.

The original scope is all25 October requests and20 substantive housecall requests in [the requirements matrix](../2026-10-08-vet-feedback/requirements.md). Preserve every row and the [original phase order](../2026-10-08-vet-feedback/execution-order.md); completing only operational tasks does not finish this goal. Existing implementations still need their required real workflow and practice evidence.

| Remaining package | Current evidence / next work |
|---|---|
| 4B operational templates, resource use and generation | Local migration184, reviewed template/use staff UI and strict recovery contracts implemented. 150 SQL files/6,184 assertions,54 Auth/API checks,24 genuine browser checks,2 observed lock queues,12-table populated restore,11 model tests and the full repository check with1,395 units pass. Exact-head CI and staged rollout remain required. |
| 4C daily tasks and reconciliation | Home/Schedule queues, full task list, role/assignee/overdue/completion controls are included in the current local staff package. Bounded reconciliation worker/run receipts and commissioning remain pending. |
| 5 supplier imports, iPhone scanning, controlled drugs | Inspect current ledgers; implement native preview/mapping/barcode/witness workflows; actual supplier samples and label/witness acceptance remain required. |
| 6 unpaid reminders, production and financing | Native terms/final-balance reminders and net-invoiced effective-rate attribution pending. Stripe selected; verify actual supported financing and settlement/refund route. |
| 7 clinical assistance, imaging, anesthesia and Gusto | Native reviewed draft workflows and connector contracts pending; actual supported account/device exchanges required. |
| 8 full release acceptance | Every original row, clinical register, actual vendor proofs, multi-pet rehearsal, restore/rollback and production verification must be audited on the final revision. |

Previous goal turn made progress: #249 was merged, both hosted backends183 and exact production/domain verified; the next package plan was saved. Current work has added real local implementation and tests; it is not a hosted deployment or clinical sign-off.

[Provider inputs](provider-status.md), [4B plan](plan.md), [acceptance](acceptance.md).
