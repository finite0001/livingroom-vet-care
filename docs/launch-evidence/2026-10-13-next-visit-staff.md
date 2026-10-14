# Next-visit staff workflow — 4A2b

Foundation [#248](https://github.com/finite0001/livingroom-vet-care/pull/248) merged as `a368a891f89b4ec1f1aed67c5533c62b2772ec07`. Staging and primary have canonical182, and the production domain points at the READY merge deployment. [Hosted receipt](2026-10-13-next-visit-foundation-rollout.json), [exact-head CI](2026-10-13-next-visit-foundation-ci.json), [protected foundation preview](2026-10-13-next-visit-foundation-preview.json).

The staff package adds migration183 `20261013233839_next_visit_staff_recovery.sql`. Dave approved [PR #249](https://github.com/finite0001/livingroom-vet-care/pull/249); it merged as `1b5b6a9bda816b840fdf32ccd724187edb7c1d23`. Both hosted backends are183 and production/domain are verified READY. [Hosted receipt](2026-10-13-next-visit-staff-rollout.json).

## Staff behavior

Home Complete visit, Schedule Complete and both custom/catalog editor COMPLETED saves open the same next-visit review. Completion stays committed when the dialog closes. Pending and Schedule later are available independently of the selected calendar date. Patient Schedule shows recorded outcomes, including booked and declined visits.

Book a custom or reviewed catalog follow-up through the existing editor, explicitly use a same-patient future appointment, schedule later with optional staff-review date/note, or record a client decline. Booking and its outcome commit atomically. Existing future appointments retain server as-of pagination and show unassigned bookings explicitly. Reviewed care and planned/ordered labs retain their actual labels. No clinical interval, clinical advancement or client send is inferred.

The dialog retains exact frozen identity/history and disables decisions on historical/inactive occurrences. Linked booking status is read separately; cancellation or rescheduling preserves the original saved decision. Patient drafts share Patient360's aggregate navigation guard, so scheduling cannot replace the guard for another clinical draft.

## Recovery and authorization

Next-visit browser storage contains only actor/action/operation identifiers. Private immutable envelopes hold the exact reviewed request, with a24-hour execution expiry and32 pending reviews per actor. Current active staff and a live Auth session are required to prepare, restore, execute or cancel an envelope. A new live session for the same actor can restore it; another account cannot adopt it. Visible drafts clear across account changes.

Completion, custom/catalog editor completion and follow-up decision all have exact replay receipts. Editor completion reads its exact trigger-captured version; notes-only changes to an already-completed appointment do not manufacture another occurrence. A lost completed-insert acknowledgment cannot create another completed appointment on retry.

Cancellation takes schedule → care locks and returns any committed receipt. Releasing a not-yet-confirmed preparation leaves an immutable cancellation marker, so late preparation cannot resurrect that UUID. Expiry/cancellation cannot erase a saved receipt, bypass the authoritative outcome version or allow direct canonical execution of an expired/cancelled reviewed action. Permission failure following an uncertain result retains the original review until it can be checked.

## Verification

Final verification is recorded in [local receipt](2026-10-13-next-visit-staff-local.json). The owned runtime replays all183 canonical migrations, tests SQL, real Auth/PostgREST, observed parent scheduling locks, desktop/mobile browser workflows and populated envelope/outcome restore. Intentional response interception only drops a successful local acknowledgment after its real database commit. These local tests made no provider requests, hosted writes or legacy writes. Subsequent approved hosted rollout is recorded separately below.

Approved rollout completed: canonical183 installed with `--skip-vault`, no roles/seeds/Vault changes, after protected definition/ACL backups. Both backends passed49 rollback assertions with unchanged row snapshots. Staging passed25 genuine Auth/API and19 desktop/phone browser checks; synthetic publications/bookings were retired/cancelled, patients archived and accounts/sessions deactivated. A cleanup-helper multi-role selection bug was corrected before primary rollout; the workflow checks had already passed. Primary persisted no synthetic fixtures. All diagnostic/release policy counts, payment profiles and outbox counts remained unchanged. No provider requests, new Edge deployments or legacy writes occurred. Production READY matches the merge SHA and domain alias; public login200,0 browser errors, protected-route redirects and anonymous diagnostic download401 verified.

Susan's default appointment/task templates remain review proposals. Daily task templates/generation are4B and the daily task list/reconciliation is4C. All45 original launch requirements and Susan's final workflow acceptance remain required. The disregarded Weave request is not queued here.

[Phone screenshot — synthetic local records](screenshots/2026-10-13-next-visit-staff-mobile.png). Date labels include the year because the queue spans calendar years.

Patient/household scheduling signals and appointment timelines refresh after completion or follow-up saves. A real-browser check verifies the patient summary updates after booking within the record. The existing records contention harness now observes a ready idle transaction and holds it until its waiter is visible, with nonblocking output capture; forward32/reverse31 assertions pass. Owned local security advisors report only the pre-existing `pg_net` public-extension warning, with no notices for this package.

The final [CI receipt](2026-10-13-next-visit-staff-ci.json) reports all four required checks passing on the approved head; the existing390px deep-link test passed on retry and its focused desktop/phone recheck passed. [Protected preview](2026-10-13-next-visit-staff-preview.json) was an availability check before hosted acceptance. [4B implementation design](../../plans/2026-10-13-operational-tasks/plan.md) is prepared; task code/generation is not implemented or enabled by #249.
