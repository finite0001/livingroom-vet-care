# Native conversation attachments

Status: implementation plan based on inspected baseline `7bded87`, not completed functionality or provider acceptance. This independent work stream follows the recorded standalone platform direction. PRs144–149 own prescribing, dispensing and returns; do not overwrite or duplicate that work. Preserve the familiar inbox/composer layout and current recipient, consent, idempotency and delivery-recovery boundaries.

## Evidence and actual gap

- `src/hub/pages/ConversationDetailPage.tsx` passes empty attachment IDs for both email and SMS.
- `src/hub/hooks/use-attachments.ts` has no consumers. Its legacy upload path writes bytes and metadata separately, has no immutable-byte review binding, and uses a timestamp-derived path. Wiring it into the composer alone does not establish safe delivery or recovery.
- `20260913020000_communications_outbox.sql` requires an empty attachment array. `20260913120000_message_recovery.sql` also rejects attachments during prepared-request creation. Both must agree with any new supported payload.
- `features/communications/queue-intent.ts` fingerprints attachment IDs and preserves uncertain requests. Keep the same request and exact reviewed content through uncertain responses; never silently send changed attachments under an old request.
- `_shared/outbox-dispatch.ts` reconstructs provider data from immutable outbox fields and already verifies frozen email payloads for reviewed records/invoices. Reuse or extend that boundary deliberately, without turning arbitrary uploads into clinician-approved record releases.
- The initial standalone matrix also identifies inbound binary retrieval and attachment-only visibility as missing. Outbound upload support alone does not close the conversation-attachment requirement.

## Implementation sequence

1. Inspect current storage policies, frozen-email preparation/readers, inbound provider metadata and authorization. Confirm which historical schemas are deployed and select a unique migration version after concurrent branches. Establish explicit file count/size/type limits and server-side verification, with provider limits verified against current official documentation before coding transport changes.
2. Implement staff-owned, conversation-scoped upload reservations in a private bucket. Bind each immutable completed file to an opaque ID, uploader, conversation, original display filename, verified type/length and SHA-256. Use random storage identities; reject overwrite, cross-conversation reuse, unsupported content and incomplete bytes. Define recovery and abandoned-upload retention rather than allowing silent orphan accumulation.
3. Integrate explicit file/recipient review with durable message preparation. Freeze the exact file identities and hashes with recipient, subject and body. Serialize competing preparation and abandonment; preserve recovery after an uncertain response. Restrict ordinary binary attachments to supported email delivery; do not infer MMS support.
4. Bind queued delivery to the exact reviewed artifact. Verify stored bytes against frozen metadata before any provider attempt. Preserve provider configuration checks, lease/retry rules, uncertain-send reconciliation and all disabled delivery gates. Clinical records remain subject to the established selected-record release workflow.
5. Add attachment controls to the existing composer without moving its established send/recipient controls. Show upload progress/errors, remove-before-review, filename/type/size, pending request recovery and accessible download states. Account changes and unsaved drafts must not leak or discard file selections silently.
6. Implement inbound attachment-only message visibility, provider-verified metadata and private binary retrieval with explicit unavailable/quarantined states. Never fetch arbitrary provider-supplied URLs; apply the selected provider's authenticated retrieval boundary and verify content limits. Authorize each retrieval against active staff and the relevant message/conversation.
7. Validate SQL/Storage/Auth/Edge/UI together, then commission controlled authorized provider round-trips. No send is implied by implementing or locally testing this plan.

## Required acceptance evidence

- Real Auth/Storage local roundtrip: owned upload, metadata/byte verification, exact frozen selection, queue receipt, authorized retrieval and cleanup/recovery.
- Deny anonymous, inactive, foreign-staff/foreign-conversation access as appropriate to the current conversation access model; do not invent stricter assignment rules without checking existing policy.
- Reject missing, replaced, oversized, mismatched-type, duplicate or changed bytes; block unsupported SMS attachments and unapproved clinical disclosure.
- Retry the same request after failures at upload completion, preparation, queueing and acknowledgment; exactly one queued message and the same immutable files must result.
- Demonstrate that edit/remove/change-recipient requires a new reviewed intent, and that uncertain provider outcomes do not cause automatic duplicate sends.
- Test inbound attachment-only content, failed retrieval, unauthorized retrieval, malformed filenames, unsupported files and cross-message references.
- Desktop/mobile rendered workflow, keyboard/focus/errors, preserved draft navigation, and existing text-only messaging/release/invoice regressions.
- Record exact code/migration hashes, hosted environment parity, controlled provider delivery/reply evidence and staff acceptance separately. Local tests do not prove commercial readiness.

## Boundaries still open

File scanning/quarantine policy, provider attachment limits, safe retention/deletion timing, inbound provider retrieval contract and client-facing display wording require concrete design from current code/provider behavior. No default should silently weaken existing disclosure, consent or delivery safeguards. Fastmail and Resend remain the approved mail direction; Stripe remains sandbox-only/deferred as recorded in the standalone roadmap. Do not restart retired ezyVet migration-report development as a prerequisite for this native feature.


## First implemented increment: inbound metadata and visible file-only messages

The processor now validates bounded email attachment metadata, strips non-allowlisted properties, rejects duplicate IDs and malformed entries into durable review, and preserves unnamed/zero-byte metadata without claiming usable files. Email without plain text distinguishes actual HTML, attachment-only and empty content. SMS media-only messages receive visible text only after the existing exact signed/provider body verification. Malformed media counts route to review. No binary attachment is downloaded or sent by this change.

Validation: all41 inbound/inbound-review unit tests passed, including seven new attachment cases; targeted ESLint and Deno typechecking passed. The initial test attempt lacked dependencies in the fresh worktree; npm ci installed the existing lockfile with zero reported vulnerabilities. The initial lint control-character-regex finding was corrected to character-code validation. No schema, hosted deployment, provider request or rendered/Storage acceptance is claimed. Next: staff-owned upload reservation/immutable bytes and authorized retrieval, then reviewed attachment sending and controlled provider proof.

Provider reference checked September16: Resend supports attachments within a40MB total encoded email limit ([outbound documentation](https://resend.com/docs/dashboard/emails/attachments)); receiving webhooks provide metadata and the authenticated attachment API supplies expiring download URLs ([receiving documentation](https://resend.com/docs/dashboard/receiving/attachments)). These provider capabilities do not establish our own implemented retrieval or delivery acceptance.


## Private upload implementation under validation

Work continues on `codex/native-conversation-uploads`, based on PR150 commit17a23e1. The uncommitted migration20260916100000 adds private actor/conversation reservations, exact idempotent reservation recovery, a20-pending-upload cap, pending abandonment, immutable finalized hash/metadata and storage policies without object update/delete access. A trusted service-only verification RPC checks active actor, ownership and storage metadata; an authenticated Edge handler downloads via the user's Storage access, checks actual length/MIME/container signature, computes SHA-256 and finalizes. A matching container signature is not malware scanning or complete document parsing. The composer and outbound queue are not integrated yet.

The entry point passed Deno typechecking. Six focused handler/byte tests passed from `/tmp/lrv-verify-conversation-attachment.test.ts` (temporary while the disposable source hash is pinned); move that test into `tests/communications/` with relative imports once the current run ends. Database/Storage access is mocked in those six tests, so they do not prove real Storage acceptance. SQL tests cover reservations, cross-owner denial, finalization permissions, idempotency, abandonment and immutability, using synthetic storage metadata rather than real uploaded bytes.

Active disposable runner session19694 owns `lrv-attachment-8f30bd073ee0`, using65421 and115 local migrations. Protected working directory: `/var/folders/j9/dv101nxj5_xd3rjcjkq6_xd40000gn/T/lrv-attachment-8f30bd073ee0-epzhap0b`. Startup was slow but the owned database appeared; the process remains live, not failed. Do not restart merely on an observation timeout. Do not edit tested source/migrations until terminal result. Poll session7363 only if the recent docker inventory command remains running. No SQL or full integration pass is claimed yet.

Remaining next checks: actual authenticated Storage/Edge roundtrip, invalid reservation/byte cases, interrupted/replayed verification, concurrent abandonment and role changes, deterministic UI upload recovery and private retrieval, reviewed outbound binding, retention/cleanup and provider acceptance. Verify finalization acknowledgment shape before the handler reports success. Retain owner-only draft access; decide published-message access through the existing conversation authorization model. No hosted mutation, provider send or commercial readiness claim.


## Upload recovery helper and resource-pressure checkpoint

Added `src/hub/features/communications/attachment-upload.ts` with injected transport: validates exact actor/conversation/file/path receipts, retains caller-provided upload identity, verifies after ambiguous upload failure, never overwrites an existing object, re-verifies ready recovery and compares server hash against the selected file's actual bytes. Seven recovery cases plus six verifier tests and eight existing queue-intent cases pass (21 communication tests). The verifier tests now live in `tests/communications/verify-attachment.test.ts`; their temporary absolute import was replaced with the repository-relative path. These frontend helper/test additions are not in the running disposable harness source inventory and do not modify the pinned backend/migration sources. The helper is not yet mounted in the composer or wired to a live transport.

Targeted ESLint completed and `npm run typecheck` is still running in session97786; no typecheck pass claimed. Disposable session19694 remains live in Supabase startup; owned database healthy but application migrations were not yet recorded at last read. CLI PID69232 was sleeping with0% CPU after roughly10 minutes. Read-only host measurements showed load average323.89 and4667MB swap used out of5120MB. Do not launch additional heavy validation or duplicate the running stack under this pressure. Revalidate the exact handles; observation timeouts are not terminal failures. A docker inventory read may still be completing in session78186. No hosted writes, provider calls, readiness pass or test-result substitution.


## PR150 CI completion

GitHub run35083444414 for PR150 reports all three jobs passing: frontend8m10s, Edge31s and database13m18s. This CI covers the inbound metadata/file-only visibility increment, not the uncommitted private-upload additions. PR150 was moved out of draft after that result. It is not a live deployment or complete attachment-workflow acceptance.

The upload disposable session19694 and typecheck session97786 were both re-polled and remain live with no terminal result. Host load remained extreme (390.45 one-minute average at the latest read), so no duplicate heavy validation was started. Retain these handles and inspect actual completion before treating either as failed or restarting.


## Local startup failure, receipt hardening and isolated CI coverage

Disposable session19694 ended with exit1 during Supabase start/initial schema setup, before application SQL or integration assertions. The protected log does not establish a specific root cause. Owned containers and volumes were independently verified absent. Extreme host load is observed context, not proof of the failure cause. Session97786 completed successfully: application typechecking passed. No local validation process from that run remains active.

The verifier now requires its finalization receipt to match exact file ID/owner/path/length/MIME/hash, ready status and a valid verification timestamp before returning success; missing, mismatched or lost acknowledgments remain503/recoverable. Active staff is rechecked after row locks in the reservation lifecycle. Fifteen focused upload/verifier tests pass, including two new acknowledgment cases, and targeted ESLint plus frozen Deno entry-point checking pass. Prior21 communication checks included the eight unchanged queue-intent cases; these overlapping counts must not be added together.

Added an explicit-local-only Auth/Storage integration script and CI step. It uses canonical household/conversation RPCs, actual owner/foreign/anonymous Storage access, handler byte verification, retry, trusted-RPC denial and overwrite/delete denial. It has not yet run successfully; SQL and this actual-byte acceptance remain pending CI. Native upload migration inventory is115 on this branch; restore and disposable inventory gates explicitly include20260916100000. The branch is a draft backend/recovery increment, not a complete attachment UI or delivery feature. No hosted deployment or provider send.


## Authenticated client adapter checkpoint

Added `attachment-upload-api.ts`: the authenticated client uses the reservation RPC, immutable private Storage upload and ID-only verification endpoint. It checks the active actor before and after each await, and propagates RPC/Storage/Edge failures. Five adapter cases cover exact requests, signed-out/changed accounts and late responses. All28 communication unit tests pass together; targeted ESLint and application typechecking pass. The actual-byte CI fixture now also exercises the production recovery helper and adapter against an existing uploaded object, with only the Edge HTTP host replaced by direct handler invocation; Auth and Storage remain actual local services. This expanded fixture is not yet a passing result.

CI35085949803 on earlier commitddf0ff3 passed Edge checking and completed the SQL-test stage, then continued into database concurrency checks; frontend browser checks remain active at this checkpoint. Preserve that exact-head distinction until current changes complete their own CI. The next reviewed-send boundary is documented in outbound-binding.md; it is not implemented or deployed.
