# Beta workspace integration review — November 6, 2026

Source baseline `b8767ff2e560f23d884194b5e9f875c0c647532a`, plus the local audit fixes described below. This workstream covers nonclinical frontend integration. Clinical and backend reviews are separate. All runtime tests here use synthetic values; no patient records, provider messages or production settings were changed.

## Verified defects and changes

### Admin time corrections could desynchronize duty state

`useAdminUpdateTimeEntry` and `useAdminDeleteTimeEntry` originally changed `time_entries`, then separately patched `profiles.is_on_duty=false` based on the browser's `wasOpen` value. A failed second request left drift. A staff member clocking in between those requests could create a new open shift and then be incorrectly marked off duty by the late admin patch. The profile trigger lets administrators bypass the ordinary consistency guard. Backend review confirmed there is no current transactional admin time-entry RPC or duty-synchronization trigger.

The beta UI now permits correction/deletion of **already-closed shifts only**. The database mutation predicates match the reviewed ID, staff ID, clock-in, clock-out and note, and require non-null clock-out. Corrections cannot reopen a shift. A zero-row result is reported as changed/unavailable work, not success. No profile duty PATCH remains. Open-shift controls are disabled with an instruction to have the staff member clock out first. Self-service `clock_in`/`clock_out` RPCs are unchanged.

Files: [mutation guard](../src/hub/features/time-clock/admin-time-entry.ts), [hooks](../src/hub/hooks/use-time-clock.ts), [admin timesheet](../src/hub/components/timesheet/AllStaffTimesheet.tsx).

**Remaining boundary:** this protects the current UI, not old/custom clients. Existing ADMIN table permissions still allow broader direct changes. A complete backend invariant fix and safe admin open-shift correction require a reviewed transactional RPC with per-staff serialization and corresponding migration/acceptance. No migration or source-frozen proof was altered here. If an employee cannot clock out, this beta UI does not offer an administrative close workaround.

### Dashboard omitted overnight hours

`TimeClockPage` formerly selected shifts by start time before summing whole durations. A shift from 23:00 yesterday to 01:00 today contributed zero to Today. The same problem affected shifts straddling the rolling seven-day start; workstation-local midnight also varied by device timezone.

The dashboard now sums the overlap between each shift and the reporting interval. Today begins at Denver midnight, including daylight-saving transitions; Past 7 days remains a rolling 168-hour interval. The recent-shift query includes older overlapping/open shifts and paginates. The timer continues ticking across midnight even when the viewer is currently clocked out.

Files: [interval calculations](../src/hub/features/time-clock/time-totals.ts), [dashboard](../src/hub/pages/TimeClockPage.tsx), [hooks](../src/hub/hooks/use-time-clock.ts).

**Scope:** this changes dashboard Today/Past 7 days totals. Personal and all-staff date-range timesheets continue to select by clock-in date and display/export full selected shifts. Their dates use the device's local calendar. They are shift listings, not clipped payroll-period reports; users must not infer the latter from this fix.

### Timesheet read errors looked like zero worked hours

Personal and all-staff timesheets discarded query error state, displaying zero/empty data after failure and potentially retaining export access to stale data. Both now hide totals, disable CSV export and show an explicit unavailable state with retry. Data-read failure is no longer presented as “no time entries.”

Files: [personal timesheet](../src/hub/pages/MyTimePage.tsx), [admin timesheet](../src/hub/components/timesheet/AllStaffTimesheet.tsx).

## Cross-feature paths inspected

| Path | Source evidence and result | Remaining proof |
| --- | --- | --- |
| Scheduling → next visit → patient/household summary → daily tasks | `AppointmentEditor`, `use-appointment-status`, `NextVisitWorkspace`, `refreshScheduleFacts`: current actor, reviewed booking/completion calls, preserved recovery metadata and invalidation of schedule/operational/360 caches. No additional blocking source defect identified in this path. | Current authenticated hosted booking, changed-source reconciliation and role acceptance. |
| Task templates → generation/reconciliation → task completion | `OperationalGenerationSettings`, `DailyTasksPanel`, `use-task-action`: actor-scoped queries, exact reviewed action, recovery and pending-draft boundary. | Hosted scheduler policy/configuration separately; runtime metadata reports task-reconciliation cron inactive on both targets. |
| Household estimates → invoice → payment/reconciliation | `ClientProfilePage`, `HouseholdEstimates`, `HouseholdInvoices`, payment panels: household/actor keyed workspaces, retained uncertain operations, explicit server payment state and financial-change handling. Legacy appointment hooks are not mounted at the current schedule route. | Sandbox payment/refund/replay and deployed capability configuration. A browser return is not payment settlement. |
| Public inquiry → triage → confirmed household → reply | `WebsiteInquiriesPage`, `use-message-queue`: submitted contact information stays unverified, explicit household/contact attestation, versioned triage, actor/scope-bound durable prepare/recover/enqueue path. | Deployed contact mode, actual recipient allowlists, consent and inbound/provider roundtrip. |
| Daily communications → source/retry → operations | `DeliveriesPage` and daily communication API distinguish active outbox vs retained legacy deliveries and provider accepted vs delivered. Outbox retry routes to reviewed admin workflow. | Hosted queue state and scheduler/provider gates; no provider calls made here. |
| Records requests → original documents → frozen release | `records-requests/api.ts` validates identifiers/manifests and uses staff RPCs; feature map links source-specific acceptance. | Exact private bytes, patient scope, expiry/revocation and delivery in the intended environment. |
| Identity/admin/access | `AuthContext` clears query cache on identity changes and protects stale auth results; staff mutations use administrative RPCs. `invite-staff` exists locally. | Staging lacks deployed `invite-staff` per fresh backend metadata; the actual invitation lifecycle is not proven by source inspection. |
| Time clock → duty → timesheet | Found and repaired the three issues above. | Backend transactional admin invariant, actual staff workflow and expanded period-report requirements remain separate. |

## Verification

- Existing focused Node suite: **397 tests passed, 0 failed**, across 56 test files in 16 areas (scheduling, care plans, billing/payments, communications, public intake, auth, operations, invoice reminders and records requests). This is an overlapping subset of the repository suite, not an additional independent total.
- New time-clock Node suite: **6 passed, 0 failed**. Covers overnight/old-open overlap, DST boundaries, malformed/future intervals, closed-only writes, no duty writes, and stale timestamp/note/staff rejection.
- Focused lint passed for the time-clock helpers, hooks, UI and tests.
- Browser regression coverage is in [hub error-state tests](../e2e/hub-error-states.spec.ts): failed personal/admin timesheet reads, export denial/retry, disabled open-shift actions, exact closed-row update predicates, no profile PATCH and stale-update rejection. All **3 focused browser scenarios passed** on isolated ports 18180/18181 with one worker and no retries (42.2 seconds). The first launch used an incorrect environment-variable name and was refused because port 8080 was occupied; no existing server was reused. The corrected run exercised the tests above. Standalone application typecheck was stopped to avoid duplicating the root final `npm run check`; see the final audit report for that result.

No hosted business mutation, clinical approval, live delivery or source/bundle equivalence is claimed. The [documentation map](beta-readiness-documentation-2026-11-06.md), [dependency triage](beta-readiness-dependencies-2026-11-06.md) and backend metadata provide the remaining beta boundaries.
