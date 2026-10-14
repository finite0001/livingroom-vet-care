# Vendor findings and integration boundaries

Researched October 8, 2026 using official vendor and official integration-partner documentation. Capabilities below do not establish access for this account. No vendor was contacted, no enrollment purchased and no credentials changed. Recommendations are planning judgments.

## MWI and Midwest Veterinary Supply

Dave confirmed both purchasing accounts exist. MWI offers account-based product ordering and inventory services, but this research did not establish a public US catalog API/export contract. [MWI inventory services](https://www.mwiah.com/solutions-and-services/inventory-management)

Official DaySmart documentation describes MWI/Midwest catalog/product-number, ordering and receiving integrations. This establishes that partner integrations exist; it does not grant a custom Living Room Vet application the same interface. [DaySmart supplier integration documentation](https://help.vettersoftware.com/en/articles/9301102-ordering-inventory-through-mwi-patterson-or-midwest-veterinary-supply-formerly-victor-medical-integrations)

**Plan:** obtain an actual catalog/price export or approved interface from each account; implement supplier+SKU crosswalk, preview/mapping and idempotent import first. Keep purchase units, dispensing units, costs and retail pricing distinct. Product import is the requested scope; automatic purchase ordering is additional scope. Do not use MWI UK API material as proof of US access.

## Gusto: two-way capabilities, restricted custom access

Gusto has resource-specific read/write APIs. Its current App Integration introduction restricts production to approved partners, requires pre-approval/security review, and excludes direct own-company custom integrations under that route. This matters because Dave confirmed **internal use only**. [Gusto API introduction](https://docs.gusto.com/app-integrations/docs/introduction), [API scopes](https://docs.gusto.com/app-integrations/docs/scopes)

The documented time integration can reconcile the employee roster and push classified time per shift/employee/job; it is not simply an arbitrary pay-period total import. The resulting time still needs to be applied to payroll. [Time-tracking integration](https://docs.gusto.com/app-integrations/docs/syncing-time-tracking-data)

Gusto's official internal tools offer another route: its beta CLI supports draft payroll preparation and payroll/ledger reads; its MCP advertises additional staff/time/payroll workflows with confirmation. These offerings must be checked against each required field and operation, and are not proof of a supported unattended embedded connector. [Gusto CLI](https://gusto.com/product/integrations/gusto-cli), [Gusto MCP](https://gusto.com/product/integrations/gusto-mcp)

**Plan:** run an early feasibility proof for the Phase 7 staff/time/production/payroll map using an explicitly supported internal route. Keep final payroll approval in Gusto. CSV export is a fallback, not completion of Dave's requested two-way exchange. If access or object coverage is inadequate, surface the exact limitation as a launch dependency rather than claiming a full API integration is available.

## VetRocket / RocketPACS

RocketPACS documents cloud DICOM storage/viewing/sharing, browser viewer, query/download, routing and web links. Public product material does not specify a complete custom-PIMS API contract. [RocketPACS product](https://www.vetrocket.com/rocketpacs-product)

**Plan:** obtain the practice's installed product and interface documentation. Use stable patient/study/accession matching, a viewer launch and report attachment, then the agreed supported study/report automation. Confirm worklist/order creation, SSO, embedding and notification mechanisms individually. A manual viewer link must not be represented as automatic results integration; diagnostic image viewing remains in the diagnostic viewer.

## VetRec as a functional reference

Official documentation describes generated medical notes/templates, record recap, phone recording/summaries and dental charts. These support the requested functional categories, not an obligation to reproduce the entire commercial product. [Medical notes](https://help.vetrec.io/en/articles/9733183-generate-medical-notes), [templates](https://help.vetrec.io/en/articles/10144196-pre-built-templates), [records recap](https://help.vetrec.io/en/articles/10166461-record-s-recap-handwritten-notes-and-scanned-records), [phone calls](https://help.vetrec.io/en/articles/11536039-record-an-outbound-phone-call), [dental charts](https://help.vetrec.io/en/articles/10084136-dental-charts)

**Plan:** native recording/transcript → draft SOAP, source-grounded record recap, reviewed CloudTalk summary-to-note, and reviewed dental extraction. Reuse current chart/signature structures and preserve the selected phone provider. No generated note, tooth procedure or drug event becomes signed clinical fact automatically.

## VetSnap-style controlled-drug logging

VetSnap documents alternative witness timing, configurable signature rules and reports showing container balances/transactions. A second approval button alone would not provide that workflow. [Double confirmation](https://vetsnap.freshdesk.com/support/solutions/articles/69000869535-double-confirmation-options), [signature settings](https://vetsnap.freshdesk.com/support/solutions/articles/69000876309-settings-for-double-signatures), [audit reports](https://vetsnap.freshdesk.com/support/solutions/articles/69000824262-what-is-the-audit-report-)

**Plan:** controlled register connected to existing inventory events, exact units/container/location, independent witness, preserved corrections, physical counts and discrepancy resolution. Determine witness roles/timing and mobile stock with Dr. Edler. Product documentation is not a substitute for verifying applicable requirements before making compliance claims.

## Stripe financing and separate veterinary providers

The current Stripe shortlist includes Sunbit, Affirm, Klarna, Afterpay and Zip. All are candidate payment methods, not confirmed approvals for this veterinary account. The revised [one-page comparison](../../output/pdf/living-room-vet-stripe-financing.pdf) shows client options and the fee/net proceeds on the same $1,000 bill. It was emailed to Susan for selection; no provider has been enabled. Published U.S. method fees and account-specific terms must be distinguished. [Stripe payment-method pricing](https://stripe.com/pricing/local-payment-methods), [Sunbit](https://docs.stripe.com/payments/sunbit), [Affirm](https://docs.stripe.com/payments/affirm), [Klarna](https://docs.stripe.com/payments/klarna), [Afterpay](https://docs.stripe.com/payments/afterpay-clearpay), [Zip](https://docs.stripe.com/payments/zip).

**Native Stripe route:** extend `supabase/functions/_shared/stripe-provider.ts`, whose current Checkout request explicitly selects cards. Verify eligibility and supported Checkout mode, success/async/failure events, reconciliation and refunds for the chosen method. Reuse verified Stripe payment identities; do not route a native Stripe payment through a duplicate external settlement ledger.

CareCredit supports practice-specific application/payment links and established software integrations; public material does not establish custom API entitlement for this app. [CareCredit provider support](https://www.carecredit.com/providers/support/), [integrations](https://www.carecredit.com/providers/support/partners-integration/)

Scratch Pay describes loan application, clinic finalization and payment to the practice. Its lending service is distinct from Scratch Checkout: the latter's PIMS payment extensions do not establish a lending API contract. [Scratch Pay lending](https://scratchpay.com/practices/product-lending), [Scratch Checkout compatibility](https://scratchpay.com/practices/compatibility)

**Separate-provider route:** choose provider/enrollment, hand off applications using supported practice links, record actual external settlement with evidence and reconcile to invoices. Automate status/refunds only if a supported interface exists. Application approval is not payment. Financing lenders administer borrower installments; LRV follows unpaid clinic balances. CareCredit and Scratchpay financing require a separate workflow alongside Stripe; they are not native financing-method selections in Stripe Checkout.

## iPhone camera barcode scanning

Browser camera capture requires permission and a secure context. Native browser `BarcodeDetector` remains limited availability, so a successful desktop demo alone is insufficient. [Camera API](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia), [BarcodeDetector compatibility](https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector)

**Plan:** prototype on an actual iPhone with the practice's labels; use a compatible decoder and confirm the decoded product before recording inventory actions. Keep manual recovery. Do not infer lot/expiry from a barcode that does not encode them.

## Automatic anesthesia records

No manufacturer/model or interface was provided at initial planning. The existing app stores manual/transcribed records; there is no verified automatic device feed. Obtain the actual device/software specification and sample export before selecting an adapter. A manually attached PDF alone does not fulfill automatic chart integration.

## Linked Perplexity artifact

The supplied [Perplexity artifact](https://www.perplexity.ai/computer/a/29941d1c-aeb0-4dfd-9329-048dc731c3b8) returned no readable content. The plan covers the supplied checklist and clarifications, not unseen material behind that link. If the artifact contains additional requirements, append them to the matrix after receiving its contents.
