# Antech integration: audited gaps and implementation sequence

Reviewed 2026-09-12 against repository commit `a2dc08c` and current official public pages. Living Room Vet is the primary clinical record system; ezyVet is an import source. Antech is the selected reference laboratory. Dr. Susan Edler reviews clinical mappings and presentation.

**Decision:** retain the working manual lab workflow while obtaining the supported Antech integration contract. No production adapter can be responsibly implemented from the public contract evidence located in this review. This plan defines concrete local work and the later transport boundary; it does not configure a connection or invent API endpoints. The existing [commissioning checklist](../antech-commissioning.md) remains the acceptance register.

## Official evidence and its limits

| Primary source, checked during this audit | Supported conclusion | Not established |
| --- | --- | --- |
| [Antech U.S. reference-lab onboarding](https://www.antechdiagnostics.com/reference-lab/resources/onboarding-resources-us/) | Electronic requisitions can originate in practice software or HealthTracks. | Living Room Vet connector approval, HTTP endpoints, schemas, or permissions. |
| [Antech HealthTracks product page](https://www.antechdiagnostics.com/reference-lab/healthtracks/) | The vendor product offers results, trending, test lookup, ordering and client communication. | Availability of each product feature through a third-party API. HealthTracks communication is not Living Room Vet's unified inbox. |
| [Antech development PIMS stub](https://pimsint-dev.antechdiagnostics.com/) | The visible demonstration contains clinic/user/password authentication and token inputs; order/result operations, separate clinic/lab accession inputs, report formats, dictionaries, and acknowledgments. | Production base URL, HTTP verbs/paths, token transmission/renewal, required fields, error meanings, schemas, version identity, pagination, polling limits, or acknowledgment guarantees. Form labels are not a versioned API specification. |
| [Antech support contact page](https://www.antechdiagnostics.com/contact-us/) | Antech provides a reference-lab website/PIMS support route. | Account provisioning, partner acceptance, commercial terms, or technical access for this project. |

The official [HealthTracks software-update page](https://web.antechdiagnostics.com/healthtracks-software-update) was also inspected; it did not provide an API reference usable for this adapter. Search results containing modeled third-party “Antech API” catalogs were excluded as contract evidence. Do not generate clients from inferred OpenAPI definitions or assume that a PIMS product's “V3”/“V6” setup label defines this project's supported API version.

The browser research tool could read the development page. A read-only attempt to inspect its public HTML via a separate client returned HTTP 403 and was not bypassed. No authentication form, provider API, vendor support message, or account-change operation was submitted.

### Endpoint and authentication finding

**Verified, implementable production endpoints: none from the reviewed public material.** The development demonstration URL is a page, not a confirmed API base URL. The login fields do not establish OAuth, Basic authentication, bearer headers, credential scope, or token lifetime. Do not use the ezyVet OAuth implementation for Antech by analogy.

Obtain from Antech's authorized integration representative: the current versioned reference-lab specification, approved environment URLs, exact authentication and renewal contract, required partner/application/clinic identifiers, allowed operations, sandbox onboarding, synthetic fixtures, and production acceptance process. Whether a partner agreement is required and which credentials the practice receives must be confirmed directly; public evidence does not settle those details.

## Code audit

| Existing implementation at `a2dc08c` | Gap to an actual integration | Required change |
| --- | --- | --- |
| `src/hub/features/lab-work/PatientLabWork.tsx` and `model.ts`: staff-entered test name, local workflow status, dates, notes and accession | No provider catalog selection, external identity or retrieval state | Keep the native editor; add a separate source/matching/review panel. Never treat selecting `ordered` as evidence of vendor acceptance. |
| `20260913100000_lab_work.sql`: `patient_lab_orders`, active-staff RPC, optimistic versions, correction history | One free-text accession cannot distinguish clinic accession, laboratory accession and account/environment | Add explicit source identity mappings rather than changing the semantics of the existing text field. |
| Same migration: one current `result_document_id` and narrative notes | No immutable vendor result versions, result-line schema, partial/corrected state or ingestion acknowledgment | Add append-only source receipts, report versions and document links. Preserve native notes and all prior reports. |
| `lab_due_templates` with reviewed version, interval, anchor and overrides | These are local clinical due plans, not Antech test codes or provider schedules | Preserve local ownership; catalog updates never recalculate patient due dates or clinical intervals. |
| Existing private patient documents and same-patient ready-document checks | No vendor download provenance, staged unmatched reports or atomic acknowledgment boundary | Stage downloaded bytes privately with integrity metadata before patient promotion. Reuse document access rules after a reviewed match. |
| No Antech transport under `supabase/functions` | No auth adapter, polling/webhook contract, rate-limit handling, resume cursor or operation audit | Implement only after the approved specification fixes those semantics. Default all future provider operations off. |
| `docs/ezyvet-staged-import.md`: explicit source allowlist; diagnostic collection removed | Historical ezyVet diagnostic definitions are not lab result records | Keep import provenance separate. Do not use a catalog definition endpoint as Antech-result retrieval or silently make ezyVet primary. |
| Native result correction reason and history | Technical import success is not clinician review | Record clinician acknowledgment independently; no interpretation, normal-range inference or automatic client release. |

## Proposed increments and completion evidence

These names describe local responsibilities, not Antech request/response schemas. Final provider mapping is conditional on the approved specification.

### 1. Local result provenance and review foundation — no provider traffic

Create an integration account/environment registry containing identifiers and enabled capabilities, with secrets referenced only by server configuration. Add immutable source receipts (received time, content hash, media type, source identity, parser/specification version), explicit identity-map revisions, and a staged/unmatched review queue. Design uniqueness only after the contract establishes durable external result/version identifiers; raw byte hashes can detect repeats but cannot alone identify clinical result versions.

Link a receipt to a native lab order and private report only through an active-staff reviewed action with exact receipt hash and expected order version. A missing or conflicting patient/account/accession match remains staged. Names, birthday or microchip may assist staff comparison but must not authorize an automatic identity merge. New result evidence must not overwrite local clinical notes, diagnoses, due plans or existing report versions.

Deliverables: additive migration/RLS/RPCs, source-review UI and synthetic receipt fixtures clearly labeled non-provider data. Acceptance: cross-patient/account denial, same-request replay, concurrent review conflict, original-file hash preservation, audited correction, and no service key in browser code. This is useful local infrastructure, not a working Antech connection.

### 2. Contract-gated, inbound-first Antech adapter

After the specification and sandbox are available, map the documented authentication, result discovery, report retrieval, status and acknowledgment operations. Pin approved hosts and environment/account scope; bound response bytes/time, disallow unexpected redirects and preserve request correlation without logging reports or credentials. Use the documented polling/cursor protocol or authenticated callbacks; do not invent either.

Store source evidence and original report bytes durably before acknowledging receipt. For a result awaiting patient matching, acknowledge only if Antech's agreed protocol permits durable quarantine as receipt; otherwise retain an explicit pending acknowledgment. Unknown result versions or malformed payloads remain reviewable failures, not empty successful responses. Lost download/ingestion/acknowledgment responses retry the same source operation and cannot duplicate a report.

Deliverables: contract-mapped parser and transport, service-only ingestion RPC, acknowledgment state machine, bounded worker, operational status panel. Acceptance: synthetic sandbox final/partial/corrected reports, same result replay, foreign clinic, expired credential, rate limit, interrupted download, acknowledgment failure and restart. Dr. Susan Edler verifies report presentation. Start with original reports; structured observations and trending require their own documented schema and review.

### 3. Explicit electronic orders and catalog mapping

Use approved test/species/breed/unit dictionaries with source version and locally reviewed mappings. Freeze an actor-reviewed order snapshot containing exact selected codes, local patient/order identity, provider account and the contract-required identifiers. Persist a stable submission request before network I/O. On an uncertain response, recover the original operation using the documented correlation/retry mechanism; never generate a fresh requisition simply because a timeout occurred.

Keep local workflow status and vendor acceptance/status separate. Require provider evidence before showing “accepted by Antech.” Requisition/report document retention, cancellations, add-ons, rechecks, billing relationships and courier requests are separate capabilities: include only what the approved API documents and the practice elects to use. Do not infer API cancellation behavior from product marketing.

Deliverables: reviewed catalog mapping, explicit submit action, provider acknowledgment history and unknown-outcome queue. Acceptance: changed draft rejected after review, duplicate clicks, timeout after provider acceptance, catalog retirement, patient reassignment, cancellation/collection race, and no duplicate invoice charge. Lab ordering does not implicitly authorize emailing results.

### 4. Clinical operations and supervised activation

Run a small supervised set of approved cases for both housecalls and the clinic home base. Verify specimen/requisition workflow with the practice; location must not accidentally select another clinic account. Record application revision, contract version, account/environment identity, clinician and technical sign-off, observed sandbox/production evidence, monitoring owner and rollback action.

Enable one capability at a time. A stop switch pauses new transport while retaining receipts, unresolved work and recovery history. Client reminders, record sharing and unified inbox delivery remain explicit reviewed communication workflows with their own permissions and delivery receipts. No “connected” badge or completed commissioning status before real authorized end-to-end evidence exists.

## Practice onboarding status

The owner confirmed on September12,2026 that Antech has not yet assigned Living Room Vet an account representative or onboarding contact. No production API contract or practice integration credentials have been supplied. Vendor onboarding and a technical contact remain prerequisites for real integration acceptance; no outreach has been authorized or sent.

## Contract handoff packet to prepare

No message has been sent. The practice's eventual request to Antech should identify Living Room Vet (`thelivingroom.vet`), Boulder clinic home base at 2619 Spruce Street plus housecalls, native primary records, and inbound results before outbound ordering. Ask for:

1. Supported direct custom-PIMS integration program, reference-lab API version/specification and authorized sandbox/production hosts; clarify whether in-house instrument integration is a distinct product/contract.
2. Authentication, credential custody/rotation, account and clinic boundaries, callback/polling support, operation permissions, rate limits and timeout/retry guidance.
3. Real schemas and synthetic fixtures for patient/order correlation, both accession types, final/partial/corrected/orphan results, original reports and dictionary versions.
4. Stable identity/version rules, retention, durable acknowledgment semantics, unknown submission recovery, cancellations and catalog changes.
5. Required partner/practice acceptance steps and a technical contact to validate the sandbox evidence.

Do not place passwords or API secrets in this document or chat. Record nonsecret contract and account evidence in the commissioning register once available.

## Next decision and immediate path

Proposed first implementation is increment 1 only; the current task produces the audited plan, not speculative transport code. Once an official contract is supplied, return with the exact supported endpoint/auth scope before implementing increment 2. Antech contract availability is an external dependency, not a reason to stop unrelated practice work.

For the housecall launch, staff can continue recording local lab plans and dates, using Antech's authorized portal workflow, uploading original reports as private patient documents, and documenting review. This fallback is operationally manual and must remain labeled as such. The primary-record choice and future direct integration do not depend on leaving ezyVet running as an intermediary.
