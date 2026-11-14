# Living Room Vet: photo feature rollout

Status: implementation prepared; verification and activation tracked separately. Date: November 14, 2026.

## Confirmed direction
- Target **The Living Room Vet only**, repository `finite0001/livingroom-vet-care`.
- Dave clarified the initial Vet Connect Hub reference; GreenTree's `vet-connect-hub` is not the implementation target.
- First staff release: **time clock and PTO**.
- Keep all features from the supplied photo in scope; extend existing features instead of duplicating them.
- Baseline: fetched `origin/main` at `7329d6ae`. This is a repository inventory, not a hosted deployment verification.

## Rollout sequence
| Phase | Deliverable | Depends on | Status |
| --- | --- | --- | --- |
| 0 | Policy decisions, private HR permissions, hosted inventory and recovery verification | Owner inputs | Permissions implemented; policies/recovery activation pending |
| 1A | Extend existing time clock/timesheets: corrections, overtime, shifts, auto clock-out, lateness | 0 | Implemented in candidate; activation pending |
| 1B | PTO, sick leave, holidays, accruals and who's-off calendar | 0; shared time rules from 1A | Implemented in candidate; activation pending |
| 2 | Quick tasks, kennel-duty rotation, staff board, milestones, events | Shared access model | Implemented in candidate; clinical/configuration acceptance pending |
| 3 | Payroll summaries, raises/bonuses, SIMPLE IRA forms, anonymous peer reviews | Approved time/leave; privacy design | Implemented in candidate; clinical/configuration acceptance pending |
| 4 | Clinical calculators; validate existing dental chart | Clinical reference review | Implemented in candidate; clinical/configuration acceptance pending |
| 5 | AI discharge/bloodwork helpers and assisted pill identification | Clinical data/review; data-source decision | Implemented in candidate; clinical/configuration acceptance pending |

Phase 0 establishes backup coverage early; recovery monitoring continues across every phase.
Source implementation is prepared today. Operational activation depends on the explicit gates in the rollout runbook.

## Detailed plan
- [Photo checklist and existing coverage](feature-matrix.md)
- [First release: time clock and PTO](phase-01-time-and-leave.md)
- [Later releases and integration](phase-02-through-05.md)
- [Permissions, deployment and release checks](integration-and-release.md)

## Navigation proposal
Keep existing `/hub/time`, `/hub/timesheet`, daily tasks and patient chart routes.
Add a Team area for leave, staff shifts, board and events; restrict management screens by capability.
Keep calculators under Clinical tools and patient-specific results in the existing patient workspace.
Owner tools belong in a restricted management area. Preserve shared navigation and Guided mode.

## Completion rule
Every row in the feature matrix needs implementation evidence, tested permissions, staging acceptance,
a release receipt and an operational owner. A source file, passing local test or merged PR alone is not a live feature.

## Configuration and acceptance still needed
1. Pay period/workweek, employee classifications, break policy, overtime rules and payroll provider/export format.
2. PTO/sick/holiday policies: eligibility, opening balances, accrual basis, carryover, caps, negative balances and approvers.
3. Auto clock-out cutoff/grace and review process; shift schedule and lateness grace.
4. Dave and Susan are the confirmed approvers; assign their verified accounts and explicit private-pay permissions.
5. Kennel rotation confirmed as rotating staff duties; configure the participating staff and duties.
6. Dr. Edler's clinical reference set; acceptable pill-identification data source; SIMPLE IRA provider/forms.
7. Backup retention, recovery objectives and confirmed hosted database plus Storage coverage.

Implementation details and activation gates: [rollout runbook](../../docs/staff-feature-rollout-2026-11.md).
Payroll/leave policies are deferred by Dave; the source must retain Needs setup until supplied.
