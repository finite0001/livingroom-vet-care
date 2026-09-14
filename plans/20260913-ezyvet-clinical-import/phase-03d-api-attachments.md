# Phase 3d — Source API attachments

Status: migration6500 implements parent-scoped metadata claims/staging and owned run recovery/discovery. Public contract and existing-document architecture reviewed on2026-09-13. Metadata adapter/HTTP/UI wiring, downloads, capture, review/release integration and issued-site sample acceptance remain unfinished. This is part of the required complete migration, alongside prescription history and whole-migration reconciliation; manual exports do not substitute for it.


## Metadata SQL checkpoint — 2026-09-13

Migration6500 freezes Animal or scoped same-patient Consult parent context, including observed source revision, patient/household and mapping. Dedicated immutable run/page/observation tables deny direct API-role access. Generic claims and unscoped legacy staging reject attachments. Fresh pages require the owned lease/cursor and unchanged parent; exact committed page and terminal claim retries recover before mutable source checks. Owner recovery/discovery expose no service lease. Unsupported MIME and original download-URL metadata are retained without fetching or promoting files.

Thirty-four focused SQL assertions and457 existing regressions pass. The existing prescription/source/release concurrency runner passes231 harness checks with6500 overlaid, including the added SQL suite; cleanup is verified. [Sanitized evidence](../../docs/evidence/attachment-intake-sql-local-20260913.json) binds tested files and the reproducible command. This verifies compatibility with existing races, not attachment-specific contention. No actual HTTP intake, byte download, private capture, approval or attachment release is implemented yet. The86-migration attachment checkout is outside the prior85-version full gap/restore evidence; update that explicit inventory and rerun after the attachment implementation is complete.

## Verified contract and boundaries

The official [attachment listing](https://developers.ezyvet.com/#get-attachment) documents `GET /v1/attachment`, bearer authorization with `read-attachment`, and `record_type`/`record_id` filters. Its response preserves `id`, `active`, creation/modification values, `file_id`, `file_download_url`, parent type/ID, `mime_type`, `name`, `primary_image` and `notes`.

The official [Postman collection](https://developers.ezyvet.com/ezyvet-api.postman_collection.json), linked by that documentation, independently defines `GET /v1/attachment/download/:id`, inherited authentication and an octet-stream response. The route parameter is the attachment ID, not `file_id`. These public observations do not prove issued-site scope entitlement, actual parent-type spelling, redirect behavior, pagination guarantees, file-size limits, MIME reliability or consistent metadata/file revisions. Preserve those as acceptance questions.

Implementation choices below are application requirements, not claimed provider guarantees:

- Construct the download path from a validated attachment ID and the already authorized API origin. Preserve `file_download_url` as source evidence; never fetch it or forward credentials to it.
- Keep the existing trial/production origin allowlist and explicit production-source opt-in. Only read methods are permitted. Default configured resources remain contact/animal until commissioning.
- Initially support explicitly mapped Animal and same-patient Consult parents. Contact-level files cannot silently become patient records. Other parent types remain visible as unsupported coverage, not silently omitted from migration accounting.
- Use bounded streaming and a deadline for the complete download. Start with the existing document limit of20MiB and supported PDF/JPEG/PNG types. Validate file signatures separately from metadata and transport MIME; octet-stream is a transport declaration, not a clinical file type. Reject unsupported/conflicting files into an actionable discrepancy state. Do not claim malware scanning from MIME/signature checks.
- Reject redirects, unexpected compression, partial HTTP responses, oversized/truncated bodies and inconsistent declared lengths. Preserve exact original bytes and SHA256; do not transcode, alter or infer clinical interpretation.

## Existing architecture to reuse carefully

`ezyvet-import/adapter.ts` already controls OAuth scopes, API origins, bounded JSON reads, cooldowns and redirect rejection. It has no attachment resource or byte-download method. Add these only after scoped database claims prevent generic intake bypasses.

The existing private patient-document bucket, upload/read policies and original-byte release verification remain useful. `external-record-verification.ts` explicitly requires `staff_reviewed_manual_export_v1`; its receipt, capture and release projection cannot be reused unchanged for API attachments. Add an explicit API provenance model and validator. Do not relabel imported bytes as a manual export or weaken existing validators to make them fit.

## Required implementation sequence

1. **Scoped listing and immutable observations.** Add attachment resource handling plus dedicated parent-scoped runs, page receipts and observed attachment versions. Claims derive the external parent from a current reviewed mapping/consult context. Freeze actor, patient/household, site/origin and parent pins. Each page must match that exact parent; malformed/mismatched rows reject the whole page. Generic claim/stage paths reject attachment resources. Exact owned receipt recovery precedes mutable eligibility checks; fresh pages revalidate current pins and acquire canonical patient/source locks.
2. **Durable download intent and recovery.** Add private download requests with owned operation UUID, immutable requested context/hash and explicit states for pending, captured, abandoned and retryable failures. Authorize active staff/admin according to the existing intake boundary. Server service claims receive a short lease and expected source pins, never an arbitrary URL, bucket or path. Re-read attachment metadata around capture; detect changed observed revisions and record discrepancies rather than associating bytes with a superseded parent. This reduces races but does not establish a provider snapshot guarantee.
3. **Authenticated bounded byte transport.** Extend the adapter with the verified ID-based route and shared read-only OAuth. Consume the whole response within limits; check allowed file signatures, metadata, length and transport status. Abort/cancel on all failures and sanitize errors so tokens and source URLs do not enter logs. Rate limits persist through the existing durable cooldown workflow. Unit tests must prove zero requests for invalid origin/ID/parent and one authorized host for valid downloads.
4. **Private capture and ambiguous acknowledgments.** Allocate a server-owned immutable Storage key and capture receipt bound to actor, patient, parent, attachment observation, SHA256, MIME and size. Never overwrite a captured object. On lost upload/capture replies, recover the durable request and verify existing bytes before retrying. Expired partial objects require lease-aware cleanup; do not delete objects referenced by completed captures or retained ambiguous requests. Restore coverage must include request states, receipts and physical bytes.
5. **Explicit staff review and chart provenance.** Provide intake discovery/resume and an accessible patient-scoped review of original name/notes, parent association, source revision, file type/size and digest. Approval creates an immutable API attachment record; corrections append rather than rewrite. No inferred clinical text, diagnoses, treatments, stock or billing changes. Staff can inspect failed/unsupported records and their reasons. Preserve current page navigation and unsaved-review guards.
6. **Medical-record release integration.** Add an explicit API attachment source family and a versioned release projection while preserving schemas1–8. Reuse shared print/email/link rendering and original-byte digest verification. Source/parent reassignment, changed attachment metadata or approved replacement must invalidate affected pending packages without rewriting saved snapshots. Selection must never add unrelated attachments implicitly. Show API provenance and completeness limits consistently in chart and all delivery paths.
7. **Verification and commissioning.** Exercise SQL permissions, wrong actor/patient/site/parent, source A→B→A, exact retries, lease races, interruption/cleanup and correction cases; actual local HTTP/Auth/Storage downloads against synthetic upstream; browser review/recovery; mixed-file release rendering and original-byte replacement rejection; both-order source/capture/review/release contention; populated upgrades and physical restore. Then verify authorized practice samples, actual download/scopes/type/size behavior and operator/clinical acceptance before activating practice reads.

## Completion evidence required

- [ ] Parent-scoped metadata intake and exact run/page recovery, including unsupported-resource accounting.
- [ ] ID-based authenticated byte transport with tested bounds, redirect/compression rejection and supported-content checks.
- [ ] Private immutable capture, failed/ambiguous upload recovery and safe orphan cleanup.
- [ ] Explicit API-origin chart review and correction workflow with preserved original evidence.
- [ ] Explicit release selection, shared rendering and original-byte verification across all delivery paths; backward compatibility retained.
- [ ] Permission/contention/runtime/browser/populated-upgrade/restore checks pass on the integrated revision.
- [ ] Issued-site samples, entitlement, parent/date/file behavior, migration reconciliation and clinical acceptance verified.

No production-source reads, provider write-back, outgoing messages or deployment are authorized by this plan itself. Existing session authorizations and actual commissioning decisions remain authoritative.
