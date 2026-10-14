# Phase 4 — Appointment types, next visits and daily tasks

**Status:** Planned. **Priority:** high. **Requirements:** N23–N25; H13–H14. **Depends on:** baseline; reuse Phase 2 reminder transitions.

## Implementation packages

1. Introduce a practice-managed appointment-type catalog with sick/well/procedure category, default duration, species eligibility, clinic/housecall applicability, required resource and pre/post buffers. Store a versioned snapshot on appointments so later template edits do not rewrite history.
2. Map current free-text resources to stable room/resource IDs through an explicit review. Preserve historical display labels. Extend the existing server checks for staff, resource, patient and travel conflicts; a mobile-only check is insufficient.
3. Type selection proposes length and room. Staff can enter an authorized duration override with a reason where practice policy allows. Unsupported species/type combinations show an actionable conflict instead of silently selecting a different type.
4. After a successful appointment-completed transition, show **Schedule next visit** with relevant reviewed due-care context. Support book now, schedule later and declined; record the outcome separately from clinical completion. Repeated status callbacks must not create duplicate prompts/bookings. Existing future appointments are visible before booking another.
5. Create facilities-task templates for room turnover, surgery preparation/cleanup and restocking. Configure trigger relative to scheduled or actual use, assignee/role, due time and checklist. These are operational tasks, not patient-intake tickets.
6. Generate instances keyed by appointment + resource + template version + occurrence. Update outstanding instances on reschedule/cancellation, preserve completed history and flag conflicts that need staff attention. Reconciliation repairs missed generation without duplicates. Room tasks must not expose unnecessary clinical details.
7. Display a daily staff checklist from Home/Schedule with completion attribution and overdue visibility. A completed restocking task links a separate inventory movement when needed; it never invents physical stock.

## Files and schema

| Action | Absolute path | Change |
|---|---|---|
| Modify | `/Users/davidedler/Developer/lrv-feedback-plan-20261008/src/hub/features/scheduling/SchedulePage.tsx` | Type/resource selection and task links |
| Modify | `/Users/davidedler/Developer/lrv-feedback-plan-20261008/src/hub/features/scheduling/use-appointment-status.ts` | Completion workflow |
| Modify | `/Users/davidedler/Developer/lrv-feedback-plan-20261008/src/hub/pages/HubHomePage.tsx` | Staff daily task list |
| Reuse | `/Users/davidedler/Developer/lrv-feedback-plan-20261008/src/hub/features/scheduling/HousecallDayRoute.tsx` | Existing Google Maps routing |
| Create | `/Users/davidedler/Developer/lrv-feedback-plan-20261008/src/hub/features/daily-tasks/` | Task templates, instance list and completion |
| Create | `/Users/davidedler/Developer/lrv-feedback-plan-20261008/supabase/migrations/<next>_appointment_types_and_daily_tasks.sql` | Catalog, resource mapping, task lifecycle and staff RPCs |

## Acceptance

- [ ] A wellness, illness and surgery appointment propose correct reviewed lengths/species/resources; collision rules still work.
- [ ] A template edit does not alter old appointment snapshots or completed tasks.
- [ ] Completing an appointment prompts next booking once; deferring does not undo completion.
- [ ] Cancellation/reschedule adjusts outstanding cleaning/restock tasks; repeated generation produces no duplicates.
- [ ] Staff can complete tasks on iPhone; assignee permissions and actor audit are enforced on the server.
- [ ] Housecall directions still include intended stops/return leg; travel buffer and Denver date/DST cases pass.
- [ ] Extend scheduling SQL/browser tests and add task-generation idempotency/concurrency tests.

**Open configuration:** exact type list/durations, species rules, rooms, task templates and assigning roles. Collect these from Dr. Edler/staff during configuration; do not hardcode guessed clinical operating times.

Current staff next-visit/#249 status: approved, merged and production/domain verified; repository/staging/primary183. Both passed49 rollback assertions; staging25 Auth/API +19 browser checks. [Hosted receipt](../../docs/launch-evidence/2026-10-13-next-visit-staff-rollout.json). [4B detailed design](../2026-10-13-operational-tasks/plan.md) is prepared, not implemented or enabled. 4C daily tasks and Susan acceptance remain open. All45 original requirements retained.
