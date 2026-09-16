# Incoming attachment capture

This work is on codex/native-inbound-file-capture, a child of the outbound attachment branch. It does not replace the pending outbound CI/concurrency checks or declare incoming retrieval complete.

## Provider contract and download boundary

Checked2026-09-16: https://resend.com/docs/api-reference/emails/retrieve-received-email-attachment documents GET/emails/receiving/{email_id}/attachments/{attachment_id}, response identity/name/type/size, an expiring download URL and an example URL on inbound-cdn.resend.com under /{email_id}/attachments/{attachment_id}. The implementation deliberately accepts only that exact HTTPS host/path shape. This is a supported-contract assumption to verify during authorized provider acceptance, not evidence from live clinic traffic. A provider change fails closed rather than widening allowed destinations automatically.

`resend-attachment.ts` accepts metadata from an authorized saved inbound record, looks up the attachment with the server API key, requires exact metadata equality and a nonexpired URL, and downloads without forwarding the key or following redirects. It bounds metadata to64KiB and file bytes to the saved size/ten MiB, cancels overflow, rejects truncation/type mismatch, checks supported PDF/PNG/JPEG signatures and hashes actual bytes. A container signature is not malware scanning. Six injected-transport tests, targeted ESLint and frozen Deno checks pass. No actual provider request was made.

## Next implementation

1. Reserve capture against the saved communication_inbound row and exact attachment metadata, keyed by inbound ID/attachment ID. Require active staff and a currently matched message/conversation. Unknown/unresolved senders must complete the existing review workflow first.
2. Use fenced durable capture with immutable bytes, metadata/hash and provider provenance. Capture retries recover the same artifact; stale leases, changed review association and revoked access must prevent publication. Do not persist signed URLs or provider API keys.
3. Store bytes privately. Staff listing/retrieval must recheck current authorized inbound message association, and display unsupported/oversized/pending/failed states honestly without pretending the file was retrieved.
4. Test actual local Auth/Storage/HTTP paths, cross-message denial, response-loss recovery, concurrent capture/review changes and byte integrity. Add rendered inbound timeline acceptance.
5. Design incoming SMS media separately using its authenticated provider identifiers; do not interpret the current media-count placeholder as attachment identity.
6. Retain provider delivery gates and capture commissioning boundaries. Complete retention and controlled provider/staff acceptance before readiness claims.

## Capture orchestration checkpoint

`capture-attachment.ts` defines the authenticated incoming capture boundary. The browser supplies exactly inbound ID, attachment ID and expected version. The privileged claim must authorize current staff/message association and return either a durable ready receipt or a lease with actor, message, provider email, metadata and an exact inbound/attachment/token object path. The handler rejects mismatched lease identity before provider access, verifies retrieved facts, stores through the injected immutable writer, and accepts finalization only when the receipt matches capture ID, message, version, type, length and hash. Ready retries do not download/store again. Returned receipts omit Storage paths and provider URLs.

Six handler tests plus six provider-download tests pass, including committed capture with lost final response, mismatched acknowledgments, cross-identity leases and browser-supplied extra properties. Targeted ESLint and frozen Deno checks pass. Claim/finalize SQL, private Storage wiring, deployed HTTP and staff retrieval are not implemented by this checkpoint; simulated dependencies do not establish those guarantees. No new endpoint is exposed.

## Database draft checkpoint

`inbound_capture.sql.draft` now contains a private capture table, immutable-ready guard, service-only claim/finalize functions and a private incoming-original bucket. Claims lock the inbound row, require current active staff and a matched CLIENT EMAIL in its household/conversation, bind exact metadata/version, and allocate a fresh token/object path. Active leases reject a competing worker; expired leases get a different path, and ready claims recover a sanitized receipt. Finalization locks inbound then capture consistently, rechecks association/metadata/staff/token/expiry, checks stored object metadata, and preserves immutable ready evidence. Storage bytes still need the authenticated adapter's actual-byte verification; SQL object metadata alone is not file-integrity proof.

`inbound_capture.test.sql.draft` adds14 pgTAP cases for privilege boundaries, version/identity checks, competing leases, missing objects, receipt recovery, changed hashes, immutable evidence and inactive staff. Both files remain outside canonical migrations/tests until the backend adapters and runtime acceptance are ready. Diff checks pass; these SQL cases have not been executed and must not be reported as passing.

Outbound run35090906569 completed all jobs successfully atd70691a, including shared-history SQL and actual-service acceptance. The parent branch's pending concurrency harness was then submitted for a separate run; this incoming branch retains that ancestry without mixing untested incoming SQL into the outbound candidate.

## Candidate submitted for runtime verification

The database draft and14 pgTAP cases are now canonical migration20260916120000 and `supabase/tests/inbound_attachment_capture.test.sql`; candidate inventory117. The new authenticated `capture-inbound-attachment` Edge entry point validates JWTs with Auth, invokes service-only claim/finalize, fetches the provider-bound file, and writes through `storeIncomingOriginal`. The Storage writer uses upsert:false and always reads back the object to verify actual size/MIME/container/hash before finalization, including after an uncertain upload acknowledgment. Four new storage tests join the twelve handler/provider tests: all16 pass. Targeted ESLint and frozen entry-point Deno checking pass. Real PostgreSQL/Storage acceptance remains pending.

The entry point defaults off unless INBOUND_ATTACHMENT_CAPTURE_ENABLED=true. No such gate was enabled and no hosted deployment/provider request occurred. Staff listing/retrieval, inbound timeline UI, actual local service integration, capture concurrency and retention remain outstanding. The prior draft-path references above are historical.

## Runtime submission and lease-replacement acceptance

Draft PR156 is open at https://github.com/finite0001/livingroom-vet-care/pull/156. CI35092794347 is running against9856659 (14 incoming SQL assertions); results are not yet established. Parent CI35092195032 has passed its actual conversation capture/queue concurrency step; remaining jobs were still running when checked.

Five additional SQL assertions now exercise an expired lease, stable capture identity on reclaim, replacement token and Storage path, and rejection of the replaced worker's finalization. These bring the incoming SQL suite to19 assertions. They are locally prepared and diff-checked, not yet executed or included in the running CI commit. Wait for the current run to finish before pushing this follow-up so the workflow does not cancel existing evidence collection.

## Actual-service capture acceptance prepared

Added `tests/inbound/attachment-local-roundtrip.ts` and a database CI step. It requires an explicit disposable project, matching Docker project label and localhost API. It uses real Auth/RPC/Storage with synthetic provider bytes and an in-process handler: invalid identity/stale version/privileged RPC denial, lost committed receipt recovery without repeated read/write, exact private bytes, direct staff read/overwrite denial, and revoked staff denial. Cleanup is scoped to generated fixture IDs and combines assertion/cleanup failures. Targeted ESLint, Node syntax and diff checks pass. Runtime execution is pending; this is not a deployed Edge HTTP or provider acceptance claim.

CI35092794347 passed Edge checking and the full SQL stage for9856659; frontend/browser and remaining database integration stages are still active. Follow-up commits remain local until that run is terminal to avoid canceling it. Parent CI35092195032 also remains active, with its capture/queue race stage passed.

## Private reader implemented, runtime acceptance pending

Added service-only `authorize_inbound_attachment_read`: active staff, ready capture, exact message/version/provider identity, current household/message association and saved metadata are required before exposing a Storage path to the server. New `read-inbound-attachment` Edge adapter authenticates the token, verifies actual downloaded bytes, repeats authorization and compares all saved context fields before returning a no-store attachment response. No signed URL escapes; read access uses the same default-off capture gate. Six reader unit tests pass; targeted ESLint and frozen Edge entry-point checking pass.

Four SQL reader assertions bring the suite to23. The actual-service harness now also exercises authorized reading, wrong-message rejection and revoked-staff rejection. These SQL/integration changes have not yet run. Staff listing/UI and race acceptance remain outstanding.

Parent run35092195032 completed successfully in all jobs atc04f45a, including actual outbound capture/queue concurrency. Incoming run35092794347 at9856659 remains active (Edge/SQL passed; later database and browser stages running). Do not push this follow-up until it is terminal.

## Staff listing prepared for timeline integration

Added authenticated `list_inbound_message_attachments(uuid[])`, bounded to100 requested messages and active staff. It joins current household/message/inbound identity and reports pending/capturing/ready/unsupported, exposing only verified capture IDs/hashes for matching ready evidence and never a Storage path. Malformed numeric metadata is guarded before casts. Five SQL assertions bring the suite to28; the real-service harness also checks the ready listing and absence of a Storage path. Targeted harness lint and diff checks pass; these new SQL/listing assertions are not yet runtime verified. Timeline parser/hook/UI remain to be implemented.

Run35092794347 remains active at9856659, currently executing the final attachment metadata/original integration stages while browser tests continue. Follow-up commits are still local to preserve that run.

## First incoming run passed; expanded acceptance submitted

CI35092794347 completed all jobs successfully at9856659. This validates the original capture candidate and14 SQL checks, not the subsequent locally prepared reader/listing/lease-replacement integration additions.

Added browser `incoming-attachments.ts` parser and download verification: pending metadata cannot fabricate ready evidence, wrong-message/duplicate identities fail, unsupported files remain visible, exact bytes/hash/type/size and current actor are required before browser file use. Four targeted tests and lint passed. Installed FunctionsClient treats PNG/JPEG responses as text by default, so timeline download transport must explicitly preserve binary bytes (PDF already handled as Blob). UI transport/hook/components remain pending; do not claim the new helpers are user-visible.

The follow-up commits are now eligible for push because the earlier CI run is terminal. The next CI run must prove the expanded28 SQL cases and actual incoming Auth/RPC/Storage harness before deployment.

## Incoming timeline controls implemented locally

Added actor-scoped/batched incoming listing hook, typed RPC signature and incoming attachments beneath client email messages without relocating existing controls. Pending files offer Retrieve file, active captures Check status, ready files Download; unsupported files remain visible. Capture responses trigger database-list refresh instead of fabricating ready UI. Downloads use explicit fetch/blob because installed FunctionsClient treats image MIME responses as text; browser verifies size/type/hash/current actor before constructing the download URL. Errors are visible and listing failures offer Retry.

Targeted lint and application TypeScript check pass. Two Playwright flows (desktop/mobile) pass, including pending-to-ready retrieval and byte-for-byte PNG download plus horizontal overflow check. First desktop attempt hit the default5-second attachment expectation while the conversation was still loading; the fixture now waits explicitly for its message content (15-second bound), and both cases passed in14 seconds. No production deployment.

CI35094146408 at53c0337 is still active and does not contain these timeline changes. Its Edge and SQL stages passed; subsequent database integration/browser stages remain active. Keep local UI commit until that run finishes, then submit it without canceling the prior acceptance run.

## Timeline error/retry acceptance

Added an explicit Refresh file status action after capture/read errors and removed duplicate refresh on the capturing-status action. Unsupported state now says File retrieval unavailable rather than implying a preview is the missing feature. Two targeted browser tests pass: capture503 never fabricates a ready/download action, and same-length altered PDF bytes never trigger a browser download. Both keep a working status-refresh action. Targeted UI/test lint and diff checks pass.

Updated the standalone feature matrix's stale empty-attachment assessment to distinguish candidate PR work from deployed capability, preserving incoming concurrency, retention and hosted/provider acceptance gaps. Expanded backend CI35094146408 remains active, most recently in original-capture race regressions; the local UI follow-ups are not part of that run.

## Incoming concurrency harness prepared

Added `supabase/tests/inbound_attachment_concurrency.py` and its CI database step. It requires explicit synthetic-local opt-in, project configuration and matching Docker project label. Transactions hold the incoming row and wait until pg_blocking_pids proves the exact holder/waiter dependency. Cases cover competing claims, matching duplicate finalization, staff revocation during claim/finalization waits, changed inbound version and a replacement lease invalidating the waiting original token. Cleanup targets generated fixture IDs, owned session tags and exact synthetic Storage metadata paths. These are SQL/object-metadata tests, not actual provider or Storage-byte acceptance; the separate Auth/RPC/Storage harness covers bytes.

Python compile and diff checks pass; concurrency cases have not yet executed. CI35094146408 at53c0337 remains live in later database integration stages/browser tests, so this harness and local UI commits remain unpushed until it finishes.
