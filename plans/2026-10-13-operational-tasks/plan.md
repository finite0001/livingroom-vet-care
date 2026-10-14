# Operational task templates and generation — 4B

Prepared October13,2026 from merged main `1b5b6a9bda816b840fdf32ccd724187edb7c1d23` (#249). Next-visit staff workflows are merged; staging and primary have183 migrations. See [rollout](../../docs/launch-evidence/2026-10-13-next-visit-staff-rollout.json). The backend, strict DTO/API contracts, staff template/use screens and Home/Schedule/full-list task UI are implemented in the work branch. Complete exact-head CI and hosted acceptance remain pending; no184 hosted migration or practice automation is enabled. [Backend receipt](../../docs/launch-evidence/2026-10-13-operational-tasks-backend-local.json).

## Scope and order

| Step | Deliverable | Status |
|---|---|---|
| 4B.1 | Reviewed operational templates, exact publication and private action recovery | Staff implementation and local acceptance pass; CI/hosted acceptance pending |
| 4B.2 | Explicit actual resource-use occurrences, ending use after cancellation | Staff implementation and local acceptance pass; CI/hosted acceptance pending |
| 4B.3 | Atomic materialization, frozen enrollment, safety revisions and default-off generation | Staff implementation and local acceptance pass; CI/hosted acceptance pending |
| 4B.4 | Meaningful SQL/Auth/browser/concurrency/restore acceptance and staged rollout | Local acceptance passes; staged rollout pending |
| 4C | Home/Schedule daily queues, assignment/completion UX and bounded reconciliation worker | Staff queues and completion included here; worker remains subsequent |

The4B steps form one coherent package. Do not claim automatic cleaning or restocking generation complete while actual-use evidence or canonical scheduling hooks remain absent. See [implementation](implementation.md), [acceptance](acceptance.md), [research](research/codebase-findings.md).

## Decisions

- New facilities task model; clinical intake Tickets and Guided Home checklist remain their existing workflows.
- Review exact appointment-type/resource IDs and selected published revisions. Free-text appointment names, broad procedure categories and scheduled duration cannot infer surgery or room use.
- Record actual use explicitly. Cancellation does not end use, make a room ready or remove cleanup/restocking work after use.
- Freeze template/checklist/rule snapshots for existing work; a stable logical task slot prevents republishing from duplicating outstanding work.
- Preserve completed evidence and attribution through cancellation, rescheduling, source corrections and room reassignment.
- Restock completion records checklist evidence only. Actual stock movement remains a separate inventory transaction.
- Generation remains off with no cron/provider activation. Existing work always receives safety revisions even when new generation is disabled.
- Proposed appointment lengths and operating checklists remain [Susan's drafts](../2026-10-13-scheduling-tasks/susan-defaults.md). No practice template is seeded as approved.

## Boundaries and remaining input

All45 original launch requirements and Susan's final workflow acceptance remain required. Weave notes were explicitly disregarded and are not queued. Practice room IDs, exact approved SOPs/checklists, assignment rules, procedure timing and effective activation dates require Susan's configuration review before publication/commissioning; they do not block implementing an empty, reviewable template system.

Build on existing Router7, current staff/session authorization, strict Zod DTOs, canonical scheduling and owned disposable tests. Do not generate Lovable's `types.ts`. Dave provided standing approval on October13 to review and merge all additional PRs as part of completing the full plan; review, checks and staged rollout remain required. Provider commissioning and worker activation are separate from applying a migration.

Current checkpoint:150 SQL files/6,184 assertions;78 package assertions;54 real Auth/API checks;22 actual browser checks;2 observed locks; populated12-table restore;11 model tests; the full repository check with1,395 units passes. [Staff local receipt](../../docs/launch-evidence/2026-10-13-operational-tasks-local.json) records the broad browser run and two successful focused rechecks. [Full remaining scope](full-plan-status.md) retains all45 requirements. Generation remains off on hosted backends.
