# 4A2b — Staff prompt handoff

Foundation: [PR #248](https://github.com/finite0001/livingroom-vet-care/pull/248). The foundation is merged and hosted182/production verified. The staff prompt and reviewed recovery are approved and merged in [#249](https://github.com/finite0001/livingroom-vet-care/pull/249); both hosted backends183 and production/domain verified. [Hosted receipt](../../docs/launch-evidence/2026-10-13-next-visit-staff-rollout.json). [Package plan](plan.md).

## Completion and durable access

Use one shared `NextVisitOutcomeDialog` and `PendingNextVisitOutcomes` on Home and Schedule. The queue is independent of selected calendar date. Show Pending and Schedule later with saved attribution/date; completed booked/declined receipts remain accessible from the patient/visit. Closing an untouched prompt leaves the occurrence pending. Completion never rolls back merely because staff close or defer the scheduling prompt. A confirmed completion may have follow-up eligibility false because the patient is deceased/archived: keep the saved completion and disable scheduling; do not describe it as a failed completion.

`useAppointmentStatus` must retain the confirmed completion receipt and invoke `onCompleted(context)` instead of discarding RPC data. Home's Complete visit and Schedule's Complete use the actor/action/expected-version completion RPC. Check-in stays on its existing canonical path. Handle duplicate clicks/unknown acknowledgment with the same stable request/action, not a fresh status save.

Both managed and custom editor Status=COMPLETED paths also need the prompt. Add a narrowly scoped read RPC for the exact captured `(appointment_id, completed_version)`; the immutable trigger occurrence is the authority. Never guess the newest appointment or manufacture an occurrence from a toast. If the occurrence has become historical, display its recorded completion and current status, disable new decisions, and offer the current patient/visit link.

## Review and booking

Read the occurrence's frozen patient/household, current/stale flags and saved outcome first. Show active future appointments with explicit pagination using the original server `as_of`; include unassigned bookings with a clear label. Selecting an existing appointment sends its ID/current version to the atomic outcome RPC, avoiding another booking. Re-read the linked booking's current status separately from its immutable saved receipt; cancellation/rescheduling never erases the original decision.

Read bounded due-care pages separately. Label source-current care/vaccine plans as reviewed; planned/ordered labs retain their actual status. Link to the patient record for clinical review. Do not calculate an interval, advance a care plan, administer a vaccine or automatically choose an appointment date from these read-only facts. Stale-anchor plans must not appear as reviewed recommendations.

Extract the existing AppointmentEditor with a narrow optional follow-up context containing occurrence ID/version and frozen source identity. Reuse species/type/resource filtering, reviewed binding/defaults, explicit override notes, Denver time/DST, clinician availability, housecall address/travel buffers and conflict UI. The follow-up submitter routes custom or catalog values into `save_next_visit_outcome`; it never books first and links afterward. New follow-up status is active; exact source patient/client must match. No hidden catalog fallback when a publication retires or changes.

Three actions: Schedule next visit, Schedule later, Client declined. Later accepts an optional staff-review date and note; decline is explicit and attributed. Neither action sends a client message or changes clinical due dates. Booked/declined are final for that occurrence; later can be revisited using its saved outcome version. A concurrent resolution refreshes the saved decision before another booking attempt.

## Reload/session recovery

Keep the reviewed request frozen after an uncertain response, including a subsequent permission denial. Check/retry recovers the original actor/request/action. Never treat a timeout or a missing read receipt while another transaction is pending as proof that the earlier action failed.

Persist only actor-scoped operation identifiers in browser storage. Keep addresses, notes and reviewed request payloads in a private server-side reviewed envelope so reload can restore the exact request after active-session authorization. Add bounded prepare/read/cancel semantics in the staff-workflow migration; envelopes cannot be adopted by another actor or changed under the same UUID. Cancellation/expiry must preserve any committed receipt and must not authorize a second booking. The existing outcome head/version remains the final duplicate-prevention authority. Clear visible cached clinical drafts on logout/account change; an inactive or different account cannot resume the original actor's work. No credentials or private keys enter the browser.

Reuse the existing dirty-navigation guard and frozen action UI, extending recovery for persisted envelopes. Controls must protect an uncertain draft on close, route navigation and unload. Show the difference between unsaved text, a confirmed completed visit, a pending next-visit decision and a confirmed booking.

## Acceptance before review

Real Auth/PostgREST/browser tests: Home completion; Schedule completion; editor completion through both save paths; pending recovery after reload/date navigation; custom/catalog follow-up; existing future selection and unassigned rows; reviewed/proposed/stale care display; later/decline without undoing COMPLETED; booking conflict/stale publication; response lost after commit; reload/retry; permission or account change after lost response; one booking across tabs; current cancellation/status display; historical completion identity; dirty navigation; iPhone44px controls and no horizontal overflow. Retain the existing SQL/native/restore coverage and add populated envelope restore. Practice defaults remain Susan proposals; no provider/task gates are enabled.

## Implemented recovery contract

Private reviewed requests support complete / editor / decide operations. A24-hour expiry blocks uncommitted execution, never recovery of a committed receipt. Current live same-actor sessions may restore the immutable request. Cancellation serializes with execution and retains a tombstone for a missing preparation. The editor operation covers custom/catalog COMPLETED saves, including fresh completed inserts and notes edits that capture no new transition. Browser identifiers contain no clinical payload. Patient360 aggregates scheduling dirtiness with its existing clinical guard. [Evidence](../../docs/launch-evidence/2026-10-13-next-visit-staff.md).
