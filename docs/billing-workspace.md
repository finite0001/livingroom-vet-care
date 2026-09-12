# Household invoice workspace

The household page lists invoices in pages of 20 and opens a selected invoice with its complete line and credit history. Active staff can create a draft, add catalog services, issue the displayed revision, record reasoned accounting credits or void an eligible issued invoice. Medication and vaccine charges originate in the atomic treatment workflow. Invoice identity, frozen totals, immutable lines and audit history remain server-controlled.

Amounts use integer USD cents. The credit parser rejects more than two decimal places, exponent notation, negatives and unsafe integers. UI net charges are not a payment balance: Stripe collection, payment callbacks, refunds, taxes, discounts, invoice numbering, delivery and immutable delivery snapshots remain separate work. Invoice preview now offers browser printing/PDF saving and an HTML download.

Create, service and credit operations retain their UUID/request across ambiguous responses. Inputs and invoice switching lock while a request remains unconfirmed; navigation warns before leaving. Explicit server rejections refresh current revisions. Reloading after an unconfirmed request requires reviewing saved history before initiating another operation. No client messages or payments originate in this increment.

Validation includes exact-cent parsing and a browser scenario simulating lost create/service responses, verifying one operation identifier across retries, navigation protection, issuing the expected invoice revision and recording a credit without claiming payment/refund. Database invariants are exercised in inventory/billing pgTAP tests.

## Confirmed launch inputs

Antech is the selected lab provider; Dr. Susan Edler reviews clinical forms; anesthesia system remains TBD. Living Room Vet is the primary system, with reviewed imports from ezyVet. The user authorized patched React Router v7. These decisions are also recorded in the commercial-readiness tracker.

Antech's ezyVet SDI integration requires a configured API integration and credentials from Antech customer support ([official configuration guide](https://docs.ezyvet.com/en/see-all-integrations/diagnostic-tests/antech/antech-integration-configuration/configure-the-standard-diagnostics-integration-sdi-for-antech)). That establishes an existing ezyVet integration path, not permission or specifications for a direct Living Room Vet connector. Confirm direct integration access and test samples during commissioning.

## Current invoice documents

The invoice preview reads the invoice, household mailing identity, complete lines and all credits through one active-staff RPC statement. It checks the invoice/household pairing and omits primary contact values, housecall addresses, internal credit/void reasons and staff identifiers. Money is serialized as decimal integer text and rendered with BigInt arithmetic, including values beyond JavaScript safe integers. Inconsistent totals or status fail closed.

This is a current rendering, not an immutable issuance or delivery snapshot. It labels draft and void copies clearly and states that payments are not included; net charges are not represented as an outstanding balance. The full UUID is the invoice reference until a reviewed numbering scheme is adopted. Household identity reflects the current record, and each copy includes its rendering timestamp.

The preview is sandboxed and the standalone HTML denies scripts/network resources through CSP. All variable text is escaped. Staff can print/save PDF through the browser or download the actual HTML copy; no email, SMS, payment request or provider upload occurs. Refresh discards the prior preview before reading, so a failed refresh cannot export a stale copy. Actor changes remount the preview.

Validation: 19 SQL assertions, four renderer unit tests, and three billing browser scenarios covering desktop/mobile previews, exact credits, literal untrusted text, downloaded HTML, an actual PDF print artifact, void refresh and access-error clearing. Independent read-only review found no material issue within this scope.
