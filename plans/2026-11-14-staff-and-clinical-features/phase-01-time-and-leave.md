# Phase 1: time clock and PTO first

Priority: first staff release. Status: proposed. Dependencies: phase 0 policy/access/recovery checks.
Read [integration rules](integration-and-release.md) and [photo checklist](feature-matrix.md).

## Why extend the existing implementation
Clock-in/out already runs through RPCs; time corrections have atomic stale-update protection.
Keep those boundaries. Payroll needs a fixed workweek and approved records, while today's dashboard
uses a rolling seven-day view. Do not use presence or on-duty flags to calculate pay.

## 0. Decisions and baseline
- [ ] Inspect hosted schema/RPCs and deployment receipts against current main; collect no employee data into Git.
- [ ] Record Denver clinic timezone, workweek start, pay periods, classifications, break rules and approved overtime policy.
- [ ] Record leave policy versions and opening balances with an import reconciliation report.
- [ ] Assign time/leave approvers and compensation viewers separately from generic application administrators.
- [ ] Confirm database/Storage backup coverage and a recovery procedure before accepting private HR records.
- [ ] Verify applicable employment/payroll rules against current authoritative sources during implementation;
      this plan intentionally sets no statutory rates, thresholds or entitlements.

## 1A. Attendance and timesheets
1. Extend existing time-entry RPCs additively. Preserve actor derivation from authenticated identity,
   one-open-entry invariants, concurrency protection and existing staff workflows.
2. Add immutable correction history and employee correction requests. Add a bounded admin-create-missed-entry
   RPC with employee, interval, reason and idempotency key; reject overlaps and forged actors.
3. Add pay periods, employee submission and manager approval; lock finalized period snapshots.
   Later corrections create reviewed adjustments rather than silently rewriting exported payroll.
4. Build one tested time calculation module for the UI/report/export, with server-authoritative final calculations.
   Split intervals at Denver day/workweek/pay-period boundaries. Explicitly handle breaks, DST and overnight work.
5. Apply versioned, reviewed overtime rules and employee eligibility. Highlight overtime in personal/admin
   timesheets; show unresolved/open/estimated entries separately. Do not label the rolling week as payroll totals.
6. Add minimal scheduled staff shifts, assignments, cancellations and grace policies. Keep patient appointments separate.
   Late reports compare the first matching punch with the scheduled start, accounting for leave/holidays and swaps.
7. Add a durable automatic clock-out worker with policy cutoff, grace and one-run-per-entry keys.
   Use database locking against simultaneous manual clock-out; save an estimated/system reason and notify the employee.
   Estimated closure needs review and must not silently remove actual worked time.
8. Add job health, retry visibility and an approval queue for missing/estimated entries.

### Proposed records
Reuse `time_entries`; add policy versions, staff shifts, correction requests, approvals/pay periods,
automation receipts and export snapshots. Exact table/RPC names are implementation decisions after live-schema comparison.
Keep compensatory rates and payroll amounts out of broadly readable profiles.

### Acceptance
- [ ] Repeated/concurrent punches produce one valid entry; staff cannot punch for another employee.
- [ ] A stale correction fails clearly; an authorized missed entry preserves the approving actor and reason.
- [ ] Overnight, DST, pay-period edges, breaks and all approved overtime reference cases agree in UI/export.
- [ ] Manual/automatic clock-out races produce one closure; retries do not change it.
- [ ] Lateness exceptions work; no schedule means unknown, not an inferred late arrival.
- [ ] Closed periods remain stable; adjustments are traceable; errors never appear as zero hours.

## 1B. Leave and who's off
1. Add private employment/leave settings and effective-dated PTO/sick policies, with eligibility, units,
   accrual basis, caps/carryover and negative-balance behavior supplied by the clinic.
2. Implement an append-only balance ledger for opening balances, accruals, reservations/debits,
   cancellations and reviewed adjustments. Never treat a mutable balance field as the source of truth.
3. Add requests for full/partial days, submit/approve/deny/cancel, comments and notifications.
   Define requested versus approved reservations explicitly; lock balance changes to prevent concurrent overspending.
4. Build the approved who's-off view with names/dates/coverage, excluding sick reasons and supporting documents.
   Add holiday dates/closures and paid-holiday eligibility as distinct concepts.
5. Run accruals through durable scheduled jobs. Choose calendar-based or approved-hours-based accruals
   per policy. Key each posting by employee/policy/period; reruns are harmless. Corrections post adjustments.
6. Integrate approved leave with shift coverage and attendance reports. Send approved paid leave totals
   to payroll only under the relevant policy; cancellation reverses exactly once.

### Acceptance
- [ ] Opening balance + postings reconciles to the displayed balance for each leave bucket.
- [ ] Duplicate accrual runs/approval clicks/cancellations produce no duplicate effects.
- [ ] Simultaneous requests cannot overspend policy limits; rejected requests do not consume leave.
- [ ] Partial days, holidays, year rollover, employment start/end and policy changes match approved examples.
- [ ] Staff can see their own requests/balances; peers see only approved availability.
- [ ] Direct API/RPC/Storage access cannot disclose leave reasons or change another employee's records.

## Files and PR boundaries
Repository root: `/Users/davidedler/Developer/livingroom-staff-feature-plan-20261114`.
All paths below are under that root; future work should resolve them in its own fresh worktree.

| Action | Files | Purpose |
| --- | --- | --- |
| Modify | `src/hub/pages/TimeClockPage.tsx`, `MyTimePage.tsx` | Existing employee time views |
| Modify | `src/hub/hooks/use-time-clock.ts`, `src/hub/components/timesheet/AllStaffTimesheet.tsx` | Time reads/actions and admin review |
| Modify | `src/hub/features/time-clock/time-totals.ts`, `admin-time-entry.ts` | Shared calculations and safe corrections |
| Create | `src/hub/features/leave/`, `src/hub/features/staff-scheduling/` | Models, APIs, request/approval/calendar and shift UI |
| Modify | `src/App.tsx`, `src/hub/components/layout/nav-items.ts` | Add authenticated leave/shift destinations |
| Create | New additive `supabase/migrations/*.sql` and matching disposable SQL tests | Private HR schema, RLS and atomic RPCs |
| Create | Bounded time/accrual worker(s) under `supabase/functions/` if needed | Durable jobs; prefer existing scheduler conventions |
| Extend | `tests/hub/time-clock.test.ts`, `scripts/time-clock/verify.py`, new leave/attendance tests | Existing clock behavior and new boundaries |

PRs: (A) policy/access/schema; (B) time approval/correction/calculation; (C) shifts/auto-clock-out/lateness;
(D) leave ledger/RPCs; (E) leave UI/jobs/integration. Each must retain the existing clock while gated work is incomplete.
No deletions planned. Migration inventories/types follow the repository's current workflow, not GreenTree's Lovable workflow.
