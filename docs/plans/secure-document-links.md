# Reviewed client document links

Status: implementation plan, not an available client feature or provider acceptance.

## Required outcome

Staff can select and review an issued invoice or an already confirmed SMS-addressed medical-record package, then queue a text containing an expiring client link. The recipient can open only the frozen reviewed report and selected originals. Invoice collection remains separate; this link never claims to be a payment receipt or checkout link. Record packages retain the existing clinician/schema acceptance requirement.

The same mechanism supports both artifact families, with distinct source validators. Do not reinterpret EMAIL releases as SMS releases. Require the household's current normalized primary phone, current SMS permission/suppression checks, active staff and exact source/household identity at preparation, capture, enqueue, provider attempt and every retrieval. Credits change invoice eligibility even though they do not increment invoice.version.

## Capability and storage

Use a versioned server-held HMAC key and domain-separated immutable grant context to derive an unguessable capability. Persist the capability hash and key version, never the usable token. A literal token-bearing URL must not enter messages, outbox bodies, audit rows, error logs or analytics. Use a redacted message template and hash of the exact materialized SMS; authorized preparation/recovery and the worker derive the token transiently and verify the message digest. Key-version removal disables affected links and must not silently generate replacements.

The proposed client URL is `/shared/:grantId#token`. Remove the fragment from browser history immediately and retain the token in memory only. A capability establishes possession, not recipient identity; staff review must explain forwarding and expiry. Revocation prevents future retrieval but cannot erase downloaded copies.

Freeze actual report HTML and ordered original-file bytes before attestation, with SHA-256 manifests and explicit byte/count limits. Reuse existing deterministic renderers and original-file checks without weakening email-specific contracts. Never rerender a previously captured report after a code change. Every original download must use the same authorization endpoint; do not return a reusable Storage signed URL that outlives revocation.

## Backend contract and lifecycle

- Staff preview: family/source/client -> exact source hash, normalized SMS recipient and source summary.
- Authenticated preparation: stable request UUID and exact immutable intent -> captured artifact preview, manifest, expiry, materialized-message digest and recovery state; never sends.
- Recovery: exact request/queue receipt remains recoverable after later source ineligibility. Committed retries resolve before new eligibility checks; retries never extend expiry.
- Enqueue: explicit reviewed artifact/message hashes and attestation -> existing outbox receipt. A new secure-link subtype requires proof of correct materialization at attempt start so older workers cannot send placeholders.
- Revoke: actor-stamped append-only event; retain delivery/history evidence.
- Retrieval: POST grant ID/token/artifact selector to a purpose-built endpoint; validate capability, current eligibility, expiry/revocation and bounded retrieval budget before returning only the requested frozen bytes. Invalid and unavailable grants return a generic response.

Use no-store responses, strict CSP/sandboxed HTML previews, attachment-safe MIME/disposition and no third-party content. Keep server keys out of browser variables. Public retrieval is disabled until commissioned key/configuration and explicit feature activation are present. No provider send or clinical acceptance is implied by local tests.

## Delivery increments and verification

1. Immutable grant preparation, source checks, capture/recovery/revocation and capability derivation. Exact function signatures must be agreed before UI work.
2. Actual client retrieval route and private-byte delivery with negative authorization/expiry/revocation tests.
3. Staff review, protected draft/recovery lifecycle and SMS outbox materialization/final-attempt guards.

Test both families with actual local HTTP retrieval and actual private Storage files: wrong token/grant/index, expiry, revocation, changed phone or SMS permission, source edits, staff deactivation, duplicate/lost preparation and queue responses, deterministic recovery and absence of usable tokens in database/audit history. For records also test withdrawn/unaccepted schemas, channel mismatch and unselected/private originals. For invoices test drafts, voids and credits without version increments. Include original-byte corruption and old-worker denial.

Real SMS delivery, clinician approval and owner review remain external acceptance gates. Preserve the full invoice and medical-record delivery scope rather than substituting a public placeholder page.
