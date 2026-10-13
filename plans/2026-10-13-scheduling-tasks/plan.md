# Batch6 implementation preparation — appointment types and daily tasks

Prepared from merged main `20b035f1e93ac4629b4051dedbff736952cc267f`, after #245/179 rollout. The dependency/config repair is [PR #246](https://github.com/finite0001/livingroom-vet-care/pull/246); Dave approved its merge on October13; merged as `ba2b1c734448f679db0e39fb77081e683ff05251`, with production READY. Requirements remain N23–N25/H13–H14. This preparation does not create a migration, change a practice template or enable automation.

## Verified foundation

`src/hub/features/scheduling/SchedulePage.tsx` already books duration, a free-text appointment reason/resource, clinician, clinic/housecall address, travel buffers and reminder offsets. Its booking save calls the canonical actor-scoped `save_appointment` overload. `use-appointment-status.ts` passes the existing fields back for status changes and only shows a toast after success; it has no durable next-visit outcome.

The current save core in migration `20260928190000_no_retryable_sqlstate_for_permanent_conditions.sql` uses schedule lock73260123 before the appointment row, expected-version/PT409 handling, household/patient/staff checks and clinician/resource collision detection including travel time. Saving skips stale pending reminders and creates reminders for the saved revision. Appointment triggers independently guard patient identity, active staff assignment and immutable creation metadata. Closed appointments cannot be reopened through the existing contract. Preserve these semantics and the current Denver timezone/Google Maps route helpers.

## Reviewable packages

1. **4A1: Appointment-type and resource catalog.** Draft/review/publish versioned practice templates: category, species, visit mode, duration, resource and buffers. Explicitly map existing free-text resources to stable IDs; keep historical labels. Extend the current locked booking path rather than introducing a second scheduling authority. Freeze selected template/resource versions and any reviewed duration override into the appointment snapshot. Existing appointments remain truthful legacy/custom records. Catalog edits must not change old snapshots or bypass collisions. No guessed clinical durations or room names are seeded as approved templates.
2. **4A2: Next-visit outcome.** Record a durable completion occurrence and staff outcome: book now, schedule later or declined. Show existing future appointments and reviewed due-care context for this patient. A lost acknowledgment recovers the same occurrence/action; it never silently books a second visit. Completion remains complete when staff defer scheduling. Booking a follow-up uses the existing patient/client/conflict/reminder checks.
3. **4B: Operational task templates and generation.** Separate facilities tasks from clinical intake. Versioned templates cover room turnover, surgery preparation/cleanup and restocking with reviewed trigger, due-time and role rules. Generate per appointment/resource/template-version/occurrence under the existing schedule-first lock order. Rescheduling/cancellation revises outstanding tasks and preserves completed audit history; canceled work requiring review stays visible. Restocking completion never increments inventory automatically. Keep the reconciliation worker off until bounded staging acceptance.
4. **4C: Daily list and reconciliation.** Add Home/Schedule task views with role/assignee filtering, attribution, overdue state and44px mobile controls. Reconciliation repairs missed instances idempotently and reports conflicts. Use the existing operation/worker controls and canonical outbox only where an accepted notification rule needs it; do not create another provider dispatcher.

Each package gets a generated migration filename where needed, all migration-count tripwires, local replay/SQL and meaningful browser tests, an exact-head PR, specific merge approval, staging-first installation and a default-off primary receipt. Never regenerate Lovable's `types.ts`; new RPC DTOs use strict Zod validation.

## Acceptance before rollout

Exercise species/type/resource mismatch, stale catalog revision, concurrent room/clinician bookings, travel buffers and Denver DST. Prove no historical snapshot mutation after template edits. Retry completion/next-booking actions after a lost response and demonstrate one recorded outcome/booking. Race task generation versus reschedule/cancel/completion, preserve finished checklists and exact actor/session authorization, and deny inactive/wrong-role/direct anonymous writes. Verify an iPhone-sized daily list and real housecall route behavior. Fixture times/types/checklists remain synthetic until Susan accepts practice configuration.

## Practice configuration still required

Exact appointment names/lengths, supported species, room/resource identities, clinical override rules, surgery preparation/turnover timing, restocking checklists and staff role/assignment rules. Dave chose draft defaults for Susan on October13. [Review proposals](susan-defaults.md). If defaults are used, they remain proposals and need clinical review; they cannot become published templates implicitly. All45 launch requirements and Susan's final workflow acceptance remain open.

[Original scheduling requirements](../2026-10-08-vet-feedback/phase-04-scheduling-tasks.md). [Completed diagnostic rollout](../../docs/launch-evidence/2026-10-13-diagnostic-pdf-record-packages-rollout.md).

4A1 implementation is now in [the catalog package](../2026-10-13-appointment-catalog/plan.md). Next-visit outcomes and daily-task packages remain pending.
