# Package 3A2 — diagnostic PDFs in selected record-release packages

3A2a implemented: staff sharing-scope preview plus private immutable binding/readback checks; its exact-head CI, specific PR approval and migration178 rollout are pending. #243 is approved, merged as `deb836e3e69cc1ed4ab4a6f40dff54208c345c9a` and rolled out default-off to both177-migration backends. Bounded hosted48-check native Edge/browser acceptance passed. No record-release/provider activation. Internal staff disclosure authority is not client/third-party release authority. All45 launch requirements and Susan's acceptance remain required.

## Scope and selection

Add a versioned `diagnostic_pdf_ids` release family and schema14 while preserving schemas1–13. Reuse numbered records-request packages, existing email/protected links and existing verified client/authorized-third-party authority. Eligible items bind immutable finalized version/job ID, reviewed date, current/historical status, capture/manifest/source hashes, actual private object identity/body generation and byte SHA/length. Draft, unregistered, missing or replaced PDFs must have precise exclusions. A current-only default cannot substitute an older PDF when the latest corrected PDF is unavailable; explicit historical selection retains its actual version and superseded label.

**Embedded-history disclosure:** existing PDF manifests can contain up to200 other reviewed diagnostic panels and trend history as of the source review. A single selected PDF can therefore include additional clinical history. Inventory, preview and manifest must enumerate every embedded version ID and require explicit scope-expansion review, including custom subsets. Never label this attachment “only this panel” while hidden results are embedded. If the requester declines that expansion, omit the artifact or plan a separately reviewed selection-specific PDF family later; never rewrite or regenerate the existing immutable capture. Vaccine-only packages must remain vaccine-only.

## Concrete implementation sequence

1. Extend `record_request_families`, the diagnostics inventory wrapper, bounded preview and manifest preparation with the new family and exact embedded-version census. Retain latest-version exclusions and immutable source IDs. Add diagnostic dependencies to numbered-package splitting and clinical scope-expansion attestation; indivisible dependency groups must fail clearly rather than truncate. Existing budget:24 original attachments plus HTML,32MiB per package.
2. Add schema14 release preview/list/confirmation/recovery wrappers, keeping old schema dispatches. Freeze exact version/artifact/census and current versus historical policy into the manifest. Current-source drift must invalidate a current-only preparation; historical source handling must be explicit. Preserve patient/root → diagnostic root/job → request/manifest locking order and avoid reverse locks while checking existing captures.
3. Add a private service-side diagnostic release-binding validator. Resolve `diagnostic-pdfs` only from a reviewed manifest; accept IDs/hashes rather than caller bucket/path/URL. Recheck source/version, registration, object UUID/created_at/updated_at/version, actual captured bytes, reader/patient scope and clinical disclosure authority after waits. Do not reuse #243's30-second staff download authority as recipient authority or enable its policy implicitly.
4. Extend release renderer, email byte payload and document-link artifact contracts with a strict diagnostic attachment branch. Preserve MIME/size/SHA, bounded streaming readback, exact replay and private protected-link behavior. Keep actual admitted PDF bytes unchanged. No public/signed Storage URL, new dispatcher or broader recipient exception.
5. Extend records-request source selection and package preview on desktop/mobile with reviewed version/date, historical labels, exclusions, embedded history and scope-expansion controls. Preserve explicit uncertain-save recovery and numbered package identity. Keep outgoing delivery off through engineering acceptance.

## Existing integration contracts

- [Records-request family/inventory/manifest/package/recipient authority](https://github.com/finite0001/livingroom-vet-care/blob/ac3662ff10c4c56fdfaeafbd165ee1f5d1c18f12/supabase/migrations/20261011025251_records_requests_and_packages.sql): family functions and manifest preparation around105–355; authorization/current checks498–514; confirmation/read/email/link authority435–645.
- [Diagnostics inventory wrapper](https://github.com/finite0001/livingroom-vet-care/blob/ac3662ff10c4c56fdfaeafbd165ee1f5d1c18f12/supabase/migrations/20261011181722_manual_diagnostic_panels.sql):195–200 currently excludes all diagnostics.
- [Existing schema13 preview wrappers](https://github.com/finite0001/livingroom-vet-care/blob/ac3662ff10c4c56fdfaeafbd165ee1f5d1c18f12/supabase/migrations/20260916100000_native_return_reconciliation_releases.sql):33–58.
- [Original byte binding and capture guards](https://github.com/finite0001/livingroom-vet-care/blob/ac3662ff10c4c56fdfaeafbd165ee1f5d1c18f12/supabase/migrations/20260913480000_release_source_byte_binding.sql): `verify_release_source_original_v5`, `capture_release_email_payload`, `capture_document_link`; inspect later wrappers before editing.
- `_shared/record-release-renderer.ts`, `release-email-payload.ts`, `document-link-artifacts.ts`: schema support, diagnostic bucket/reference branch and byte-bound schemas. Current attachment contracts allow only patient-documents/ezyvet-attachment-originals.
- `record-releases/selection.ts`, `api.ts`, `print.ts`; `records-requests/model.ts`, `RequestWorkspace.tsx`: strict family/schema and selection/preview controls.

Third-party recipients are already EMAIL-only, named and bound to the exact request/manifest/destination, client authority, destination verification, optional evidence-document version, expiry and revocation. Reuse final authorization checks in confirmation, release read, email/link context and outbox preflight. Ordinary inbox/payment recipient rules are unchanged.

## Acceptance and rollout

- Current registered PDFs join labs/custom/full numbered packages with exact binding and truthful exclusions; vaccine-only stays unchanged.
- Explicit historical PDFs keep original bytes/version, display superseded status and cannot silently change after correction.
- Embedded history is fully visible and requires scope-expansion attestation even in custom subsets; declined expansion blocks inclusion.
- Genuine Auth/Storage roundtrip verifies exact admitted bytes in email payload and protected-link artifacts. Same-size replacement, object recreation/generation drift, hash changes and oversized streamed bodies are rejected.
- Attachment/package budgeting includes diagnostics and dependency groups without truncation.
- Client/third-party authorization revocation, expiry, destination/evidence drift after preparation and capture blocks new delivery/retrieval; uncertain acknowledgments recover the same immutable package/payload.
- Observe correction versus confirmation/final-byte checks and recipient-revocation waits; prove stale-current denial without deadlock. Anonymous/inactive/wrong-patient and unnumbered third-party confirmation are denied.
- Preserve old schemas, clinical history, generated Lovable types and all provider gates. Restore captures, package/manifest/authority/audit evidence without claiming provider object-body backup.
- Exact-head checks and Dave's specific PR approval precede staged default-off migration/function rollout, bounded hosted acceptance and primary installation. No clinical/outgoing commissioning until explicitly approved and Susan has accepted layout/workflows.


## Reviewable split and remaining3A2b

3A2a now adds `read_diagnostic_pdf_release_scope` (staff metadata only), private `diagnostic_pdf_release_binding` and `verify_diagnostic_pdf_release_bytes`, explicit current/historical scope and exact embedded version census. Patient360 offers an on-demand sharing-scope review. `export_available:false` is mandatory. Existing numbered inventory still excludes diagnostics; no schema14 package or recipient exporter exists yet. This package does not claim completed record sharing.

3A2b must deliver inventory, schema14 selection/preview, numbered confirmation and byte/recipient-current transport together. Patch the renamed cores `confirm_record_release_without_record_request` and `release_read_internal_without_record_request`; preserve the outer recipient-current wrappers. Extend all inherited schema13 source-invalidation allowlists to14. Reuse the current recipient authority; never substitute staff download authority.

Lock order: existing native authorization/per-patient4700 gates → patient → every selected/embedded diagnostic root sorted → inherited clinical source locks → jobs/objects. Calling inherited13 before diagnostic roots risks root/source ABBA against diagnostic finalization. Diagnostic correction invalidation should append `source_changed` events, without acquiring request locks or upgrading release locks. Test mixed packages, current correction, embedded history correction, third-party revocation and retrieval after capture using observed blocking.

The new private byte helper proves source binding only. Before wiring export,3A2b must also prove exact numbered manifest and current recipient permission before and after reads/waits. Package budget must count PDF attachments and visible embedded disclosure groups; vaccine-only stays on existing13. Durable object-body backup and Susan's rendered/workflow acceptance remain explicit operational requirements.
