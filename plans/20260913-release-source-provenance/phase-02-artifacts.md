# Phase2 — Rendering and exact-byte delivery

Priority: high. Status: pending. Depends on the phase1 schema5 field contract; implement in parallel after agreement, integrate after its migration.

## Frozen artifact contract

Extend `ReleaseSnapshot` to5 without changing schema1–4 rendering. Preserve v4 weight provenance validation for v5. New provenance-backed attachments carry `content_sha256` and exact receipt/capture references derived from4100/4200 immutable capture rows. Require lowercase64-hex digest, document ID/version, matching MIME/size and capture identity. Missing proof must fail rather than downgrade to an ordinary attachment. Multiple selected sources may share one original only when version and digest agree.

Ordinary documents without lab/external provenance retain the existing metadata contract; do not claim their bytes were previously captured by4100/4200. This phase does not create a new generic document-verification subsystem.

Render separate selected-lab and external-original sections only for schema5. Show source identity, local reviewed entry method, original/correction/replacement lineage, historical status and exact-version acknowledgment. Explain that the local reviewer is not the unknown outside author. Escape every source string. Do not render internal paths, tokens, raw staging payloads or private administrative reasons. Render from the frozen snapshot alone, never live source tables.

## Byte verification

1. `buildReleaseEmailPayload` and `buildDocumentLinkArtifacts` must hash actual downloaded originals and compare to the frozen expected digest before base64 encoding or constructing final artifacts.
2. Additive SQL changes to `capture_release_email_payload` and `capture_document_link` must independently hash the corresponding decoded attachment bytes and compare to the frozen snapshot, not caller-supplied digest metadata. Preserve function signatures, actor/source locks and current exact retry behavior.
3. Keep whole-payload/manifest hashes and final wrapper delegation. These protect the delivery after capture and complement the new original-byte comparison.
4. A recovered already-captured request returns its original frozen bytes without redownloading or regenerating. Never add retrospective verification claims to schema1–4 payloads.
5. Final source invalidation must still stop before `start_communication_attempt` creates an attempt. The implementation must preserve payment→document→invoice→release→reminder→core guard delegation.

## Files and ownership

Renderer/transport owner creates or modifies these files in its isolated checkout (absolute reference paths):

- `/Users/davidedler/livingroom-vet-release-provenance-plan/supabase/functions/_shared/record-release-renderer.ts`
- `/Users/davidedler/livingroom-vet-release-provenance-plan/supabase/functions/_shared/release-email-payload.ts`
- `/Users/davidedler/livingroom-vet-release-provenance-plan/supabase/functions/_shared/document-link-artifacts.ts`
- `/Users/davidedler/livingroom-vet-release-provenance-plan/tests/record-releases/provenance.test.ts`
- `/Users/davidedler/livingroom-vet-release-provenance-plan/tests/release-email/payload.test.ts`
- `/Users/davidedler/livingroom-vet-release-provenance-plan/tests/document-links/backend.test.ts`
- `/Users/davidedler/livingroom-vet-release-provenance-plan/tests/document-link-sms/dispatch.test.ts`

Coordinate SQL capture changes with the database owner; reserve separate additive migration4800 after snapshot migration4700 if those numbers are still free at implementation time. Do not have both owners edit one migration.

## Acceptance

- [ ] Add a golden schema4 HTML baseline before editing renderer; preserve all existing schema1–3 baselines and exact schema1–4 HTML/hashes.
- [ ] V5 validates source/original relationships, conflicting/missing digests and source strings; all selected provenance is visible, no unrelated provenance appears.
- [ ] A same-length PDF mutation preserving `%PDF-` fails in both builders and both SQL captures; exact verified bytes succeed.
- [ ] Document/version/capture substitution fails and duplicate matching originals remain deduplicated.
- [ ] Lost capture acknowledgment returns identical frozen HTML/originals and request IDs without a new download.
- [ ] Source or document-version invalidation after preparation but before final worker start yields no attempt/provider call; bytes substituted before initial capture fail digest verification. After verified immutable capture, later Storage-byte changes must not regenerate or replace the frozen payload. Retain existing SMS proof/payload tamper tests.
- [ ] Actual local Auth/Storage/PostgREST test, not only mocks, exercises each capture path with synthetic private originals. No real provider send.

Risk: optional digest handling could accidentally permit bypass. Mitigation: enforce proof from selected source identity in snapshot construction, renderer validation, both builders and both SQL capture paths.
