# Private call-note source access — Phase 3B.1

Date: 2026-10-17. Status: implementation, independent review, frozen local verification and staging comparison passed. Exact-head PR CI, specific merge approval and primary migration 202 remain pending. The [sanitized manifest](2026-10-17-clinical-call-note-sources.json) preserves source inventories and original receipt hashes. This package does not enable call generation or clinical activation.

## Delivered boundary

Migration `20261017135245_clinical_call_note_sources.sql` introduces private immutable call-generation policy versions and source bindings. A binding must resolve to the exact captured source, manifest hash, projection hash/text, patient, encounter and capture-policy version. Deferred two-way checks require each call job to have its binding and prohibit binding a typed/audio job. Four new indexes cover the new foreign keys; the job key already has a primary-key index.

The existing job row and legacy typed/audio JSON contracts retain their shape. Sixteen existing routines are replaced explicitly, with their signatures, owners and grants preserved. Generic lists exclude private calls before pagination and counts; direct reads, provenance, cancellation, completed worker replays and reflected review receipts refuse private call jobs/proposals for all roles, including administrators. Stored job and generation relationships both classify a private proposal, including a missing counterpart link. The records recap source whitelist is unchanged.

`read_clinical_call_note_job_v1` is the only new granted RPC. It revalidates the current active, unbanned administrator and live Auth session, checks the canonical household/call association and immutable binding, and repeats actor validation after source-lock waits. Its four-key response contains the versioned contract, job, binding and original source context; it omits the job session, intent, attempts and full source document. Historical reads do not depend on the original operator's session or continued generation eligibility of the old template, policy or encounter.

This release adds **no call reservation, generation, policy-edit, acceptance or list API**, UI entry point or provider handler. Owner-only fictional rows test future private history without admitting real call jobs. The separate call-generation policy starts **v1 draft**; it does not reuse capture approval. [Phase 3B.2](../../plans/20261016-vetrec-authenticated/phase-03b-call-summary-implementation.md) must add source-backed OpenAI generation and private explicit clinical review together.

## Verification

The owned upgrade proof starts with all 201 prior migrations and historical typed notes, audio-backed template notes, direct audio SOAP, provenance and review receipts. It applies only migration 202, compares actual RPC response bytes and validates the responses with the unchanged frontend schemas, assembly and receipt verification. Newer private call rows test exclusion before list limits. Populated restore and observed lock waits are separate checks; no paid provider is used.

| Proof | Result |
| --- | --- |
| Actual local 201 to 202 upgrade | 53 targeted SQL assertions; all 213 recorded inputs matched after completion |
| Local boundary and compatibility | 144 assertions across real Auth/HTTP, SQL state, frontend results and restore; this is not a count of HTTP requests |
| Legacy responses | Nine actual RPC JSON/raw UTF8 responses unchanged byte-for-byte before/after migration |
| Unchanged frontend contracts | 27 actual model parses and nine assembly/provenance/review validation cases across before, after and restored snapshots |
| Observed authorization waits | Two real blocked reads; ADMIN demotion retaining STAFF refused with PT403, session revocation with 42501 |
| Populated restore | Seven checks; exact 20 relation families, 1,331 routine definitions/owners/effective grants, new table metadata and retained reads; marked clone removed |
| Full canonical compatibility with unpublished controlled-stock candidate | 165 SQL files / 7,235 assertions; 124 Auth API checks, five observed queues and 455 restored relation fingerprints; all ten canonical writer definitions unchanged |
| Candidate input and cleanup proof | All 388 inputs matched; owned containers, volumes and private runtime files removed |
| Application | Lint, type checks, all 1,599 unit tests and production build passed; existing lint/chunk warnings remain |
| Security advisors | Byte-identical before/after; one existing `extension_in_public_pg_net` warning, no new findings or errors |

Both final owned runtimes were removed. No real provider call, hosted write or clinical chart insertion occurred in the local proofs. Earlier fixture/expected-count diagnostics remain private and are not acceptance evidence. The restore comparison uses PostgreSQL's pretty constraint deparser: its ordinary output adds/removes redundant associative-AND parentheses after BETWEEN checks are dumped and reparsed. A bounded independent reproduction verified that difference; exact routine, owner, permission and other metadata checks were retained.

## Staging comparison

Staging `kothoqicubowyhwfsrte` now has **202 migrations**, latest `20261017135245`. All **395 original public tables** were preserved. All existing routine owners/permissions and **1,306 unrelated routine definitions** were preserved. The sixteen planned replacement bodies, nine new routine bodies/grants, two private tables, four foreign-key indexes, two changed job CHECKs and deferred job-binding constraint trigger match the source. One scheduler append retained the original prefixes. Existing audio and capture policies are unchanged; no clinical chart was written.

All Edge Functions and secret metadata are unchanged. Capture and call-generation flags remain absent; the new generation policy is **v1 draft** and bindings are empty. No new Edge Function or frontend release is part of this database-only increment. This staging comparison verifies deployed schema/source/permissions; it does not claim a hosted authenticated generation workflow.

## Remaining release and clinical work

Primary remains at **201 migrations**, with [PR 271's capture rollout](2026-10-17-clinical-call-sources-primary-rollout.md) verified separately. Migration 202 has not been applied there. This increment does not approve call processing, establish real CloudTalk entitlement, prove model clinical fidelity or complete iPhone/Safari device acceptance. Susan's call-generation/retention review, the subsequent generation/review increment, bounded synthetic evaluation and explicit commissioning remain separate work.
