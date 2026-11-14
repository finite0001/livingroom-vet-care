# Photo checklist and repository evidence

Baseline: `origin/main` `7329d6ae`, inspected November 14, 2026. Paths are relative to the repository.
“Existing” means implemented in source, not certified live or accepted by staff.
“Not found” means no matching workflow found in inspected hub code, functions or migrations.

| ID | Photo feature | Current coverage | Planned work / acceptance | Phase |
| --- | --- | --- | --- | --- |
| T1 | Time clock | Existing | Preserve clock-in/out; verify self-only writes and duplicate-click concurrency | 1A |
| T2 | Timesheets | Existing | Add approval/locking, missed-punch workflow and consistent pay-period totals | 1A |
| T3 | Overtime highlighted | Not found | Configurable reviewed rules; regular/overtime split, visible flags and reproducible export | 1A |
| T4 | Auto clock-out | Not found | Durable job, flagged estimated closure, notification and correction path | 1A |
| T5 | Late-arrival reports | Not found | Staff shifts + grace + leave/holiday exceptions; scheduled-versus-actual report | 1A |
| L1 | PTO tracking | Not found | Requests, approvals, balances, cancellation and corrections | 1B |
| L2 | Sick tracking | Not found | Separate policy/ledger; private reasons and employee visibility | 1B |
| L3 | Holiday tracking | Not found | Clinic calendar; distinguish closures, paid holidays and eligibility | 1B |
| L4 | Who's-off calendar | Not found | Approved dates/names only for staff; confidential details restricted | 1B |
| L5 | Automatic accruals | Not found | Effective-dated rules, unique accrual keys, reconciled balances and rerun safety | 1B |
| O1 | Kennel rotation | Not found | Confirm meaning; recurring fair staff-duty assignments and coverage swaps | 2 |
| O2 | Quick tasks | Partial | Extend daily task system with ad-hoc tasks, assignees, due dates and completion history | 2 |
| O3 | Message board | Not found | Separate staff board with pins, acknowledgments and controlled edits | 2 |
| C1 | Fluid calculator | Not found | Reviewed inputs/formula/units, tested reference cases; optional patient attachment | 4 |
| C2 | Shock fluid calculator | Not found | Separate reviewed protocol, species/context checks and explicit reassessment steps | 4 |
| C3 | Chocolate toxicity | Not found | Reviewed product/concentration data and uncertainty handling; no invented concentration | 4 |
| C4 | Gestation | Not found | Species/date basis, reviewed ranges and clearly labeled estimates | 4 |
| C5 | Interactive dental chart | Existing | Validate charting, species/dentition, save/sign/addendum, patient timeline and release output | 4 |
| C6 | AI discharge instructions | Partial foundation | New discharge draft/review workflow grounded in signed clinical sources | 5 |
| C7 | AI bloodwork helper | Partial foundation | Lab-linked draft explanation with units/ranges, sources and veterinarian review | 5 |
| C8 | AI pill ID | Not found | Assisted identification using verified reference data; uncertainty/rejection and manual verification | 5 |
| W1 | Payroll summaries | Partial foundation | Approved time/leave and effective rates → frozen period summary/export | 3 |
| W2 | Raises | Not found | Effective-dated rate changes; private history and audited approval | 3 |
| W3 | Bonuses | Not found | Approved, period-specific adjustments; duplicate-proof export | 3 |
| W4 | SIMPLE IRA forms | Not found | Provider-approved current documents, assignments, private uploads and completion tracking | 3 |
| W5 | Anonymous peer reviews | Not found | Separate eligibility from anonymous responses; aggregation threshold and restricted results | 3 |
| W6 | Automatic backups | Partial, hosted unverified | Scheduled protected database + Storage recovery, failure alerts and successful restore drill | 0 + ongoing |
| E1 | Birthday pop-ups | Not found | Opt-in month/day display, annual deduplication, dismiss/snooze | 2 |
| E2 | Anniversary pop-ups | Not found | Employment milestones, consent/display preference and annual deduplication | 2 |
| E3 | Party RSVPs | Not found | Attendance choices, deadlines and organizer counts | 2 |
| E4 | Event signups | Not found | Capacity, signup/cancel, waitlist and concurrent-last-seat protection | 2 |

## Evidence and reuse boundaries
- Time: `src/hub/pages/TimeClockPage.tsx`, `MyTimePage.tsx`, `src/hub/hooks/use-time-clock.ts`,
  `src/hub/components/timesheet/AllStaffTimesheet.tsx`, `src/hub/features/time-clock/`.
  Existing daily totals use Denver boundaries; the displayed past-seven-day total is a rolling window,
  not a configured payroll workweek. Range filters and browser-local formatting need pay-period review.
- Atomic corrections: `supabase/migrations/20261106170000_atomic_time_clock_corrections.sql`.
  Preserve stale-update protections. The admin UI explicitly lacks an add-missed-shift workflow.
- Tasks: `src/hub/features/daily-tasks/` already supports operational templates and actions.
  Its current categories/triggers are operational; it does not establish arbitrary quick tasks or kennel rotation.
- Dental: `src/hub/features/dental/PatientDentalChart.tsx`, `tooth-chart.ts`,
  `supabase/migrations/20260913070000_dental_chart.sql`, `tests/dental/tooth-chart.test.ts`.
- AI groundwork: `src/hub/features/clinical/recap/`, `supabase/functions/clinical-recap-process/`,
  `clinical-note-process/` and corresponding shared handlers. Record recaps/dictation are distinct from the requested helpers.
- Labs: `src/hub/features/diagnostics/PatientLabWorkspace.tsx`, `src/hub/features/lab-work/`.
  Results/review groundwork exists; this does not establish an AI bloodwork explanation workflow.
- Recovery: `docs/restore-runbook.md`, `scripts/restore-rehearsal/README.md`, `run.py`, physical-file fixtures and
  `docs/launch-evidence/2026-09-24-current-stack-restore-rehearsal.md`.
  Synthetic restore evidence does not prove current hosted backup schedule, retention or recoverability.
- Navigation: `src/hub/components/layout/nav-items.ts` supplies desktop/mobile navigation centrally.
- Scope: native Living Room Vet product. No GreenTree changes, ongoing ezyVet synchronization or new integration registration.
