# Package 2C — records requests and complete selective packages

Base: merged care PR #236, `77cf8d52af68a9372a716838e260ec65ea5649c4` (172 migrations). Owner requested continuing implementation. New PR needs its own specific approval before merge/hosted installation. No real send, policy activation, generated types or hosted clinical fixtures are included.

## Product and authorization boundary

- Incoming/outgoing requests require authoritative household/patient IDs; optional existing ticket/conversation linkage never guesses identity from free-text tickets.
- Assignment, request/due dates, counterpart/request notes and requested subset persist with optimistic versions and immutable exact-action receipts/history.
- Incoming receipt/fulfillment links actual finalized same-patient originals at exact versions with matching Storage metadata. Historical evidence remains inspectable after later void/deletion, with current availability shown separately.
- Owner selected client contacts and authorized third parties. Add named verified third-party email recipients, client authority/basis, exact numbered-manifest source scope, evidence and explicit expiry/revocation. Third-party SMS is not added; client SMS retains the protected-link workflow. Informational incoming clinic names cannot authorize disclosure.
- Requested → awaiting response/preparing → received/ready → fulfilled, plus blocked/cancelled. Preparation, enqueue, provider acceptance, delivered and recipient acknowledgment remain distinct. No manual “sent” checkbox manufactures delivery.
- Full/vaccine/lab presets and paged custom explicit selection feed immutable numbered manifests. Vaccine-only excludes medications and broad originals. Required lab originals/provenance expansions need explicit content review.

## Source and delivery architecture

1. Audit the read-only discovery chain; mark its volatile discovery cores STABLE, without changing global authorization rechecks. Capture all candidate pages in one SQL statement into a deterministic source inventory, frozen capture time and explicit unavailable/unreviewed exclusions. Prove consistency with an observed concurrent insertion between pages.
2. Close source/original dependencies bidirectionally; form connected components. Number deterministic packages respecting 20/100 source-family caps, 24 originals, 1 MiB snapshot and conservative encoded-transport capacity. Exact HTML/original byte builders remain the authoritative final capacity checks. A single oversized component fails explicitly rather than losing dependencies.
3. Store per-package exact selection, schema13 preview/hash and fixed release UUID. Validate union against the frozen inventory: every selected source belongs exactly once, dependency-only additions are disclosed, and no unrelated family enters a preset.
4. Dedicated package confirmation validates request version/manifest hash, reuses the private current clinical confirmation core under the request action, and inserts the exact request/package/release association atomically. Preserve clinical acceptance gate and immutable recovery.
5. Existing email preparation/capture/review/enqueue and protected SMS grants perform transport. Project outcomes from actual verified release/grant/outbox associations. Fulfillment requires all intended packages’ evidence; provider delivery is not an opened/read claim.
6. Guard linked releases through the latest private read/authorization contexts. Acquire request SHARE before source checks. Request cancellation changes only request state (no inverse outbox/source locks), so it serializes with final attempt authorization without holding a lock across provider HTTP. Unbound legacy releases retain behavior; fulfilled requests do not revoke unexpired grants. A third-party release cannot be confirmed outside the exact authorized request/package association, and authorization revocation participates in the same request-row serialization.

## Implementation files

Paths below are under `/Users/davidedler/Developer/lrv-records-requests-20261010`.

| Action | Path | Work |
|---|---|---|
| Create | `supabase/migrations/20261011025251_records_requests_and_packages.sql` | Private request/action/history/manifest/package/link tables; guarded write/read RPCs; discovery and disclosure boundary |
| Create | `src/hub/features/records-requests/` | Zod DTOs/API, frozen-action recovery, queue/editor, scoped patient/household/ticket links and package review |
| Modify | `src/App.tsx`, `src/hub/components/layout/nav-items.ts` | Authenticated queue/detail routes and shared tool navigation |
| Modify | `src/hub/features/patients/PatientPage.tsx` | Documents request section and retained-draft dirty guard |
| Modify | `src/hub/pages/ClientProfilePage.tsx`, `src/hub/pages/TicketDetailPage.tsx` | Scoped request links; preserve existing tickets |
| Modify | `src/hub/features/record-releases/PatientRecordReleases.tsx` | Forward numbered package context; new request source picker provides paged custom selection |
| Create | `supabase/tests/record_requests*.sql`, `supabase/tests/record_requests_concurrency.py` | Policy/evidence/partition checks and real lock/snapshot races |
| Create | `tests/records-requests/`, `e2e/records-requests.spec.ts` | Genuine local Auth/Storage, DTO and browser workflows |
| Modify | CI/restore inventory tripwires | Canonical migration count 173; required regression checks |

## Verification and completion gates

- [x] Request assignment/date/scope/ticket persistence, wrong-household/ticket linkage rejection, paged queue/history, stale-version and unchanged-action recovery.
- [x] Incoming actual original positive and missing/pending/voided/wrong-patient/version negative cases; unchanged Storage evidence retained.
- [x] 101-record and 21-record histories partition completely; vaccine subset excludes medication; connected provenance groups stay together; oversized component is an explicit error.
- [x] One-statement frozen capture survives observed concurrent source insertion; existing selected-source invalidation checks remain enforced; all package/source hashes and union match.
- [x] Confirmation binds once atomically; cancellation vs confirmation/final authorization has an observed outcome without deadlock; inactive/anonymous/service callers cannot make staff decisions.
- [x] Prepared/queued/accepted/uncertain/failed outcomes never invent delivery or receipt; all intended package outcomes required for fulfillment.
- [x] Real local Auth/Storage/PostgREST plus actual renderer/transport-boundary checks with synthetic sources and zero provider requests.
- [ ] Appropriate SQL/concurrency/unit/browser regression checks; clean 173-migration replay and exact-head required CI; reviewed PR and implementation receipt.

Practice acceptance, live provider round trips and real recipient authorization remain separate from engineering verification. No launch requirement is removed. Existing artifacts are HTML plus originals; diagnostic/generated PDF work remains phase 3.

## Engineering proof before PR

- 140-file database regression passed at 5,695 assertions; the final expanded records suite passes all 52 assertions (final combined inventory: 5,706).
- Genuine owned local Auth/private PDF/renderer/typed email queue: 36 assertions, including final-attempt rejection after authorization revocation; zero provider HTTP requests.
- Lock-observed concurrency: 23 checks; isolated race database removed.
- 1,298 unit tests, TypeScript, lint and production build pass. Existing four lint warnings and bundle-size warning are unchanged.
- Nine new browser workflows pass. The broad browser run passed 504 cases and retained the one existing skip; all six initial failures pass on the focused rerun, with the reload-time photo mock fixed. Required exact-head CI will supply the complete quiet run.
- Rollout and default-off acceptance boundary: [implementation receipt](../../docs/launch-evidence/2026-10-10-records-requests-implementation.md).
