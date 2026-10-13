# 4A1 — Reviewed appointment types and stable shared resources

Base: approved #246 merge `ba2b1c734448f679db0e39fb77081e683ff05251`. [Exact-head CI](2026-10-13-diagnostic-edge-config-ci.json), [merge/production receipt](2026-10-13-diagnostic-edge-config-merge.json). Production is READY; the public login loaded against primary with zero page errors and anonymous Edge access denied. This is public availability evidence, not authenticated clinical acceptance. Hosted backends remain179 and permanent worker/provider gates remain off.

## Result

Tools → Appointment catalog lets active DVM/ADMIN users save, explicitly review and publish an exact draft, or retire it from new bookings. Active staff see published choices. Definitions cover well/sick/procedure, species, visit locations, default or case-specific duration, travel buffers, staffing, resource kind and permitted time overrides. There are no seed templates or room mappings. [Susan proposals](../../plans/2026-10-13-scheduling-tasks/susan-defaults.md) require practice review.

Booking offers only types matching species and location and resources matching the selected type. Explicit selection proposes times. Required staffing, resource, case duration and override note are enforced by the server. Existing reviewed bookings retain immutable versions and fields after catalog revision or retirement. Staff can change unrelated notes/time/status through existing APIs, or explicitly replace/restore reviewed settings, including the original housecall destination. A stale publication cannot silently become a custom visit or an empty resource.

Migration180 adds six private RLS ledgers and active-staff RPCs, without editing generated types. Stable resource identity is compared on both sides of collisions, including historical aliases and renamed resources. Publishing aliases cannot merge overlapping active bookings. Catalog, reviewed booking, legacy saves and cancellation use the existing schedule lock before row locks. Both10/17 argument saves remain;10 preserves housecall/resource/travel/reminders and its null-status default. Direct service inserts/updates and private-core execution are revoked. Unbound historical entries can preserve existing labels but cannot adopt published names/aliases through legacy edits.

Each reviewed action has an actor-scoped immutable request and receipt. Exact retries/recovery return the original result before checking subsequent catalog changes. Changed requests/actors are denied. Unknown responses freeze the review; subsequent permission denial cannot prove that the earlier action failed. Both editors protect unsaved/unconfirmed drafts on close, navigation and unload. No provider workers, calls, payments or clinical orders are introduced.

## Verification

- Fresh180 migration replay and complete SQL regression:147 files /5,989 assertions, including72 new scheduling assertions. Existing reminder/conflict/status regressions pass.
- Genuine local Auth + PostgREST:55 checks, including6 observed advisory-lock queues (typed vs legacy capacity, duplicate action, retirement vs booking),20 desktop/mobile browser checks, and9 populated restore checks. All six populated ledgers restored identically; private write/execute privileges stayed denied and the original receipt recovered against the restored database. No Storage-body backup is claimed for this package.
- Native browser proof used real database responses; it deliberately dropped successful save responses to test acknowledgment recovery. It also removed/restored active access between a lost response and retry and verified frozen recovery. Replacement tests cover household changes and original housecall destination restoration. [Phone booking](assets/2026-10-13-appointment-booking-mobile.png), [desktop booking](assets/2026-10-13-appointment-booking-desktop.png), [phone publication review](assets/2026-10-13-appointment-catalog-review-mobile.png).
- Disposable wrapper verified unique project/container ownership, unchanged migration/harness hashes, and removal of its containers/volumes. Other local runtimes were untouched.
- Unit suite:1,375 passing; final lint/typecheck/build pass (four existing lint warnings). Focused browser recheck:50 passing, including both initial failures and scheduling/patient360/inventory/record-release coverage. [Local receipt](2026-10-13-appointment-catalog-local.json). Exact-head CI receipts will be recorded with the PR.

The first broad browser run had522 passes,1 existing skip and2 failures. The inventory fixture needed the new catalog read contract; the other failure was in an unchanged record-release flow. Focused recheck and exact-head CI establish the final browser result; do not treat the initial run as fully passing.

## Rollout and next work

Specific approval of the new PR is required before hosted180 or merging it. Verify migration/hash/project references; apply180 to staging, run bounded genuine acceptance and read-only rollback checks, then primary. Apply the backward-compatible database foundation before the merged frontend requires the new catalog RPCs. Confirm production READY and the correct backend afterward. There are no Edge Function deployments or enabled reconciliation/provider jobs in this package. Existing manual scheduling continues until staff explicitly publish reviewed configuration.

Requirements N23/H13 are implemented by4A1 but still require hosted and Susan acceptance. N24 next-visit outcomes and N25 daily tasks remain separate packages. H14 appointment reminders already exist and are preserved. All45 original launch requirements remain tracked; this is not full launch acceptance. The disregarded Weave request is outside this repository.
