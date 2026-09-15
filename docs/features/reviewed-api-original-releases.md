# Reviewed API originals in client record packages

Schema 9 lets staff select ezyVet originals that have been admitted to the patient chart and separately acknowledged by a DVM. It builds on migration 7000 private captures and migration 7100 chart review. Migration 7200 adds release support; policy 9 remains unaccepted until the practice's clinical review is completed.

## Preparing a package

The record-release source list has a distinct API-original category. Candidates identify the source, chart version, verified file type and size, checksum, and veterinary acknowledgment. Historical provider observations are disclosed. Staff can select at most 20 admitted originals, either alone or alongside other chart records. Selection never silently truncates a larger result.

Each package freezes the exact admitted record and its earliest matching DVM acknowledgment. It requires the latest nonwithdrawn chart version and current patient/household mapping. A later provider metadata refresh alone does not erase previously admitted evidence. A replacement, withdrawal or changed household/mapping prevents new delivery of the old package.

The report discloses source provenance and review evidence. Original files are delivered separately with their unchanged bytes. They do not become `patient_documents`, and no clinical interpretations are generated from their contents.

Active DVMs can download each selected API original directly from the package preview without clearing selection. The existing chart-original endpoint authorizes the request, and the browser verifies size, file signature and SHA-256 against the preview's immutable record. A download clears prior package attestation and blocks confirmation while running; staff must open/review the file and attest separately afterward. ADMIN-only and other staff retain provenance visibility and DVM handoff guidance, with no new file-access permission. Late responses after session/role/preview changes or page exit do not trigger downloads.

## Verified delivery

Email attachments and document-link files share the same original-byte verification. The server derives the private Storage locator from the prepared delivery and frozen record; staff snapshots and public metadata do not contain private paths. A bounded native download checks HTTP status, redirects, type/signature, size and SHA-256, then rechecks the authorized delivery context. SQL independently validates the decoded bytes and exact file identity before saving the payload.

Ordinary document files retain their existing format. API originals follow them in deterministic order. The combined limit remains 24 originals plus the report and 32 MiB of encoded payload; each API original is at most 20 MiB and is PDF, JPEG or PNG.

Captured payloads remain historical evidence. Retrying an already captured preparation returns its exact original bytes and hashes without downloading again, even if the source is later withdrawn. That recovery does not restore permission to queue, send or publicly retrieve an ineligible package.

## Acceptance scope

The implementation contract and test requirements are in [the schema 9 contract](../plans/api-original-release-contract.md). Local acceptance uses synthetic patients, local Auth/PostgREST/Storage, and the production preparation handlers. It does not send messages or contact ezyVet.

Hosted migration reconciliation, clinical policy acceptance by Dr. Susan Edler, and live staff acceptance remain separate steps. Existing schemas 1–8 remain readable with their original captured payloads.

Validation is tracked in [PR #130](https://github.com/finite0001/livingroom-vet-care/pull/130). Local frontend checks passed, including all 291 browser scenarios; subsequent canonical-order validation has focused regression coverage. The first local HTTP attempt exposed an empty-success-response parsing bug in the test adapter, which was corrected. Its disposable resources were removed and verified. Full HTTP, race and populated-restore acceptance run in isolated CI jobs, avoiding dependence on an overloaded desktop Docker environment. Read the current checks and sanitized restore artifact for the final revision's result.
