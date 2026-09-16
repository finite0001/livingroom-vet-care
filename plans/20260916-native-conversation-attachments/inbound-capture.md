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
