# 4A2 — Durable next-visit scheduling

Build from the merged #247 catalog/eligibility correction and #248 foundation. Both hosted backends are182; production #248 is verified. N24 requires a prompt after completion, reviewed due-care and existing future appointments, and book now / later / declined outcomes. No clinical intervals, messages or practice defaults are inferred.

## Foundation package (4A2a)

Preserve schedule → care → row order in the compatibility10-argument wrapper as well; reminder preparation takes care before sharing the row.

Capture every actual transition into COMPLETED with an AFTER trigger, including completed inserts and 10/17/managed saves. Freeze appointment version, patient/household, actor/time and current catalog binding. Notes-only edits do not create another occurrence. Keep historical occurrences after cancellation or another completion; old occurrences cannot make new decisions. No historical backfill.

Private RLS completion occurrences, outcome heads, immutable outcome revisions and actor/exact-request receipts. Completion RPC provides acknowledgment recovery. Outcome RPC holds schedule → care → occurrence/appointment row locks; replay precedes current-state validation. Later can be revisited; booked/declined are final for that occurrence. Book now invokes the existing catalog or custom canonical booking and saves the link in one transaction. Existing future appointment selection validates exact patient, version and active status. Another tab/action cannot book a second follow-up for the same occurrence.

Read APIs expose unresolved occurrences independently of calendar selection, current/stale occurrence context and bounded keyset future bookings/due care. Freeze an explicit server as-of for future pagination. Reviewed care plans must remain source-current; vaccine plans with stale-anchor flags require clinical review rather than being presented as reviewed recommendations. Planned labs remain labeled planned/ordered. Completion and decisions never advance care plans or send reminders themselves.

Strict Zod boundaries and meaningful SQL/native Auth concurrency/replay/restore tests. Update all migration inventories and restore tables. Deliver a reviewable foundation PR; no hosted writes or merge until Dave specifically approves that PR.

## Staff workflow package (4A2b)

Shared next-visit dialog and unresolved list on Home/Schedule, triggered after confirmed completion from Home, Schedule cards and both editor paths. Reuse the existing appointment editor for custom/catalog bookings. Show current reviewed context, existing appointments, historical/current flags and decision receipt. Closing leaves pending work durable. Persist uncertain action envelope by authenticated actor and occurrence; freeze inputs until recovery or definitive failure, including permission loss. Do not expose another household's draft on account change. Verify reload/date navigation and phone layout.

## Acceptance

Full replay, both closed-status changes/recompletion, frozen household, retired catalog completion, role/session/direct-table denial, expected-version conflicts, exact actor/request replay, observed schedule/care queues, simultaneous decisions, collision rollback, unknown acknowledgement recovery, existing future booking validation/pagination, reviewed/proposed/stale care separation and populated restore. Extend owned local scheduling runtime; preserve provider gates and synthetic cleanup. Susan's practice acceptance and the full45 requirements remain open.

## Current package

4A2b staff prompt, private reviewed envelopes and exact custom/catalog editor completion recovery are implemented in the review package. [PR #249](https://github.com/finite0001/livingroom-vet-care/pull/249) is approved and merged; repository/staging/primary183 and production/domain verified. [Staff evidence](../../docs/launch-evidence/2026-10-13-next-visit-staff.md), [hosted receipt](../../docs/launch-evidence/2026-10-13-next-visit-staff-rollout.json). Next is [4B operational task templates/use/generation](../2026-10-13-operational-tasks/plan.md); that package is planned, not implemented or enabled.
