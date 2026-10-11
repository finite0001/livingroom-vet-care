# Package 2B — reviewed calendar care recurrence

Base: `979135b54c1eb9163dccc871977657045c8d5425`, merged Daily communications. Implements the next package from the October 8 feedback plan. No hosted migration, provider send, commissioning change or merge is included without the new PR's specific approval.

## Research and decisions

- Reuse `care_reminder_jobs`, `reminder_outbox_links`, the canonical outbox and existing dispatcher. Retain vaccine plans, lab orders and their clinical histories.
- Add a `care_plan` reminder source for wellness, bloodwork, vaccine follow-up and custom recurring care. A native lab collection/vaccine/service is evidence, not a second clinical record.
- New clinical defaults require an active named DVM's review; no seeded clinical intervals. Staff may propose patient plans, pause or retire them. Only a DVM can approve/resume current plans or attest completion. Existing vaccine/lab permissions stay unchanged.
- A patient plan snapshots the template's reviewed version. Later default changes do not silently alter that patient's schedule. Explicit interval/date/name/anchor overrides require rationale and fresh clinical review.
- Calendar units: days, weeks, months, years. Month-end behavior: clamp the original day or preserve month-end. Anchor: actual completed care or a fixed calendar schedule. Fixed schedules always calculate from the original anchor and cycle index, preventing month-end drift; late completion skips missed dates without fabricating completion records.
- Completion links an eligible, uncorrected service, vaccine administration or collected/resulted lab order for this patient. Date comes from that source in Denver. An immutable scheduling receipt advances exactly one occurrence. It does not create another physical treatment or lab result. Corrected/changed completion evidence requires plan review.
- Stable action IDs + canonical requests recover identical writes after lost acknowledgments, including after later plan changes. Changed payloads/actors conflict. Retired plans and completion/action receipts are immutable.
- New recurring-care delivery policies default absent/disabled and require reviewed daytime send windows in America/Denver. Existing commissioned policies remain unchanged. Quiet-hour work is deferred to the next opening, not marked as a failed clinical reminder.

## Delivery ordering contract

Existing final context locks job/source/patient after outbox, while death/source triggers hold patient/source and invalidate jobs. A deep additional lock would preserve an inversion.

Use a single transaction-scoped eligibility advisory lock for this single practice, acquired at participating RPC entry points before row locks and by BEFORE STATEMENT triggers for direct eligibility-table mutations. New functions acquire it first. No lock spans the external HTTP request.

Guard final attempt start, enqueue/queue, patient and appointment writes, due sources, message/policy writes, source corrections, retry preview/requeue and legacy reminder mutation paths. Preserve existing signatures/ACLs and PT409 semantics. Do not add a blanket outbox trigger; actual provider outcome recording remains free to complete after death. Final lease checks use clock time after waiting.

Death committed before authorized attempt start blocks routine patient work; death after that boundary preserves in-flight acceptance/delivery/uncertainty and stops future attempts. Living siblings remain eligible. Manual staff messages and financial communication retain their separate rules. There is no existing birthday scheduler; future patient-specific automation must use this boundary.

## Implementation sequence

1. **Database:** additive reviewed defaults, patient plans, immutable actions/completions/revisions; staff-safe paged reads; exact-source completion lookup; DVM approval; recurrence calculation and source-correction invalidation.
2. **Pipeline:** extend discovery/enqueue/final context, policy and quiet-window handling, eligibility serialization, safe Daily communications/operations projections and patient360 signals. Update migration/restore inventory tripwires to 172.
3. **UI:** recurring defaults beside existing Care reminders settings; patient Medical care-plans section; proposal/review/edit/pause/resume/retire/completion actions; source selection and preview; dashboard due cards; correct source labels, status-change invalidations and integrated dirty guards.
4. **Verification:** calendar model/schema cases; real SQL permissions/replay/version/source proofs; genuine local Auth; observed concurrent holder/waiter races; browser desktop/mobile, dirty navigation, lost acknowledgment/conflict and Daily communications regression.
5. **Review:** inspect final diff, run appropriate local checks and complete required CI. Create reviewable PR and implementation receipt; request the new PR's merge/hosted-rollout approval only after checks pass.

## Files

- New `supabase/migrations/20261010170259_care_plan_recurrence.sql` and the recurrence, delivery and source SQL test files.
- New `supabase/tests/care_plan_recurrence_concurrency.py`, `tests/care-plans/`, `e2e/care-plans.spec.ts`.
- New `src/hub/features/care-plans/` model, API, calendar helper, patient panel and reviewed template editor.
- Extend care-reminder dashboard and delivery settings, patient page dirty composition, patient form invalidations, patient360 source labels/signals, Daily communications safe SQL projection.
- Update `.github/workflows/ci.yml`, `tests/prescriptions/native-disposable.py`, `tests/ezyvet/attachment-metadata-disposable.py`, `scripts/restore-rehearsal/run.py`.
- No local generated `types.ts`, dependency changes, provider credential changes or parallel chart/billing store.

## Acceptance gates

- [x] Annual, quarterly, monthly/custom intervals, leap years, month-end and fixed-anchor late completion calculate correctly.
- [x] Staff cannot approve clinical settings/plans; DVM review and explicit patient overrides persist with actor/version provenance.
- [x] Completion source belongs to this patient, represents actual completed care and is uncorrected/current. Replays cannot advance twice; changed requests and stale competing edits conflict.
- [x] Reschedule/pause/retire/source correction invalidates old routine work; historical clinical and delivery evidence survives.
- [x] Real concurrency proves both death/start orderings without deadlock, live sibling eligibility, source/policy changes, lease expiry after waiting, completion replay and scheduler deduplication.
- [x] Quiet-window deferral creates no attempt/provider call, respects Denver/DST and does not blindly resend uncertain messages.
- [x] Server projections exclude bodies, capabilities, raw errors and secrets. Existing manual/payment and pipeline ownership regressions pass.
- [x] Mobile/desktop UI keeps drafts and action identities on recoverable errors; explicit reload/discard and patient navigation guards work.
- [ ] Required CI passes on the final head. Clinical/staff acceptance remains distinct from engineering verification.

## Remaining inputs

Actual clinical intervals, template reviews and live recurring-care policy activation belong to practice review. They are configuration inputs, not blockers to implementing the workflow. No clinical interval or provider activation is inferred from the examples.

Engineering evidence and hosted acceptance steps: [implementation receipt](../../docs/launch-evidence/2026-10-10-care-recurrence-implementation.md).
