# Package 3A2 — diagnostic PDFs in selected record-release packages

3A2a (#244) is approved and merged as `8bb1592bb49c8084d47b026cb20ba2c6f2c4e70b`. Migration178 is applied default-off on staging and primary; staging passed59 genuine Auth/native PDF/Edge/browser checks and both databases passed26 rollback-only checks. The production sign-in page serves the primary backend with no page errors. Three temporary hosted VMs are stopped/nonpersistent/deny-all without snapshots. See the committed rollout evidence. No clinical, recipient/provider, worker/runtime or staff-download commissioning remains enabled. All45 launch requirements and Susan's acceptance remain required.

3A2b implements schema14 numbered diagnostic packages on a separate branch; all required exact-head CI passed; Dave approved and merged #245, and migration179 plus the eight affected functions are now installed on staging and primary, default-off.

## Scope and selection

Add explicit `diagnostic_pdf_ids` (current) and `diagnostic_pdf_historical_ids` (frozen historical) release families and schema14 while preserving schemas1–13. Reuse numbered records-request packages, existing email/protected links and existing verified client/authorized-third-party authority. Eligible items bind immutable finalized version/job ID, reviewed date, current/historical status, capture/manifest/source hashes, actual private object identity/body generation and byte SHA/length. Draft, unregistered, missing or replaced PDFs must have precise exclusions. A current-only default cannot substitute an older PDF when the latest corrected PDF is unavailable; explicit historical selection retains its actual version and superseded label.

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

3A2a now adds `read_diagnostic_pdf_release_scope` (staff metadata only), private `diagnostic_pdf_release_binding` and `verify_diagnostic_pdf_release_bytes`, explicit current/historical scope and exact embedded version census. Patient360 offers an on-demand sharing-scope review. `export_available:false` is mandatory. The178 hosted baseline still excludes diagnostics from numbered packages. Migration179 now supplies schema14 inventory/selection/capture on both hosted backends. It remains uncommissioned.

3A2b must deliver inventory, schema14 selection/preview, numbered confirmation and byte/recipient-current transport together. Patch the renamed cores `confirm_record_release_without_record_request` and `release_read_internal_without_record_request`; preserve the outer recipient-current wrappers. Extend all inherited schema13 source-invalidation allowlists to14. Reuse the current recipient authority; never substitute staff download authority.

Lock order: existing native authorization/per-patient4700 gates → patient → every selected/embedded diagnostic root sorted → inherited clinical source locks → jobs/objects. Calling inherited13 before diagnostic roots risks root/source ABBA against diagnostic finalization. Diagnostic correction invalidation should append `source_changed` events, without acquiring request locks or upgrading release locks. Test mixed packages, current correction, embedded history correction, third-party revocation and retrieval after capture using observed blocking.

The new private byte helper proves source binding only. Before wiring export,3A2b must also prove exact numbered manifest and current recipient permission before and after reads/waits. Package budget must count PDF attachments and visible embedded disclosure groups; vaccine-only stays on existing13. Durable object-body backup and Susan's rendered/workflow acceptance remain explicit operational requirements.


## 3A2b implementation decisions

- Full presets select registered current PDFs only; lab presets additionally require laboratory-category reports. Historical PDFs require an explicit custom selection; the same job cannot occur in both families. Missing/unregistered corrected current reports remain precise exclusions.
- A selected PDF is indivisible. Its exact embedded census is visible and requires expansion attestation even for a custom request. Embedded panels do not create duplicate PDF attachments. The24-original/32MiB budget includes both diagnostic families.
- Schema14 freezes immutable artifact binding plus a separate reviewed context for every embedded root. A subsequent draft/root change makes the snapshot differ; a finalized correction appends invalidation evidence. Current/historical modes never change implicitly. A historical PDF may be reviewed again under an explicitly new manifest after correction, retaining its original bytes/version.
- Private schema14 helpers compose with the existing numbered request/recipient wrappers. Neither internal staff-download policy nor processing-owner status grants recipient authority. The original confirmation receipt remains recoverable after correction/revocation without restoring delivery eligibility.
- Shared browser/Edge validation enforces both directions between selection, diagnostic records and original attachments; diagnostic bytes cannot be downgraded to ordinary/API originals or old schemas. The existing email/protected-link capture RPCs independently verify actual admitted bytes and current recipient permission.
- No policies are seeded by179. Genuine capture tests run only in uniquely owned disposable Auth/Storage runtimes; no provider sends or hosted179 writes are authorized before the new PR is approved.

## Completed179 rollout and next work

#245 merged as `20b035f1e93ac4629b4051dedbff736952cc267f`. Staging passed193 genuine Auth/native-PDF/deployed email/protected-link/browser checks and cleanup. Both179-migration backends passed38 rollback assertions; primary clinical/provider gates remain off. Twelve owned renderer VMs are stopped/nonpersistent/deny-all without snapshots. See [rollout evidence](../../docs/launch-evidence/2026-10-13-diagnostic-pdf-record-packages-rollout.md).

The rollout exposed four missing per-function Deno maps for the shared Zod validator. An explicit existing pinned map completed both deployments. The follow-up PR supplies the missing configs/locks and checks/bundles every diagnostic-release consumer outside the root Node environment. No additional migration, delivery commissioning, or autogenerated type update is required. After this repair, continue batch6: appointment types, next-visit prompting and room/surgery-based cleaning/restocking tasks. Practice templates and Susan acceptance remain open; all45 launch requirements remain required.
