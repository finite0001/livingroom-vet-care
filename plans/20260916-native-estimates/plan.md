# Native estimates, acceptance and actual charge capture

Status: draft foundation implemented as a candidate under verification; complete estimates are not yet implemented or accepted. This is the next dependent phase after native dispense finance. It does not replace remaining standalone feature parity or communications work.

## Outcome

Staff prepare and publish a versioned estimate for a household and patient. A client can review the exact published document and accept or decline that revision. Staff can record a separately attributed witnessed decision. Accepted service, vaccine and medication quantities/prices become a controlled execution plan. Charges are created once, when the corresponding service, treatment or dispense is performed. Acceptance is neither a clinical order nor proof of payment.

## Evidence and chosen approach

The current native product has ticket metadata `estimate_sent`, but no complete estimate ledger, public decision workflow or accepted-price execution path. The existing billing/treatment/dispense RPCs use current catalog prices. Pre-creating invoice lines at acceptance would double-charge stock-backed work; converting only services would leave the requested veterinary workflow incomplete.

Use immutable accepted line authorizations, consumed by actual work, with one attributed invoice item per charge allocation. Preserve published artifacts and old clinical/financial receipt versions. See the [lifecycle and approval design](phase-01-lifecycle-approval.md) and [execution and acceptance design](phase-02-execution-acceptance.md).

## Phases and status

1. **In progress — lifecycle and staff documents.** Versioned drafts, exact publication, replacement/withdrawal, immutable history and reviewed delivery.
2. **Pending — client and staff decisions.** Separate capability-bound public review/accept/decline; explicit staff-witnessed attribution and recovery.
3. **Pending — accepted work and billing.** Services, medications and vaccines; exact quoted prices, partial work, rounding, unused balance and replacement.
4. **Pending — integrated acceptance.** SQL, actual Auth/HTTP, observed contention, public/staff browser workflows, selected document delivery and populated restore. Provider and clinical acceptance remain separate.

Each phase can be a dependent draft PR; do not describe the estimate feature as complete before all four pass. Existing payment commissioning remains owner-deferred. No ezyVet setup or provider calls are needed for implementation.

## Engineering defaults to expose explicitly

- Staff choose an expiry before publication; the document states whether that date limits acceptance or performance. The first implementation guarantees the accepted price for its explicitly approved quantities; changing those terms requires a new revision.
- Acceptance covers the complete exact revision. Changes or partial proposals require a new revision, rather than an ambiguous partial signature.
- Publishing a replacement freezes unused authorizations from the old revision. Existing completed work/history remains intact. Newly accepted residual quantities must explicitly account for prior consumption.
- Additional quantities/substitutions require separate review and cannot silently consume a different accepted line.
- Partial invoicing bills performed work only and discloses accepted work still outstanding.
- Discounts/bundles must have a frozen allocation to executable lines before acceptance. Deposits are separate cash/prepayment workflows, never fake medication charges.

Practice approval of price-validity wording, cancellation terms, discounts and deposits is required before live use. These are visible configuration/wording decisions, not reasons to omit the underlying lifecycle.

## Remaining product scope

The [standalone matrix](../../docs/standalone-feature-matrix-20260916.md) remains authoritative for the original requirements and unassessed ezyVet/Vet Connect Hub parity. Portal membership, treatment consents, check-in, inventory purchasing/transfers, reporting and the remaining communications capabilities are separate requirements. An estimate signature does not implement any of them implicitly.

## Open questions

Clinical reviewer: Dr. Susan Edler. Business wording and production defaults remain unapproved. Provider delivery and Stripe acceptance cannot be inferred from synthetic tests. No question here authorizes charges, external messages or integration changes.

Draft foundation candidate: [exact contract](draft-contract.md), the 127-migration inventory, household staff editor, closed API, immutable revisions, priced lines and saved-request resolution are implemented. Draft backend CI35094462715 passed SQL, actual Auth, observed contention and populated restore verification. Six local staff browser scenarios passed, including mobile history; billing/email regressions passed with two isolated timeout reruns. Final combined-source CI and hosted review remain pending. Publication, client decisions and actual-work pricing conversion remain required.
