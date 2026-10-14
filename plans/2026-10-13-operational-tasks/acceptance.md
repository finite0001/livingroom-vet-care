# 4B acceptance and rollout

The first4B implementation must prove all applicable cases below. Planning alone does not satisfy them.

## SQL / real Auth / concurrency

- Direct anon/authenticated/service table writes and private-helper execution denied; inactive actor, mismatched actor/session and retired session fail. New session of original actor recovers exact saved operation.
- Draft unchanged exact DVM/ADMIN publication; STAFF cannot publish. A reviewer with both roles remains eligible. Invalid keys, duplicate selectors/checklist IDs, unpublished/stale catalog selections and inactive/wrong-role assignees fail.
- Lost prepare/execute/publication/use/task acknowledgment recovers one exact result. Same UUID with another actor/operation/request fails; cancel before prepare prevents late resurrection; commit wins late cancellation.
- Explicit selected surgery/preparation type generates; consultation and free-text “surgery” do not. Resource rename preserves stable identity and frozen evidence.
- Same generation retry creates one logical slot. Republished template does not create another active slot. Existing task retains its original checklist/rule until explicit supersession.
- Custom/slim/full/catalog/new-COMPLETED/editor/cancel paths see correct final source facts; managed binding is visible when generation executes. Notes-only changes do not create duplicate instances.
- Reschedule updates unfinished due times, preserves revision history and completed evidence. Resource reassignment keeps actual use/cleanup attached to original resource.
- Before-use cancellation withdraws untouched preparation; started preparation/open use requires review. Explicit end remains possible after cancellation; cleanup and restock obligations persist.
- Multiple real use occurrences are distinguished. Resource-day restock deduplicates coverage, including cross-midnight/Denver DST. Late use after completed restock creates additional explicit work without rewriting completed evidence.
- Concurrent generation/reschedule/cancel/use-end/task-completion races use observed lock waits and deterministic assertions. Test schedule-first lock order against reminder care locks; do not use fixed sleep as proof.
- Completed/mandatory-checklist/assignment evidence remains immutable; restock completion produces zero inventory movements. A worker cannot assert physical use or complete tasks.
- Default-off/effective-range generation produces no implicit history backfill; existing safety revisions still run when new enrollment is disabled.
- Populated restore preserves template versions, private reviews/cancellation markers/action receipts, use events, coverage, unfinished and completed tasks. All native schema/count tripwires include the new migration.

## Genuine browser workflow

Use a uniquely owned disposable runtime for local tests and bounded fresh synthetic staging actors/patients/types/resources only. Verify actual RPC results, not only mocked labels.

- Tools template route visible to DVM reviewers; exact saved draft publication, stale draft response, multi-role eligibility and wrong-role denial.
- Explicit actual-use start/end UI; canceled appointment can still show/end use, retained cleanup and Needs review. No check-in/completion button implies room readiness.
- Dirty close/Escape/outside/back/template/filter change confirms loss; preserved Router7 patient clinical draft guard.
- Lost successful response freezes fields; reload/check/unchanged retry creates one action. Permission loss hides clinical payload and retains original actor pointer; second account sees no other-account recovery.
-390px phone viewport: no horizontal overflow, all controls at least44px, readable source/version/Denver timing and error state. Keyboard focus returns to meaningful source action.
- Loading/failure/incomplete catalog or task pages explicitly visible; no false empty success. Synthetic fixture labels/dates remain visibly synthetic.

## Required repository checks

Run meaningful unit/Zod/SQL tests, owned native replay/Auth/browser/concurrency/restore, `npm run check`, required frontend/edge/database/diagnostic-renderer CI and relevant security advisors. Report actual pass/retry/skip counts. Do not change ignored secrets or generate `types.ts`. New notices need explicit explanation; don't call a baseline advisory clean.

## Hosted rollout and closure

Pin PR head and migration SHA; only canonical expected migration pending, no roles/seeds/Vault changes. Back up affected definitions/ACL/constraints in a protected local directory. Stage first with49-style rollback probe patterns generalized to new operations; use fresh UUIDs, unused synthetic contacts and scoped counts. Rollback snapshots cover all touched auth/clinical/task/outbox/policy/inventory tables.

Genuine staging acceptance uses fresh Auth sessions and exact workflow. Clean up via canonical cancellations, retire synthetic publications/templates, archive owned patients, deactivate actors and revoke sessions/tokens. Retain immutable evidence; never disable history guards to delete fixtures. Verify zero active synthetic accounts/patients/bookings/publications/sessions and unchanged provider/payment/outbox baseline. Cleanup failure blocks primary until resolved.

Primary acceptance uses rollback-only synthetic fixtures and public denial/read metadata; no persisted synthetic staff/clinical records. Recheck exact head/checks before approved merge. Verify production READY matches merge SHA, domain alias resolves to that deployment, staff routes remain auth protected, browser asset selects primary and anonymous diagnostic download remains denied. No provider/worker/notification commissioning. Record package receipt and preserve all original paths in the implementation archive.
