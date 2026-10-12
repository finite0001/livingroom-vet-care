# Package 3B2B — private processing and actual PDF artifact registration

Implemented locally; required PR checks and specific merge approval precede hosted rollout. Prerequisite [#241](https://github.com/finite0001/livingroom-vet-care/pull/241) is merged and production READY at `9456f515613cc3a132583763d55007161e1cedfc`. The new additive migration brings the repository to 176; hosted backends remain at 175. No runtime policy, scheduler or provider delivery is activated. All 45 launch requirements and practice acceptance remain required. See [implementation evidence](../../docs/launch-evidence/2026-10-11-diagnostic-pdf-registration-implementation.md).

## Outcome

For one immutable reviewed diagnostic job, recover or generate the same admitted bytes, store those bytes privately, verify the actual stored object and register a source-bound artifact. Preserve #240's immutable capture/status/actor. Registration is a separate readiness projection; it does not authorize a staff download, record release or provider delivery. Those are 3C/3A2.

## Persist the inputs before rendering

- Freeze the job's already-captured patient display fields and exact reviewed diagnostic version. Do not query mutable patient or diagnostic roots during rendering.
- Select at most one immutable reviewed version per historical panel, as of the source review timestamp, including the exact source version. Record the eligible census, included census, ordering/comparison definition and explicit truncation. Later corrections cannot change the saved rendering manifest.
- Persist the complete canonical history/source manifest, exact escaped HTML hash and UTF-8 length, expected documentary text checks, template/validator/worker/image/font/settings provenance and renderer/settings fingerprints. Verify canonical serialization and server-derived hashes; client-supplied hashes cannot establish authority.
- A lost preparation reply recovers the exact prior manifest. Changed history, template, provenance or HTML cannot reuse its stable operation identity. Never render again after an immutable capture exists.
- Validate Zod contracts at every TypeScript boundary. Keep browser credentials and Lovable-generated types unchanged. Server-owned staff data remains shared by role, with authenticated/server-stamped actor attribution.

## Additive private contracts

Implemented responsibilities:

| Contract | Invariant |
|---|---|
| Immutable rendering manifest | One selected manifest per job; exact source/history/provenance/HTML identity |
| Separate processing state and attempts | Monotonic processing fence/claim, bounded expiry, current active request owner; no rewrite of original capture actor |
| Immutable validation receipt | Actual saved byte hash/length/page count and exact validator/provenance binding, recorded only for a live authorized processing claim |
| Immutable upload intent | Reserved private canonical path bound to job/capture hash/length/MIME; no public URL or overwrite |
| Immutable artifact registration | Actual Storage object ID, creation/update time/body generation, bucket/path/MIME/size plus independently read-back byte hash; one exact artifact per intent |
| Current status projection | Claimed/failed/stored separately from #240's `captured_unverified`; release eligibility remains false |

Use additive CLI-generated migrations and existing fixed-search-path private security-definer/service RPC conventions. Enable RLS and revoke direct access for public/anon/authenticated/service roles; expose only explicitly scoped RPC grants. Reject history updates/deletes/truncates. Keep all policies unseeded/off and add canonical inventory/restore tripwires.

## Fencing, actor changes and lock order

- Use #240's claim to generate/freeze/capture a new job; use a separate processing lease for captured-byte validation/upload/registration recovery.
- Recheck current request owner, active-staff state, exact policy/fingerprints and time after relevant lock waits and immediately before a write commits. Audit actual offboarding/policy writers before choosing shared locks; document one consistent lock order rather than relying on an unlocked early check.
- A new authorized owner may recover the same capture after offboarding/handoff. Original capture actor/claim/fence/bytes remain unchanged; new processing attempts have their own current actor and fence.
- Original-source corrections do not mutate old manifests or captured bytes. New reviewed versions have their own jobs. Withdrawal of a policy prevents new processing; an immutable saved receipt alone cannot override current eligibility.
- Stale processing workers cannot validate/register readiness, even if a privileged delayed Storage upload later completes. Service-role Storage bypasses staff RLS, so the database lease cannot physically prevent an already-in-flight upload. Restrict that upload to the immutable reserved path and identical captured bytes; a current worker may verify/recover it.

## Coordinator sequence

1. Use the operator-invoked worker with the known practice backend and service credentials; check default-off configuration before any job claim. Accept bounded identifiers only, never arbitrary HTML, paths, URLs, binary commands or print settings. Keep DB/control-plane credentials in the trusted coordinator, never in the VM.
2. Claim and recover the persisted exact rendering manifest. If no capture exists, invoke the approved pinned isolated renderer and admit actual bytes before first capture. This avoids permanently sealing an invalid first capture.
3. Save exact admitted bytes through the existing source/claim-bound capture RPC. If the capture acknowledgement is uncertain, recover the saved capture and compare actual identity/hash/length. Do not regenerate it.
4. Claim separate processing authority. Revalidate recovered captured bytes in a fresh credential-free bounded VM using a fixed validator command. Record an immutable validation receipt against those exact bytes and the live processing fence.
5. Reserve the canonical private upload intent. Upload captured bytes with `upsert: false`. If the reply is lost or the object already exists, read metadata and download its actual bytes with a streaming bound. Never overwrite or trust supplied MIME/size/hash metadata alone.
6. Verify downloaded hash/length and exact object ID/creation/update time/body generation/bucket/path/MIME/size, then register under the live processing fence. Registration rechecks owner/policy/time/source/intents after locks; swapped objects, different bytes, stale fences and reused conflicting identities fail.
7. Recover lost registration replies via exact immutable registration identity, returning its persisted receipt. Read current eligibility separately. Safely classify preparing, retryable uncertainty, capacity/admission failure, stale ownership and revoked policy; store bounded generic reasons without chart data or secrets.
8. Keep reserved-but-unregistered objects private and recoverable. Do not automatically delete them while privileged delayed uploads can still arrive. An explicit future cleanup contract must prove absence of live/resumable authority and exact actual-object ownership before deleting anything.

## Verification and remaining acceptance

- SQL ACL/RLS/direct-write/immutable-history tests; current owner vs original capture attribution; stable operation replay and changed-intent rejection.
- Observed concurrent job/processing/profile/policy lock waits, expiry while waiting, offboarding, handoff, policy withdrawal, source correction and stale worker attempts. Verify actual blocked sessions, not guessed timing.
- Actual-byte admission before capture, unchanged recovery, malformed/oversized/trailing PDFs, substituted receipt/provenance/history and incompatible measurement context.
- Genuine synthetic local Auth → source manifest → native renderer → capture → private Storage upload → bounded download → exact registration. No mocked Storage object or fabricated validation/readiness receipt.
- Crash/lost response after manifest preparation, capture, upload and registration; two uploaders; delayed stale upload; object replacement/mismatched bytes; retry without duplicate artifacts or byte regeneration.
- Full restore of manifests, captures, attempts, validation/upload/registration evidence and original Storage IDs/creation metadata; archived/deceased patients retain records while automatic communication suppression remains separate.
- Required exact-head frontend, Edge, database, native runtime and browser checks. Staging then primary dry-run/backups/probes/actual synthetic round trip after specific PR merge/rollout approval. No clinical worker commissioning or outbound provider send is implied.

The implemented evidence covers the actual isolated coordinator, current-owner handoff, observed revocation/expiry waits, lost preparation/capture/upload/registration replies, exact-byte Storage and populated ledger restore. Additional adversarial two-uploader/delayed-upload and object-body disaster-recovery drills accompany worker commissioning; staff retry/review and release invalidation accompany 3C/3A2. These are not claimed complete by default-off private registration.

## Following acceptance

3C adds staff preparing/failed/retry/review/download behavior with exact private bytes. 3A2 adds schema-14 diagnostic selection and exact reviewed artifact capture into selective record release. Susan reviews report layouts and workflows; clinician acceptance and delivery commissioning remain separate from engineering proof.
