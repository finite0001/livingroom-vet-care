# Antech adapter commissioning — pending contract and account evidence

Antech is the selected lab provider. A production adapter is not implemented or commissioned by this document. The existing [native lab-work workflow](lab-work.md) supports staff-entered orders, due dates, accession references, result dates, same-patient private documents and preserved corrections. Staff can use that workflow while integration requirements are resolved; it does not place an Antech order or retrieve an Antech result automatically.

## Official public evidence reviewed 2026-09-12

Antech's [development PIMS stub](https://pimsint-dev.antechdiagnostics.com/) displays clinic/user authentication and token fields, order placement/status, result status/retrieval, clinic and laboratory accession identifiers, PDF/DOC/XML/RTF result options, species/breed/unit/test-code lookups and explicit order/result acknowledgments. It is a development demonstration surface, **not a confirmed production API contract**. No authentication form was submitted or provider API called during this review.

Antech's [U.S. reference-lab onboarding resources](https://www.antechdiagnostics.com/reference-lab/resources/onboarding-resources-us/) describe electronic requisition forms through PIMS or HealthTracks. This supports discussing an authorized integration with Antech; it does not establish that Living Room Vet has an enabled account or an approved connector.

## Obtain before implementing an adapter

- Current Antech-approved, versioned integration specification and any required signed partner/account agreement; authorized production and sandbox environments and intended clinic/account scope.
- Exact authentication contract, permitted operations/scopes, token expiry/renewal, secret rotation and environment separation. Store credentials only in server secret storage. Do not infer authentication details from the public stub.
- A dedicated authorized sandbox/sample clinic account with synthetic client/patient/order identities, expected reports and documented lifecycle examples. Obtain the supported production onboarding and acceptance process separately.
- Documented order identifiers, patient/client identifiers, accession correlation, result-version semantics, statuses, timestamps/timezones, pagination/polling limits, retry rules and acknowledgment semantics. Confirm whether corrections replace, append or supersede prior material.
- Agreed original-report formats and structured-result schema; dictionary/version information for species, breeds, units, tests and reference intervals. Confirm permitted retention and report-delivery behavior.
- Explicit guidance for notifications if supported. No webhook endpoint, callback authentication or automatic polling schedule is invented here. The supported transport must come from the approved contract.

Record the source/version, Antech contact approval, practice approver and test evidence for each item. Missing contract details remain open; do not substitute guessed endpoints or sample credentials.

## Required acceptance cases for a future adapter

These are Living Room Vet's implementation requirements to validate against the approved contract, not claims about current Antech API behavior.

| Case | Required evidence |
| --- | --- |
| Clinic/account boundary | A result/order from another clinic or environment is rejected or quarantined, never attached to a local patient by name alone. |
| Patient/order matching | Persist source account, external client/patient IDs, local patient/order IDs and clinic/lab accession IDs. Missing or conflicting matches require staff review; no silent household move or overwrite of local identity. |
| Original report | Retain the original PDF bytes privately, with source, accession, received time and integrity metadata. Link only to the matched patient. Structured summaries do not replace the original report. Confirm other supported formats with Antech before adding parsers. |
| Partial, final and corrected results | Test each vendor-defined lifecycle. Preserve prior result versions and original files, with explicit status and correction/supersession provenance. A new result must not silently erase a signed clinical interpretation or earlier report. |
| Duplicate polling and replay | Poll the same page/result repeatedly, retry after a lost response and replay after restart. Stable external identity/version yields one durable ingestion record, without duplicate lab orders, observations, attachments or notifications. |
| Acknowledgment | Acknowledge only after durable ingestion of the source evidence and required original file succeeds. Failure must remain recoverable. If patient matching is unresolved, retain a durable quarantine record and follow the approved acknowledgment policy rather than losing the result. Test lost acknowledgment responses idempotently. |
| Units and reference intervals | Preserve vendor-supplied value text, units, reference intervals, flags, species/context and dictionary/version provenance exactly. Do not infer missing intervals, relabel units or interpret results automatically. Any conversion requires an explicit separately reviewed transformation with the original retained. |
| Patient review | Staff see accession, patient mapping, source status, original report and unresolved discrepancies before clinical use. Clinician review is recorded separately from successful technical ingestion. |
| Failure recovery | Verify token expiry, rate limiting, bounded timeouts, malformed payloads, incomplete file downloads, stale cursors and restart recovery with synthetic accounts. Logs must not contain secrets or complete patient reports. |
| Outbound orders | If authorized order placement is included, prove exact approved test selection and clinic/patient identifiers, idempotent retry, cancellation/correction semantics and explicit user authorization. Do not infer order permission from read access. |

## Commissioning record

Status: **pending**. Required reviewers: authorized practice operator, Antech integration representative and Dr. Susan Edler for clinical mapping/report presentation. Record contract version, account/environment identity (no secrets), adapter revision, synthetic case results, approved permissions, unresolved exclusions and activation decision. Production activation requires separate hosted verification and monitoring/recovery ownership.

Provider selection, a public development form, successful mock tests or a prepared checklist is not evidence of a working production lab integration. The [clinical review register](clinical-review/README.md) and [commercial-readiness tracker](commercial-readiness.md) retain this distinction.

## Implementation sequence

The [Antech integration gap audit and phased plan](plans/antech-integration.md) records the current code boundary, verified public-contract limits, inbound-first implementation scope and partner handoff packet. No provider adapter is enabled by that plan.
