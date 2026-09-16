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
