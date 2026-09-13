# Secure document links: backend increments 1–2

Implemented locally: immutable capability grants for issued invoices and already confirmed **SMS** medical-record releases, actual frozen report/original capture, explicit staff attestation, revocation, and authenticated public retrieval. This increment does not enqueue an SMS, deliver a provider message, add staff/client UI or activate a deployment. Existing clinician/schema acceptance remains required for record releases. EMAIL releases cannot be coerced to SMS.

## Source and staff API

`preview_document_link(p_family, p_source_id, p_client_id)` accepts `invoice` or `record_release`. It returns `{family, source_id, client_id, recipient, source_hash, summary}`. `recipient` is the household's current normalized primary phone with current SMS consent and suppression checks. The summary identifies the family and household; private Storage paths are not exposed by this preview.

`POST prepare-document-link` requires a staff bearer token and exactly these JSON fields:

```json
{
  "p_request_id": "stable UUID",
  "p_family": "invoice or record_release",
  "p_source_id": "source UUID",
  "p_client_id": "household UUID",
  "p_conversation_id": "same-household conversation UUID",
  "p_recipient": "current normalized phone",
  "p_source_hash": "preview SHA-256",
  "p_expires_at": "explicit future ISO timestamp",
  "p_message_template": "Reviewed documents: {{document_link}}"
}
```

The template must contain exactly one `{{document_link}}` placeholder. The example is synthetic wording, not an approved default client message. The server freezes origin, key version, expiry and source bundle. An exact committed retry resolves before new eligibility checks and never extends expiry. A competing unresolved request for the same actor/family/source is rejected.

The response contains `grant`, `artifact_hash`, `message_hash`, ordered `manifest`, `report_html`, `events`, and `receipt: null`, plus **transient** `client_url` and `materialized_message`. Keep those final two fields in memory only; never write them to app storage, analytics, logs, messages or outbox bodies. No usable capability is stored in the database. The grant returned to staff excludes the private source bundle.

`POST recover-document-link` requires the same staff authorization and `{p_family, p_source_id, p_request_id?}`. Omitting request ID retrieves the actor's latest matching grant. Direct staff RPC `recover_document_link` returns the same durable fields without materialized URL/message, and remains useful when a key has been removed. Recovery never captures new bytes, reviews, sends or extends a grant. A historical capture remains inspectable after source ineligibility.

`attest_document_link(p_request_id, p_reviewed_artifact_hash, p_reviewed_message_hash, p_attest:true)` changes `captured` to `reviewed` and adds immutable actor/time evidence. The client must review the exact frozen report, originals, recipient, message, expiry and forwarding implications before attestation. A captured but unreviewed grant cannot be retrieved publicly. No clinical approval is fabricated by this separate delivery review.

`revoke_document_link(p_request_id, p_reason)` adds a revocation event and prevents future retrieval. The original actor must be active; the reason is required. It also cancels an unfinished preparation. Already downloaded copies cannot be erased. Review/revocation retries are idempotent.

## Client retrieval contract

`POST retrieve-document-link` receives `{grant_id, token, artifact_index}`. The URL is `/shared/:grantId#token`, where `token` is `v1.` plus 43 base64url characters. The client must remove the fragment before other app initialization and keep it in memory only. Possession of the capability is not verification of recipient identity.

For `artifact_index: null`, success is JSON:

```json
{
  "grant_id": "UUID",
  "expires_at": "ISO timestamp",
  "manifest": [{"index": 0, "filename": "invoice.html", "mime_type": "text/html", "file_size": 123, "sha256": "64 lowercase hex characters"}]
}
```

Only these manifest properties are returned. Index 0 is the report; indices 1–24 are explicitly selected originals. An integer index returns raw frozen bytes with their MIME type and attachment-safe disposition. Fractions, negative/out-of-range values and string indices are rejected. No reusable Storage URL is returned. Original MIME types are PDF, JPEG or PNG; the report is HTML.

Every request, including manifest retrieval, validates capability/key availability, current source/household/SMS eligibility, active preparing staff, explicit review, expiry, revocation and content integrity. Frozen payload and requested-file digests are checked before returning content. The public endpoint returns a generic `404 {"error":"Document link unavailable"}` for invalid/unavailable grants. Disabled or missing configuration returns the same generic body with status 503.

Responses are no-store, nosniff and no-referrer. HTML responses use a restrictive sandbox CSP. Frozen HTML itself contains CSP and no-referrer metadata for offline downloads; active scripts, navigable anchors, forms and externally loading markup are rejected before capture. A client displaying fetched HTML must still use its own sandbox and restrictive CSP, since response headers do not transfer into a Blob.

## Key configuration and operational limits

Server-only configuration:

- `DOCUMENT_LINK_ORIGIN`: exact origin, frozen into each intent. HTTPS is required except explicit localhost/127.0.0.1 origins for local tests.
- `DOCUMENT_LINK_ACTIVE_KEY_VERSION`: current version label, 1–40 alphanumeric/underscore/hyphen characters.
- `DOCUMENT_LINK_KEYS`: JSON map of version labels to base64-encoded 32–64-byte server keys. Never use a browser/VITE variable or commit a live key.
- `DOCUMENT_LINK_PUBLIC_ENABLED`: exact `true` required for public retrieval. Missing/false fails closed.

The token is an HMAC-SHA256 over a domain-separated immutable context including grant, source, actor, household, phone, source hash, message template, origin, key version and fixed timestamps. Only its SHA-256 is persisted. The exact materialized SMS has a separate SHA-256. Changing configured origin or replacing/removing a retained version's key invalidates materialization; no replacement token is silently issued. Keep old versions only while their grants should remain usable.

Provisional operational bounds, pending launch review: expiry within seven days; 200 successful retrievals per grant (including manifest); at most 24 originals plus report; each original at most 20 MiB; total encoded capture at most 32 MiB. These are engineering limits, not clinical recommendations or a message cadence. Failed capability/eligibility requests do not consume the retrieval budget. The count is serialized under the grant lock. A response authorized by the server can consume budget even if the network fails before the client receives it; this counter is not proof that a recipient viewed or saved the document.

Frozen clinical/financial artifacts and review evidence are retained; this increment does not implement automatic content purging. A retention policy must preserve required records and review evidence before a later purge workflow is commissioned.

## Local verification and next increment

`supabase/tests/document_links.test.sql` is rollback-only and covers both families, actor/household boundaries, missing consent, draft invoices, immutable retry/expiry, actual review gating, selected-file matching, corruption, phone/consent/source changes, withdrawn clinical approval/releases, key-independent SQL authorization, revocation and budget exhaustion.

`node --experimental-strip-types tests/document-links/local-http.ts` explicitly targets an existing local Supabase project (`DOCUMENT_LINK_TEST_PROJECT`, default `/tmp/livingroom-vet-foundation`) and starts production handlers on localhost:56451. It creates synthetic staff/household records, uploads a real private PDF, captures actual renderer output, exercises manifest/byte retrieval and negative cases, then removes synthetic patient/billing/storage fixtures, restores the prior local release policy and deletes its auth user. It never resets the database or contacts a provider. Platform auth audit entries may retain evidence of the synthetic local account activity.

The unit suite tests deterministic capability derivation, key/origin removal, safe public response shaping, actual invoice/SMS renderer paths, original-byte checks, capture/recovery idempotence and absence of tokens in capture arguments.

The increment 3 backend below adds the secure-link outbox subtype. Protected staff/client UI is delivered separately. No provider success, clinical acceptance or live public availability is established by local tests.

Staff exact-file review uses `read_document_link_artifact(p_request_id,p_index)` with the authenticated original actor. It returns `{filename,mime_type,file_size,sha256,content}` (base64 content), checks frozen integrity, and supports historical inspection after revocation or source changes. It does not activate retrieval or consume public budget. The UI must keep these private bytes out of persistent browser storage.

## Increment 3: reviewed SMS queue backend

`enqueue_document_link_sms(p_request_id, p_reviewed_artifact_hash, p_reviewed_message_hash, p_attest:true)` requires the original active actor, prior exact `attest_document_link` review, both current hashes and current source/recipient eligibility. It returns the existing `communication_outbox` row. One immutable association per grant prevents duplicate history/outbox rows. Exact committed retries resolve before later revocation or source changes; they return the prior queue result rather than creating another send. A revoked, expired or otherwise ineligible link cannot create a new queue entry.

Both RPC and Edge recovery now include `receipt: {outbox_id,message_id,state,queued:true,delivered:boolean}` once queued. `queued:true` records the durable enqueue, including later failed or uncertain outcomes; only `delivered:true` represents provider delivery confirmation. The grant remains `reviewed` after enqueue and can still be revoked.

The stored message and outbox body contain the redacted `{{document_link}}` template. The dispatcher obtains immutable capability context and fingerprints through service-only `document_link_delivery_context(p_outbox_id,p_lease_token)`, requires public retrieval enabled, derives the capability in memory with the retained version's key, and checks both the token and exact message digests. Missing/changed keys, changed origin, disabled retrieval, ineligible sources or oversized materialized SMS fail before transport. The existing dispatch endpoint now loads the four document-link environment settings; none is a browser setting.

At `start_communication_attempt`, the database again verifies current source/actor/phone/consent, frozen artifact integrity and the mandatory `document_link_token_hash`, `document_link_message_hash`, and `document_link_artifact_hash` proofs. An older worker lacking these fields fails closed without starting a provider attempt. The proof fields are removed before persistent sender configuration is stored. The only literal capability-bearing value passed onward is the transient Twilio request body; provider response/error text is not copied into history. Ambiguous SMS outcomes retain existing manual reconciliation and never automatically resend.

Guards reject recognizable `v1.` capabilities pasted into generic outbound queue/prepared-message/history or grant templates. They do not claim to scrub unrelated historical or inbound provider data. Local verification does not establish real SMS delivery or authorize provider activation.

Backend verification: the Node suite has 182 passing tests, including 11 focused production-dispatcher tests using a synthetic transport. Frozen Deno checking passes for the actual dispatch endpoint. `supabase/tests/document_link_sms.test.sql` is a rollback-only suite for both grant families, exact review/idempotence, old-worker denial, final source/consent/schema/actor checks and redacted history. Its database execution is pending while the local Docker daemon is unavailable; parser checks alone are not database validation.
