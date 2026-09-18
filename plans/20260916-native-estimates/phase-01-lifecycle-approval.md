# Phase 1–2: immutable estimate publication and attributed decisions

Priority: next native workflow. Status: design only.

## Context and file ownership

Implementation root: `/Users/davidedler/livingroom-vet-native-estimates`; this is the isolated dependent worktree. Paths below are relative to that root.

- Create `src/hub/features/estimates/estimate-api.ts`, `estimate-state.ts`, `HouseholdEstimates.tsx`, `EstimateEditor.tsx`, `EstimatePublication.tsx`, `EstimateHistory.tsx`.
- Modify `src/hub/pages/ClientProfilePage.tsx` to mount the staff estimate workspace.
- Create `src/shared/EstimateDecisionPage.tsx` and `estimate-client.ts`; modify `src/main.tsx` with an isolated `/estimate/:grantId#token` entry point.
- Create new timestamped migrations after inspecting the actual integrated stack; do not edit already deployed migrations or guess the next filename.
- Create thin Edge handlers and private shared modules for prepare/capture/retrieve/decide/recover, following existing document-link and invoice-document boundaries.
- Create focused SQL, strict-adapter, actual local HTTP/Auth, contention and browser suites. Remove no legacy record or route implicitly.

Inspected reusable foundations: invoice-document prepare/capture/outbox (migration2700), document capability grants (2800), payment grant lifecycle (3400), and document-link post-wait authorization (`20260914110000`). Shared document links are read capabilities, not estimate decision rights. ClientProfilePage is staff-only, not a general client portal.

## Data and immutable lifecycle

1. Draft root binds household, patient and staff creator; edits compare an expected version and append a complete history. Exact decimal quantities and integer USD cents; no floating point monetary conversion.
2. A published revision freezes practice/household/patient display, ordered line IDs, product/kind/units, quantities, allocated prices and totals, inclusion/exclusion terms, validity semantics, decision wording and renderer/schema versions.
3. Prepare the snapshot, render/capture exact bytes, then publish only after validating the reviewed draft head, artifact digest and complete financial terms. Recipient changes never regenerate its content.
4. Publication availability is open, expired, revoked or superseded. An immutable accepted/declined decision is a separate event. A replacement supersedes the old publication atomically; an old signature never approves new terms.
5. Explicit staff withdrawal records actor/reason/history. Revoking a lost delivery grant does not cancel an accepted estimate. Catalog/contact changes do not invalidate a frozen publication.
6. Decision history is paginated with explicit completeness. Link each decision to exact revision, artifact hash and terms; retain attribution after expiry, replacement or withdrawal.

## Decision contract and security

Use a separate domain-separated capability with an unguessable fragment token. Keep tokens in memory, strip URL fragments promptly, exclude analytics/auth bundles, use no-store/no-referrer responses and sandbox document display. Do not persist bearer tokens or expose raw decision tables to anonymous callers.

Closed decision request: stable ID, grant ID, revision ID, artifact hash, expected publication head, accept/decline choice, signer name, signer relationship, optional bounded comment, acknowledgment version and explicit review attestation. Server derives capability scope or authenticated staff identity; no client-supplied actor authority.

Bearer-link decisions are attributed to possession of that grant plus self-reported signer details. Do not label the signer as identity-verified. Staff-witnessed decisions use a distinct RPC and include communication channel, occurrence time, witness reason and session actor. Neither decision grants clinical consent, household portal membership, prescribing authority or payment authority.

Serialize publication/withdrawal/replacement/decision on one estimate root gate. After waiting, recheck active staff or valid grant, current publication, exact artifact and expiry. Concurrent opposing decisions have one winner. An exact retry returns the original immutable result; a changed request with the same ID is rejected.

Persist exact pending decision intent without its bearer token. Recovery must bind original request and scope. Expired/revoked access returns unavailable, not a misleading absent result. Authorized staff can reconcile history. If a submitted decision may still commit, browser discard must not unlock a replacement; provide a serialized resolution operation if re-review makes the original impossible, following the finance closure lesson.

## Delivery and UI

Staff preview amounts, expiry and terms; explicit publish confirmation binds the captured artifact. Client page clearly identifies practice, patient, total, terms and revision; accept/decline requires a readable document and explicit acknowledgment. Display recorded outcome and attribution without implying payment or treatment completion.

Reviewed delivery freezes recipient, grant, exact document and message through the existing durable outbox; use Fastmail/Resend architecture. Do not send real messages during synthetic acceptance. Delivery grant expiration/revocation and resend must not alter accepted content. Staff edits and uncertain requests survive sibling cache invalidations and navigation safeguards.

## Acceptance checklist

- [ ] Draft conflict and stale publication rejected; exact historical bytes remain retrievable by authorized viewers.
- [ ] Cross-household/patient, wrong grant, actor, revision, hash and expanded request fields rejected.
- [ ] Client page cannot call staff mutation RPCs or access unrelated records.
- [ ] Accept/decline, expiry, revocation, withdrawal and replacement races observed with actual database blocking.
- [ ] Lost decision/publish/close replies recover exactly across reload; malformed replies never unlock replacement.
- [ ] Public token absent from persisted state, logs and analytics; authorization rechecked after waits.
- [ ] Real local HTTP/Auth and staff/client browser acceptance; populated restore preserves every artifact, grant boundary, decision and attribution.

Next dependency: accepted revision/line identity and lifecycle must be stable before charge execution is added. Business wording and Dr. Edler review remain live-launch gates.
