# Public estimate decision browser contract

Status: proposed; no decision implementation or provider activation. September 16, 2026.

Depends on the frozen publication contract and the forthcoming server decision/grant contract. This document defines browser behavior and integration boundaries; endpoint names below are proposals until reconciled with that server contract.

## Existing evidence and reusable parts

- `src/main.tsx` already intercepts payment and `/shared/` capabilities before importing `App.tsx`. Payment bootstrap removes the fragment synchronously, sets no-referrer/noindex metadata, and clears its mutable token on pagehide/hashchange. Reuse this stronger lifecycle; the older document bootstrap retains an immutable token prop and lacks equivalent clearing, so do not copy it wholesale.
- `src/shared/payment-client.ts` supplies a dependency-light, no-Supabase-session transport pattern: exact origin validation, POST body capability, omitted credentials, no redirects/cache/referrer, bounded streamed JSON, timeout plus caller abort. It has no mutation receipt recovery suitable for decisions; reuse the principles, not payment state names.
- `src/shared/document-link-client.ts` verifies raw artifact byte length/SHA256 and renders inert documents. Reuse its byte verification and restrictive CSP concept. Publication HTML is already captured with its own CSP; display the exact stored bytes without rerendering or rewriting them.
- `src/hub/features/estimates/publication-api.ts` already binds preparation, publication, target, artifact metadata, immutable revision and exact receipts. It depends on staff RPC/session handling and must not be imported as the public transport.
- `useEstimatePublicationOperation.ts` demonstrates persist-before-write, exact-ID recovery and terminal closure. Extract/adapt a dependency-free state helper only if useful; public code must not import staff auth, Supabase client, staff workspace or marketing modules.

## Isolated bootstrap and capability lifetime

Intercept `/estimate` and every `/estimate/…` pathname before `App.tsx`, including malformed IDs, so invalid capabilities cannot fall through to marketing/auth instrumentation. Accept exactly one UUID path segment and the server-defined, separately prefixed decision token. Reject extra segments, query capabilities, encoded separators and malformed fragments. The server contract defines e1. followed by a 43-character unpadded base64url HMAC-SHA256 signature; do not reuse document/payment token types.

Before any dynamic public-page import: capture the fragment into a mutable access object, remove both fragment and query with `history.replaceState(null, '', pathname)`, set no-referrer and noindex/nofollow/noarchive metadata, and set a neutral estimate title. Invalid input clears the token immediately. Do not log original location, include it in error telemetry or attach analytics/session replay to this route. The fragment is not sent in the initial HTTP request; query strings are, so never support token-in-query links.

Token exists in memory only. No local/session storage, cookies, IndexedDB, service-worker cache, React query persistence, navigation state or download URL includes it. Clear on pagehide, hashchange, unmount and explicit close; abort in-flight requests and invalidate their generation. A BFCache restoration is closed and requires reopening the original link. Hashchange closes the current capability rather than accepting a new one inside the existing workspace. A late response cannot restore a retired token or confirm a different grant/publication.

## Transport and exact document review

Create `src/shared/estimate-decision-client.ts` with closed schemas and no staff dependencies. Proposed methods: `inspect(access)`, `artifact(access, expected)`, `submit(access, operation)`, `recover(access, operation)`, and `close(access, operation)` only if the server offers durable terminal closure. All calls are POST to allowlisted Edge endpoints under the configured exact HTTPS backend origin (HTTP localhost only for tests). Send grant ID in the closed JSON body and the token in the dedicated X-Estimate-Capability header, never Supabase Authorization or cookies. The public Edge entry uses verify_jwt=false and explicit capability authentication. Public publishable key, if gateway-required, is configuration rather than identity.

Use `credentials:'omit'`, `cache:'no-store'`, `redirect:'error'`, `referrerPolicy:'no-referrer'`, request timeout and caller cancellation. Bound request bodies and streamed JSON; initial proposal 64 KiB decision metadata, with explicit separate 2 MiB stored artifact limit. Enforce Content-Type, exact byte count, SHA256 and canonical attachment filename; expose required response headers through CORS. No signed storage URL or rerender fallback.

Inspect returns a minimal public projection: grant/publication identifiers, exact artifact metadata/content hash, deadline, decision head/status, household/patient display needed to identify this estimate, and acknowledgment wording/version. Never expose staff IDs, internal draft/operation contexts, inventory/financial internals or unrelated household history. Bind every response to the original grant and publication and every receipt to exact operation ID/request. Do not trust an estimate ID alone.

Explicit “Open estimate” loads information; opening/link scanning never accepts or declines. Render exact captured HTML in an iframe with an empty sandbox and no-referrer, backed by a verified Blob URL. Revoke Blob URLs on replacement/close. Display current eligibility separately from the immutable document: the document may retain its original deadline while current server status says withdrawn, replaced or unavailable. Never silently switch a pending decision to a replacement publication.

## Decision intent and attribution

Acceptance is for the entire exact publication and its quantities/prices/terms; no line editing, substitutions, treatment completion, prescription authority, payment or stock effects. Require explicit Accept or Decline, self-reported name and relationship/authority attestation, document/terms acknowledgment as defined by the server, and a final action-specific confirmation. Do not precheck attestations or default to Accept. Keep decline reason optional unless the final server contract explicitly requires it.

A proposed token-free pending operation stores `{version, id, grant_id, publication_id, request}`. The exact request binds publication/content/artifact hashes, reviewed decision head, action, self-reported signer fields, acknowledgment version and required attestations. Names/optional reasons are personal data even without a token: use sessionStorage only, a narrowly scoped key, strict size/schema validation and no document copy. Never persist a bearer token, token hash used as a credential, or a URL containing it. On confirmed receipt or durable closure remove the pending entry. A storage failure blocks submission before any network write.

Label public evidence “Submitted through a private link; name and relationship supplied by the respondent.” Possession of a link does not authenticate the named owner. Do not label it verified identity, staff signature or clinical consent. Record server timestamp; device clock is display-only.

## Exact recovery state machine

| State | Permitted action | Required behavior |
|---|---|---|
| Closed/no capability | Reopen original link | No network capability calls; explain that access details are not saved. Preserve pending request. |
| Ready, no pending request | Review, select decision | Server eligibility and exact artifact verification precede submission. |
| Submitting | Wait | Persist immutable operation before POST; disable both decision actions. |
| Uncertain | Recover original; retry identical if server permits; terminal close if supported | Never clear pending merely because response was lost, request aborted, or recovery returned null. |
| Recorded | Show exact receipt | Clear pending only after strict ID/grant/publication/request validation. Show accepted/declined and honest attribution. |
| Closed unrecorded | Review current evidence again | Clear pending only after durable closure under the same operation gate; retain form values but clear document review/attestation. |
| Access unavailable with pending | Reopen original link or contact practice | Preserve uncertainty. Do not say “nothing was saved” or enable a fresh opposite decision. |

After reload the fragment is absent by design. Show recovery guidance without requesting or storing a password/token. Reopening the original link in the same tab recovers the token-free pending operation for that exact grant/publication. A different grant does not adopt it. New-tab/cross-device use may have no local pending entry; server decision uniqueness and current status are mandatory, not browser storage locks.

A null recovery result is only a point-in-time absence; an earlier request may still commit. An expired/revoked grant error is not proof of noncommit. Prefer server support for narrowly scoped exact historical receipt recovery with the original valid secret even after decision eligibility ends, returning no fresh document access or new write authority. If policy rejects all access after revocation, keep the pending request and direct staff to reconcile its operation reference. The browser must support either server policy without treating denial as absence. Never retry a new UUID to escape uncertainty. Server closure, if offered, must serialize with submission and permanently block that same UUID before reporting closed unrecorded.

Stale preview/head, expired deadline or replaced publication can reject a new operation, but cannot justify discarding an earlier uncertain operation. Server must check existing exact receipts before current eligibility where its authorization policy permits. Local countdowns are informative only; eligibility and outcome are server decisions.

## Staff-witnessed offline decision is separate

A staff workflow may record an offline client decision only through an authenticated, separately named RPC/UI. It freezes staff actor, reported client name/relationship, channel (in person/telephone/written), occurrence time versus recording time, exact reviewed publication and evidence/notes. Label “Recorded by staff from an offline decision.” It cannot fabricate a public-link submission, borrow a grant token, backdate a server receipt or automatically mark a client digitally verified. Require active staff after waits and exact-ID recovery. Any ability to record an after-expiry historical decision or amend an existing decision is a separate explicit server/business policy, not a browser exception.

## Files and validation gates

Implementation paths are relative to `/Users/davidedler/livingroom-vet-estimate-decisions`.

1. Modify `src/main.tsx` for isolated route/bootstrap; create `src/shared/EstimateDecisionPage.tsx`, `estimate-decision-client.ts`, and optionally dependency-free `estimate-decision-state.ts`. Preserve existing payment/document entry behavior.
2. Add public Edge handler/runtime and private service-only RPC wiring only after the database/Edge contract freezes. Never expose raw service-role RPC access in the browser. Server validates token digest, rate limits, grant/publication eligibility and exact replay/closure atomically.
3. Add staff decision grant/history/witness UI separately to the publication workspace. Existing stored publication artifact is reused byte-for-byte. Grant issuance/delivery must not imply a decision or authorize provider delivery.
4. Unit tests: closed shapes, target substitution, wrong original ID/request, monetary precision, malformed JSON/oversized stream, UTF-8/hash/filename mismatch, original capability expiry during uncertain recovery, durable closure and persist-before-write failure.
5. Browser tests: invalid-route isolation; no auth/marketing imports or storage reads; token stripped before first request/import; token absent from storage/referrers/download names; exact inert bytes; explicit accept/decline; lost response/reload/original-link recovery; expired/revoked/replaced status while pending; late responses after retirement; BFCache/hashchange; mobile/readable attribution; no double submission; keyboard/focus behavior.
6. Actual Auth/Edge/SQL tests must prove unauthorized raw RPC denial, exact concurrency/replay, accept versus decline race, decision versus expiry/revoke/replace races, and historical receipt policy. Transport mocks cannot establish these guarantees.

## Decisions awaiting the server contract

- Exact token prefix, Edge request/response names, decision head and receipt shapes.
- Resolved server policy: inactive capabilities cannot recover receipts; retain uncertain intent and use authenticated staff reconciliation. Active capabilities support exact recover and durable terminal close.
- Exact signer relationship/authority wording, decline reason policy and staff-witness eligibility. These are explicit product decisions, not claims of legal enforceability.
