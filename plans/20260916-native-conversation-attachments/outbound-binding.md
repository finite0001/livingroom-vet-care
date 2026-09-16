# Reviewed conversation email binding

Design checkpoint, not implemented acceptance. Based on inspected communication preparation/recovery, invoice/release frozen payloads and dispatch guard chain. Keep existing text-only message behavior intact.

## Request and review lifecycle

Reuse `communication_prepared_requests` and the existing composer scope/request UUID. Extend preparation only for EMAIL with a bounded unique ordered set of ready uploads owned by the actor and belonging to that conversation. Save the immutable file manifest with upload IDs, filename, MIME, byte length and SHA-256. Preserve at most one unresolved prepared request per actor/scope, unchanged request recovery and explicit abandonment; do not introduce a parallel composer state that bypasses those rules.

The proposed limits are five files, ten MiB per file and twenty MiB raw total, with the existing32MiB frozen-payload limit enforced after encoding. These are application limits, below the currently documented Resend40MB total encoded email cap. Exact supported PDF/PNG/JPEG bytes remain explicit, not a claim of malware scanning.

An authenticated preparation handler loads the owned request and verified files, rechecks hashes against actual bytes, and constructs the exact provider payload using configured sender/Reply-To. A service-only capture RPC independently binds recipient, subject/body, ordered files and decoded length/hash to the saved manifest. Capture is immutable and idempotent. Metadata alone cannot stand in for captured bytes.

A review dialog must show the exact recipient, subject, text and files before queueing. Queue via a dedicated authenticated RPC requiring the saved payload hash and explicit attestation. The existing ordinary enqueue path must continue rejecting attachments until that proof is supplied; do not enable attachment arrays on the private text core or silently send an email with its files omitted. Use the private text core only after proof validation, then bind the resulting outbox/message to the captured payload in the same transaction. Existing common recovery/acknowledgment can identify the one outbox receipt by the same request UUID.

## Dispatch boundary

Extend `read_frozen_email_payload` with a third unambiguous artifact kind. Preserve existing invoice and record-release readers. Detect multiple artifact associations rather than choosing one by precedence. The new reader must check the exact active outbox lease, immutable payload hash and reviewed link before returning bytes.

Extend the current `start_communication_attempt` wrapper chain without bypassing reminder, invoice, record-release, payment or document-link guards. Require the dispatcher-supplied conversation payload hash and configured sender/Reply-To to match the captured artifact. A missing, purged, malformed or changed artifact must prevent provider execution. Direct queueing of a draft or direct service invocation without the exact delivery proof must fail closed.

Use the existing verified frozen-email transport; do not add arbitrary remote attachment URLs. Preserve disabled delivery gates, consent/suppression, actual provider-attempt recording and uncertain-send reconciliation. Never rebuild a different payload under the same provider idempotency key.

## Required continuation checks

- Canonical SQL request ownership, exact/repeated preparation, competing composer request, abandonment, recipient drift and duplicate file rejection.
- Actual Auth/Storage capture using verified bytes; interrupted preparation/capture/queue/acknowledgment retries retain one request and one outbox message.
- Wrong hash, wrong actor/conversation, missing bytes, changed same-size bytes, reordered files, overflow after encoding and unsupported SMS/NOTE paths.
- Direct authenticated/service bypass attempts and collision with invoice/release/payment associations; full existing dispatch regression suite.
- Rendered desktop/mobile review and recovery, account switch, cancellation and existing draft-navigation behavior. No visible attachment send control before this path works end to end.
- Explicit retention/purge policy and independent retrieval authorization for queued/sent files. Abandoned upload cleanup is still open; no automatic deletion of verified evidence.
- Controlled authorized provider delivery and staff acceptance remain separate from synthetic tests.

## Implementation checkpoint

The payload builder now validates the ordered manifest, actor/conversation storage paths, bounded file counts and sizes, configured sender, actual file type/length and SHA-256 before freezing provider JSON. Five focused tests cover repeatability, equal-size altered bytes, invalid references and channels, missing bytes, MIME mismatch, sender injection and aggregate overflow. Targeted ESLint and frozen Deno type checking pass.

`conversation_email_preparation.sql.draft` is intentionally outside deployable migrations. It sketches shared request preparation and immutable capture with explicit function privileges, but is not database-tested. The reviewed queue RPC, frozen reader/dispatch guard extensions, authenticated capture handler, UI review, retention and end-to-end acceptance remain unfinished. Do not deploy this draft or expose an attachment send button yet.

Upload foundation CI run 35085949803 passed all frontend, Edge and database jobs at ddf0ff3. The follow-up API/recovery adapter commit 9d464ae was pushed to PR152 for a separate complete CI run; the earlier result does not prove that follow-up commit.

The dependency-injected capture handler now accepts only a saved request UUID, verifies authenticated ownership, builds from server context, and confirms the resulting payload hash through a fresh authenticated review read. A lost capture response recovers the existing payload without re-downloading or rebuilding under changed sender settings. Abandoned requests, revoked access and mismatched receipts cannot return success. Seven handler tests plus the five payload tests pass; targeted ESLint and frozen Deno checks pass. These use simulated handler dependencies, not deployed HTTP or database acceptance.

The SQL draft now includes the reviewed queue RPC: request-level serialization, active-owner recheck, attestation and exact hash validation, collision rejection, and atomic outbox association with exact replay receipts. It is still untested and must remain outside migrations until the frozen reader and provider-attempt guard are implemented and tested together. No Edge entry point or composer send control has been exposed.

The draft now adds conversation delivery context and wraps both frozen-payload reading and the current provider-attempt function. Inspection confirmed the latest existing wrapper is payment delivery (20260913370000); the rename preserves that full chain, not just the earlier document-link wrapper. Conversation context rejects missing reviewed associations, mixed invoice/release/payment/document-link/reminder associations, changed queued content, stale leases and mismatched captured/reviewed hashes. The final guard also requires the dispatcher's exact conversation hash and captured sender/Reply-To before delegating to existing checks. SQL runtime acceptance is still pending.

The actual dispatcher now supplies `conversation_payload_hash` for frozen conversation emails. All 48 selected dispatch, invoice email, release email and document-link SMS tests pass, including three new dispatcher cases covering exact bytes/proof, tampering/changed sender, and database denial before provider execution. These mocked-database tests do not prove the draft SQL guard. Targeted ESLint passes. The next step is canonical SQL acceptance and actual Auth/Storage/capture/queue recovery, followed by the deployed handler adapter and review UI.

The actual `dispatch-outbox/index.ts` entry point and shared capture handler also pass `deno check --frozen` against the repository's root `deno.lock`. An initial command used an incorrect entry path, and a subsequent explicit nonexistent functions-level lock path was rejected; neither changed the committed lock. The corrected repository-standard check passes.

The SQL candidate has moved from the historical draft path into `supabase/migrations/20260916110000_conversation_email_preparation.sql`, together with the reviewed queue, frozen reader and final attempt guard. Canonical inventory is now116. `supabase/tests/conversation_email_preparation.test.sql` exercises real role grants, owned preparation/replay, competing drafts, duplicate IDs and recipient rejection, service-only capture with actual decoded hash validation, review attestation, ordinary-enqueue rejection, idempotent queueing, abandonment, lease checks and final provider proof. These checks are submitted for disposable CI execution; they are not yet reported as passing. No hosted rollout is authorized by test submission alone, and the handler adapter and UI are still incomplete.

The authenticated Edge entry point is now wired in `capture-conversation-email/index.ts` with JWT verification enabled. Actual downloads use the caller's Storage client; service credentials are confined to context/capture RPCs, and the final review is read as the caller. Frozen Deno and targeted ESLint checks pass. The existing owned disposable Auth/Storage harness now additionally exercises preparation, a simulated lost reply after real committed capture, recovery without a second download/capture, foreign access denial, required attestation/hash, duplicate queue recovery and existing composer acknowledgment. The handler itself is invoked in-process; Auth, Storage and RPCs are real local services. This extended harness awaits its own CI run after the current SQL candidate run finishes.

Staff review UI foundation: `parseConversationEmailReview` validates captured request/conversation identity, ordered unique files, byte/hash evidence, bounds, state and complete queue receipts before producing a display model without Storage paths. Four focused tests pass. `AttachmentEmailReviewDialog` uses existing dialog/button/checkbox components to show recipient, subject, message and file facts, exposes an inspection callback, and requires attestation tied to the request/payload hash. Busy actions prevent duplicate clicks and dismissal; already queued requests do not offer a second queue action. It is not mounted in the composer: authenticated inspection and adapter/recovery wiring remain required, followed by rendered desktop/mobile acceptance. Application TypeScript check is still running locally; no claim of full UI type or browser acceptance yet.
